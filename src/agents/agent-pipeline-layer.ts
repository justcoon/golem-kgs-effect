import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import {
  CheckpointRepository,
  ChunkRepository,
  DocumentRepository,
  EntityRepository,
  GraphRepository,
} from "../storage/index.js";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import {
  EmbeddingService,
  EntityResolverService,
  ExtractionService,
  GraphRAGService,
  LlmSynthesisService,
} from "../pipeline/index.js";
import {
  EmbeddingConfigValues,
  type ExtractionConfig,
  S3ResourcesConfig,
  WebResourcesConfig,
  type S3ResourceTarget,
  type WebResourceTarget,
} from "../config/schema.js";
import type { AppAgentConfigService } from "../config/agent-config.js";
import { createPostgresClient } from "../storage/database-client.js";
import { S3ConnectorService } from "../connectors/s3-connector.js";
import { WebConnectorService } from "../connectors/web-connector.js";

function parseS3Targets(
  resourcesVal: unknown,
): Record<string, S3ResourceTarget> {
  const s3Raw = (resourcesVal as { s3?: unknown })?.s3;
  const s3Entries: [string, S3ResourceTarget][] = Array.isArray(s3Raw)
    ? s3Raw.map((target: S3ResourceTarget) => [target.name, target])
    : s3Raw instanceof Map
      ? Array.from(s3Raw.entries())
      : typeof s3Raw === "object" && s3Raw !== null
        ? Object.entries(s3Raw as Record<string, S3ResourceTarget>)
        : [];
  return Object.fromEntries(s3Entries);
}

function parseWebTargets(
  resourcesVal: unknown,
): Record<string, WebResourceTarget> {
  const webRaw = (resourcesVal as { web?: unknown })?.web;
  const webEntries: [string, WebResourceTarget][] = Array.isArray(webRaw)
    ? webRaw.map((target: WebResourceTarget) => [target.name, target])
    : webRaw instanceof Map
      ? Array.from(webRaw.entries())
      : typeof webRaw === "object" && webRaw !== null
        ? Object.entries(webRaw as Record<string, WebResourceTarget>)
        : [];
  return Object.fromEntries(webEntries);
}

/**
 * Builds the PostgreSQL client and storage repositories layer.
 */
export const makeStorageAndRepositoriesLayer = (
  config: AppAgentConfigService,
) =>
  Effect.gen(function* () {
    const sql = yield* createPostgresClient(config);
    const sqlLayer = Layer.succeed(SqlClient.SqlClient, sql);

    const reposLayer = Layer.mergeAll(
      DocumentRepository.Default,
      ChunkRepository.Default,
      CheckpointRepository.Default,
      EntityRepository.Default,
      GraphRepository.Default,
    ).pipe(Layer.provide(sqlLayer));

    return { sqlLayer, reposLayer };
  });

/**
 * Builds the live embedding service layer.
 */
export const makeEmbeddingLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const api_base = yield* config.embedding.api_base;
    const model = yield* config.embedding.model;
    const apiKey = yield* config.embedding.apiKey.get;

    const embeddingConfigValuesLayer = Layer.succeed(EmbeddingConfigValues, {
      api_base,
      model,
      apiKey,
    });

    const httpLayer = FetchHttpClient.layer;
    return EmbeddingService.Live.pipe(
      Layer.provide(embeddingConfigValuesLayer),
      Layer.provide(httpLayer),
    );
  });

/**
 * Builds semantic extraction and entity resolution services for ingestion pipelines.
 */
export const makeIngestionSemanticLayer = <E, R>(
  config: AppAgentConfigService,
  reposLayer: Layer.Layer<
    | DocumentRepository
    | ChunkRepository
    | CheckpointRepository
    | EntityRepository
    | GraphRepository,
    E,
    R
  >,
) =>
  Effect.gen(function* () {
    const extractionVal = yield* config.extraction;
    const extractionRules: ExtractionConfig | undefined = Option.isOption(
      extractionVal,
    )
      ? (Option.getOrUndefined(extractionVal) as ExtractionConfig | undefined)
      : (extractionVal as ExtractionConfig | undefined);

    const extractionLayer = ExtractionService.make(extractionRules);
    const resolverLayer = EntityResolverService.Default.pipe(
      Layer.provide(reposLayer),
    );

    return { extractionLayer, resolverLayer };
  });

/**
 * Builds the S3 connector service layer configured with S3 resource targets.
 */
export const makeS3ConnectorLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const resourcesVal = Redacted.value(yield* config.resources.get);
    const s3Targets = parseS3Targets(resourcesVal);

    const s3ConfigLayer = Layer.succeed(S3ResourcesConfig, {
      s3: s3Targets,
      getS3Resource: (name: string) =>
        s3Targets[name] !== undefined
          ? Option.some(s3Targets[name])
          : Option.none(),
    });

    const httpLayer = FetchHttpClient.layer;
    return S3ConnectorService.Live.pipe(
      Layer.provide(s3ConfigLayer),
      Layer.provide(httpLayer),
    );
  });

/**
 * Builds the Web connector service layer configured with Web resource targets.
 */
export const makeWebConnectorLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const resourcesVal = Redacted.value(yield* config.resources.get);
    const webTargets = parseWebTargets(resourcesVal);

    const webConfigLayer = Layer.succeed(WebResourcesConfig, {
      web: webTargets,
      getWebResource: (name: string) =>
        webTargets[name] !== undefined
          ? Option.some(webTargets[name])
          : Option.none(),
    });

    const httpLayer = FetchHttpClient.layer;
    return WebConnectorService.Live.pipe(
      Layer.provide(webConfigLayer),
      Layer.provide(httpLayer),
    );
  });

/**
 * Builds the GraphRAG retrieval service layer.
 */
export const makeGraphRAGLayer = <E1, R1, E2, R2>(
  reposLayer: Layer.Layer<
    | DocumentRepository
    | ChunkRepository
    | CheckpointRepository
    | EntityRepository
    | GraphRepository,
    E1,
    R1
  >,
  embeddingLayer: Layer.Layer<EmbeddingService, E2, R2>,
) =>
  GraphRAGService.Default.pipe(
    Layer.provide(reposLayer),
    Layer.provide(embeddingLayer),
  );

/**
 * Dedicated layer factory for KnowledgeAccessAgent.
 * Provides SQL, Repositories, EmbeddingService, GraphRAGService, and optional LlmSynthesisService.
 * Excludes connector services, extraction rules, and entity resolution.
 */
export const makeLlmLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const apiUrl = yield* config.llm.api_base;
    const model = yield* config.llm.model;
    const apiKey = yield* config.llm.apiKey.get;

    const openAiClientLive = OpenAiClient.layer({
      apiKey,
      apiUrl,
    }).pipe(Layer.provide(FetchHttpClient.layer));

    const languageModelLive = OpenAiLanguageModel.layer({ model }).pipe(
      Layer.provide(openAiClientLive),
    );

    return LlmSynthesisService.Default.pipe(Layer.provide(languageModelLive));
  });

export const makeAccessAgentLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const { sqlLayer, reposLayer } =
      yield* makeStorageAndRepositoriesLayer(config);
    const embeddingLayer = yield* makeEmbeddingLayer(config);
    const graphRagLayer = makeGraphRAGLayer(reposLayer, embeddingLayer);
    const llmLayer = yield* makeLlmLayer(config);

    return Layer.mergeAll(
      sqlLayer,
      reposLayer,
      embeddingLayer,
      graphRagLayer,
      llmLayer,
    );
  });

/**
 * Dedicated layer factory for S3IngestorTaskAgent.
 * Provides SQL, Repositories, S3ConnectorService, EmbeddingService,
 * ExtractionService, and EntityResolverService.
 * Excludes WebConnectorService and GraphRAGService.
 */
export const makeS3TaskAgentLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const { sqlLayer, reposLayer } =
      yield* makeStorageAndRepositoriesLayer(config);
    const embeddingLayer = yield* makeEmbeddingLayer(config);
    const { extractionLayer, resolverLayer } =
      yield* makeIngestionSemanticLayer(config, reposLayer);
    const s3Layer = yield* makeS3ConnectorLayer(config);

    return Layer.mergeAll(
      sqlLayer,
      reposLayer,
      resolverLayer,
      embeddingLayer,
      s3Layer,
      extractionLayer,
    );
  });

/**
 * Dedicated layer factory for WebIngestorTaskAgent.
 * Provides SQL, Repositories, WebConnectorService, EmbeddingService,
 * ExtractionService, and EntityResolverService.
 * Excludes S3ConnectorService and GraphRAGService.
 */
export const makeWebTaskAgentLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const { sqlLayer, reposLayer } =
      yield* makeStorageAndRepositoriesLayer(config);
    const embeddingLayer = yield* makeEmbeddingLayer(config);
    const { extractionLayer, resolverLayer } =
      yield* makeIngestionSemanticLayer(config, reposLayer);
    const webLayer = yield* makeWebConnectorLayer(config);

    return Layer.mergeAll(
      sqlLayer,
      reposLayer,
      resolverLayer,
      embeddingLayer,
      webLayer,
      extractionLayer,
    );
  });

/**
 * Builds a composite Layer for all storage, pipeline, S3, and embedding services.
 * Retained for backward compatibility and multi-purpose test scenarios.
 */
export const makeAgentPipelineLayer = (config: AppAgentConfigService) =>
  Effect.gen(function* () {
    const { sqlLayer, reposLayer } =
      yield* makeStorageAndRepositoriesLayer(config);
    const embeddingLayer = yield* makeEmbeddingLayer(config);
    const graphRagLayer = makeGraphRAGLayer(reposLayer, embeddingLayer);
    const { extractionLayer, resolverLayer } =
      yield* makeIngestionSemanticLayer(config, reposLayer);
    const s3Layer = yield* makeS3ConnectorLayer(config);
    const webLayer = yield* makeWebConnectorLayer(config);

    return Layer.mergeAll(
      sqlLayer,
      reposLayer,
      resolverLayer,
      embeddingLayer,
      s3Layer,
      webLayer,
      graphRagLayer,
      extractionLayer,
    );
  });
