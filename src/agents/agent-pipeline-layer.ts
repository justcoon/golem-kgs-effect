import { Effect, Layer, Option } from "effect";
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
} from "../config/schema.js";
import type { AppAgentConfigService } from "../config/agent-config.js";
import { createPostgresClient } from "../storage/database-client.js";
import {
  makeS3ConnectorLayer,
  makeWebConnectorLayer,
} from "./connector-layers.js";

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

export {
  makeS3ConnectorLayer,
  makeWebConnectorLayer,
  parseS3Targets,
  parseWebTargets,
} from "./connector-layers.js";

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
export const makeS3TaskAgentLayer = (
  config: AppAgentConfigService,
  resourceName: string,
) =>
  Effect.gen(function* () {
    const { sqlLayer, reposLayer } =
      yield* makeStorageAndRepositoriesLayer(config);
    const embeddingLayer = yield* makeEmbeddingLayer(config);
    const { extractionLayer, resolverLayer } =
      yield* makeIngestionSemanticLayer(config, reposLayer);
    const s3Layer = yield* makeS3ConnectorLayer(config, resourceName);

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
export const makeWebTaskAgentLayer = (
  config: AppAgentConfigService,
  resourceName: string,
) =>
  Effect.gen(function* () {
    const { sqlLayer, reposLayer } =
      yield* makeStorageAndRepositoriesLayer(config);
    const embeddingLayer = yield* makeEmbeddingLayer(config);
    const { extractionLayer, resolverLayer } =
      yield* makeIngestionSemanticLayer(config, reposLayer);
    const webLayer = yield* makeWebConnectorLayer(config, resourceName);

    return Layer.mergeAll(
      sqlLayer,
      reposLayer,
      resolverLayer,
      embeddingLayer,
      webLayer,
      extractionLayer,
    );
  });
