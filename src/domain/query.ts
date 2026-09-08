import { Schema } from "effect";
import { Edge } from "./relationship.js";
import { Entity } from "./entity.js";

export const NeighborhoodQuery = Schema.Struct({
  seedEntityIds: Schema.Array(Schema.String),
  depth: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
  direction: Schema.optional(Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"])),
  minConfidence: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});
export type NeighborhoodQuery = typeof NeighborhoodQuery.Type;

export const VectorSearchQuery = Schema.Struct({
  embedding: Schema.Array(Schema.Number),
  topK: Schema.optional(Schema.Number),
  threshold: Schema.optional(Schema.Number),
  documentId: Schema.optional(Schema.String),
});
export type VectorSearchQuery = typeof VectorSearchQuery.Type;

export const KeywordSearchQuery = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});
export type KeywordSearchQuery = typeof KeywordSearchQuery.Type;

export const HybridSearchQuery = Schema.Struct({
  query: Schema.String,
  embedding: Schema.Array(Schema.Number),
  limit: Schema.optional(Schema.Number),
  vectorWeight: Schema.optional(Schema.Number),
  rrfK: Schema.optional(Schema.Number),
});
export type HybridSearchQuery = typeof HybridSearchQuery.Type;

export const SearchResultItem = Schema.Struct({
  chunkId: Schema.String,
  documentId: Schema.String,
  content: Schema.String,
  score: Schema.Number,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});
export type SearchResultItem = typeof SearchResultItem.Type;

export const PathFindingQuery = Schema.Struct({
  sourceEntityId: Schema.String,
  targetEntityId: Schema.String,
  maxDepth: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
  direction: Schema.optional(Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"])),
});
export type PathFindingQuery = typeof PathFindingQuery.Type;

export const GraphPath = Schema.Struct({
  entityIds: Schema.Array(Schema.String),
  edges: Schema.Array(Edge),
  totalWeight: Schema.Number,
});
export type GraphPath = typeof GraphPath.Type;

export const PathFindingResult = Schema.Struct({
  paths: Schema.Array(GraphPath),
  shortestPathLength: Schema.NullOr(Schema.Number),
});
export type PathFindingResult = typeof PathFindingResult.Type;

export const GraphRAGQuery = Schema.Struct({
  query: Schema.String,
  topK: Schema.optional(Schema.Number),
  maxHops: Schema.optional(Schema.Number),
  minConfidence: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
});
export type GraphRAGQuery = typeof GraphRAGQuery.Type;

export const GraphRAGContextBundle = Schema.Struct({
  query: Schema.String,
  entities: Schema.Array(Entity),
  relationships: Schema.Array(Edge),
  relevantChunks: Schema.Array(SearchResultItem),
  formattedContextPrompt: Schema.String,
  metadata: Schema.Struct({
    totalEntities: Schema.Number,
    totalRelationships: Schema.Number,
    totalChunks: Schema.Number,
    retrievalDurationMs: Schema.Number,
  }),
});
export type GraphRAGContextBundle = typeof GraphRAGContextBundle.Type;
