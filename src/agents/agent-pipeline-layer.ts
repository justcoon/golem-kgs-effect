import { Layer, Option, type Redacted } from "effect";
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
} from "../pipeline/index.js";
import {
  EmbeddingConfigValues,
  ResourcesConfigValues,
  type S3ResourceTarget,
} from "../config/schema.js";
import { S3ConnectorService } from "../connectors/s3-connector.js";

/**
 * Builds a composite Layer for all storage, pipeline, S3, and embedding services
 * given an initialized SqlClient, embedding config, and S3 targets.
 */
export function makeAgentPipelineLayer(params: {
  readonly sql: SqlClient.SqlClient;
  readonly embeddingConfig: {
    readonly api_base: string;
    readonly model: string;
    readonly apiKey: Redacted.Redacted<string>;
  };
  readonly s3Targets: Record<string, S3ResourceTarget>;
}) {
  const sqlLayer = Layer.succeed(SqlClient.SqlClient, params.sql);
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

  const embeddingConfigValuesLayer = Layer.succeed(
    EmbeddingConfigValues,
    params.embeddingConfig,
  );

  const resourcesConfigValuesLayer = Layer.succeed(ResourcesConfigValues, {
    s3: params.s3Targets,
    getS3Resource: (name: string) =>
      params.s3Targets[name] !== undefined
        ? Option.some(params.s3Targets[name])
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

  return Layer.mergeAll(
    reposLayer,
    resolverLayer,
    embeddingLayer,
    s3Layer,
    ExtractionService.Default,
  );
}
