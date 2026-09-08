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
import {
  EmbeddingService,
  EntityResolverService,
  ExtractionService,
  GraphRAGService,
} from "../pipeline/index.js";
import {
  EmbeddingConfigValues,
  type ExtractionConfig,
  ResourcesConfigValues,
  type S3ResourceTarget,
} from "../config/schema.js";
import {
  AppAgentConfig,
  type AppAgentConfigService,
} from "../config/agent-config.js";
import { createPostgresClient } from "../storage/database-client.js";
import { S3ConnectorService } from "../connectors/s3-connector.js";

/**
 * Builds a composite Layer for all storage, pipeline, S3, and embedding services
 * given the unified AppAgentConfig. Also creates the underlying PostgreSQL client
 * and includes SqlClient.SqlClient in the resulting layer.
 */
export const makeAgentPipelineLayer = (configOrApp?: AppAgentConfigService) =>
  Effect.gen(function* () {
    const config = configOrApp ?? (yield* AppAgentConfig);
    const sql = yield* createPostgresClient(config);
    const sqlLayer = Layer.succeed(SqlClient.SqlClient, sql);

    const api_base = yield* config.embedding.api_base;
    const model = yield* config.embedding.model;
    const apiKey = yield* config.embedding.apiKey.get;

    const resourcesVal = Redacted.value(yield* config.resources.get) as any;
    const s3Raw = resourcesVal?.s3;
    const s3Entries: [string, S3ResourceTarget][] = Array.isArray(s3Raw)
      ? s3Raw.map((target: S3ResourceTarget) => [target.name, target])
      : s3Raw instanceof Map
        ? Array.from(s3Raw.entries())
        : typeof s3Raw === "object" && s3Raw !== null
          ? Object.entries(s3Raw)
          : [];
    const s3Targets: Record<string, S3ResourceTarget> =
      Object.fromEntries(s3Entries);

    const extractionVal = yield* config.extraction;
    const extractionRules: ExtractionConfig | undefined = Option.isOption(
      extractionVal,
    )
      ? (Option.getOrUndefined(extractionVal) as ExtractionConfig | undefined)
      : (extractionVal as ExtractionConfig | undefined);

    const extractionLayer = ExtractionService.make(extractionRules);

    const reposLayer = Layer.mergeAll(
      DocumentRepository.Default,
      ChunkRepository.Default,
      CheckpointRepository.Default,
      EntityRepository.Default,
      GraphRepository.Default,
    ).pipe(Layer.provide(sqlLayer));

    const resolverLayer = EntityResolverService.Default.pipe(
      Layer.provide(reposLayer),
    );

    const embeddingConfigValuesLayer = Layer.succeed(EmbeddingConfigValues, {
      api_base,
      model,
      apiKey,
    });

    const resourcesConfigValuesLayer = Layer.succeed(ResourcesConfigValues, {
      s3: s3Targets,
      getS3Resource: (name: string) =>
        s3Targets[name] !== undefined
          ? Option.some(s3Targets[name])
          : Option.none(),
    });

    const httpLayer = FetchHttpClient.layer;
    const embeddingLayer = EmbeddingService.Live.pipe(
      Layer.provide(embeddingConfigValuesLayer),
      Layer.provide(httpLayer),
    );

    const s3Layer = S3ConnectorService.Live.pipe(
      Layer.provide(resourcesConfigValuesLayer),
      Layer.provide(httpLayer),
    );

    const graphRagLayer = GraphRAGService.Default.pipe(
      Layer.provide(reposLayer),
      Layer.provide(embeddingLayer),
    );

    return Layer.mergeAll(
      sqlLayer,
      reposLayer,
      resolverLayer,
      embeddingLayer,
      s3Layer,
      graphRagLayer,
      extractionLayer,
    );
  });
