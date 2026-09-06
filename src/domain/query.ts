import { Schema } from "effect";

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
