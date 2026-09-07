import { Context, type Effect, type Layer, type Option } from "effect";
import { type SqlClient } from "effect/unstable/sql";
import { type SqlError } from "effect/unstable/sql/SqlError";
import { type RawDocument } from "../domain/provenance.js";
import {
  type CreateChunkInput,
  type DocumentChunk,
  type EntityChunkMention,
} from "../domain/chunk.js";
import {
  type HybridSearchQuery,
  type KeywordSearchQuery,
  type NeighborhoodQuery,
  type PathFindingQuery,
  type PathFindingResult,
  type SearchResultItem,
  type VectorSearchQuery,
} from "../domain/query.js";
import {
  type SaveCheckpointInput,
  type SyncCheckpoint,
} from "../domain/connector.js";
import {
  type CreateEntityInput,
  type Entity,
  type EntityAlias,
  type UpdateEntityInput,
} from "../domain/entity.js";
import { type CreateEdgeInput, type Edge } from "../domain/relationship.js";

// --- Document Repository ---

export interface DocumentRepositoryShape {
  readonly saveDocument: (
    doc: RawDocument,
  ) => Effect.Effect<RawDocument, SqlError>;
  readonly findDocumentById: (
    id: string,
  ) => Effect.Effect<Option.Option<RawDocument>, SqlError>;
  readonly listDocuments: (options?: {
    source?: string;
    namespace?: string;
    limit?: number;
    offset?: number;
  }) => Effect.Effect<ReadonlyArray<RawDocument>, SqlError>;
  readonly deleteDocument: (id: string) => Effect.Effect<boolean, SqlError>;
  readonly count: () => Effect.Effect<number, SqlError>;
}

export class DocumentRepository extends Context.Service<
  DocumentRepository,
  DocumentRepositoryShape
>()("app/storage/DocumentRepository") {
  static Default: Layer.Layer<
    DocumentRepository,
    SqlError,
    SqlClient.SqlClient
  >;
}

// --- Chunk Repository ---

export interface ChunkRepositoryShape {
  readonly saveRawDocument: (
    doc: RawDocument,
  ) => Effect.Effect<RawDocument, SqlError>;
  readonly getRawDocument: (
    id: string,
  ) => Effect.Effect<Option.Option<RawDocument>, SqlError>;
  readonly upsertChunk: (
    input: CreateChunkInput,
  ) => Effect.Effect<DocumentChunk, SqlError>;
  readonly getChunksByDocument: (
    documentId: string,
  ) => Effect.Effect<ReadonlyArray<DocumentChunk>, SqlError>;
  readonly linkEntityChunk: (
    mention: EntityChunkMention,
  ) => Effect.Effect<void, SqlError>;
  readonly getChunksForEntity: (
    entityId: string,
  ) => Effect.Effect<ReadonlyArray<DocumentChunk>, SqlError>;
  readonly getEntityIdsForChunks: (
    chunkIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, SqlError>;
  readonly searchVector: (
    query: VectorSearchQuery,
  ) => Effect.Effect<ReadonlyArray<SearchResultItem>, SqlError>;
  readonly searchKeyword: (
    query: KeywordSearchQuery,
  ) => Effect.Effect<ReadonlyArray<SearchResultItem>, SqlError>;
  readonly searchHybrid: (
    query: HybridSearchQuery,
  ) => Effect.Effect<ReadonlyArray<SearchResultItem>, SqlError>;
  readonly count: () => Effect.Effect<number, SqlError>;
}

export class ChunkRepository extends Context.Service<
  ChunkRepository,
  ChunkRepositoryShape
>()("app/storage/ChunkRepository") {
  static Default: Layer.Layer<ChunkRepository, SqlError, SqlClient.SqlClient>;
}

// --- Checkpoint Repository ---

export interface CheckpointRepositoryShape {
  readonly saveCheckpoint: (
    input: SaveCheckpointInput,
  ) => Effect.Effect<SyncCheckpoint, SqlError>;
  readonly getCheckpoint: (
    connectorId: string,
  ) => Effect.Effect<Option.Option<SyncCheckpoint>, SqlError>;
  readonly listCheckpoints: () => Effect.Effect<
    ReadonlyArray<SyncCheckpoint>,
    SqlError
  >;
  readonly deleteCheckpoint: (
    connectorId: string,
  ) => Effect.Effect<boolean, SqlError>;
  readonly getLatestSyncTime: () => Effect.Effect<
    Option.Option<Date>,
    SqlError
  >;
}

export class CheckpointRepository extends Context.Service<
  CheckpointRepository,
  CheckpointRepositoryShape
>()("app/storage/CheckpointRepository") {
  static Default: Layer.Layer<
    CheckpointRepository,
    SqlError,
    SqlClient.SqlClient
  >;
}

// --- Entity Repository ---

export interface EntityRepositoryShape {
  readonly findById: (
    id: string,
  ) => Effect.Effect<Option.Option<Entity>, SqlError>;
  readonly findByName: (
    name: string,
  ) => Effect.Effect<Option.Option<Entity>, SqlError>;
  readonly findByAlias: (
    alias: string,
  ) => Effect.Effect<Option.Option<Entity>, SqlError>;
  readonly upsertEntity: (
    input: CreateEntityInput,
  ) => Effect.Effect<Entity, SqlError>;
  readonly updateEntity: (
    id: string,
    input: UpdateEntityInput,
  ) => Effect.Effect<Option.Option<Entity>, SqlError>;
  readonly addAlias: (
    alias: EntityAlias,
  ) => Effect.Effect<EntityAlias, SqlError>;
  readonly listAliases: (
    entityId: string,
  ) => Effect.Effect<ReadonlyArray<EntityAlias>, SqlError>;
  readonly searchByName: (
    query: string,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<Entity>, SqlError>;
  readonly deleteEntity: (id: string) => Effect.Effect<boolean, SqlError>;
  readonly count: () => Effect.Effect<number, SqlError>;
}

export class EntityRepository extends Context.Service<
  EntityRepository,
  EntityRepositoryShape
>()("app/storage/EntityRepository") {
  static Default: Layer.Layer<EntityRepository, SqlError, SqlClient.SqlClient>;
}

// --- Graph Repository ---

export interface GraphRepositoryShape {
  readonly upsertEdge: (
    input: CreateEdgeInput,
  ) => Effect.Effect<Edge, SqlError>;
  readonly findEdge: (
    sourceId: string,
    targetId: string,
    relationType: string,
  ) => Effect.Effect<Option.Option<Edge>, SqlError>;
  readonly getOutboundEdges: (
    sourceId: string,
    relationType?: string,
  ) => Effect.Effect<ReadonlyArray<Edge>, SqlError>;
  readonly getInboundEdges: (
    targetId: string,
    relationType?: string,
  ) => Effect.Effect<ReadonlyArray<Edge>, SqlError>;
  readonly getNeighborhood: (query: NeighborhoodQuery) => Effect.Effect<
    {
      readonly entityIds: ReadonlyArray<string>;
      readonly edges: ReadonlyArray<Edge>;
    },
    SqlError
  >;
  readonly findPaths: (
    query: PathFindingQuery,
  ) => Effect.Effect<PathFindingResult, SqlError>;
  readonly deleteEdge: (id: string) => Effect.Effect<boolean, SqlError>;
  readonly countEdges: () => Effect.Effect<number, SqlError>;
}

export class GraphRepository extends Context.Service<
  GraphRepository,
  GraphRepositoryShape
>()("app/storage/GraphRepository") {
  static Default: Layer.Layer<GraphRepository, SqlError, SqlClient.SqlClient>;
}
