import { Schema } from "effect";

export const VectorEmbedding = Schema.Array(Schema.Number);
export type VectorEmbedding = typeof VectorEmbedding.Type;

export const DocumentChunk = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  chunkIndex: Schema.Number,
  content: Schema.String,
  tokenCount: Schema.Number,
  embedding: Schema.NullOr(VectorEmbedding),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type DocumentChunk = typeof DocumentChunk.Type;

export const CreateChunkInput = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  chunkIndex: Schema.Number,
  content: Schema.String,
  tokenCount: Schema.optional(Schema.Number),
  embedding: Schema.optional(Schema.NullOr(VectorEmbedding)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type CreateChunkInput = typeof CreateChunkInput.Type;

export const EntityChunkMention = Schema.Struct({
  entityId: Schema.String,
  chunkId: Schema.String,
  mentionText: Schema.optional(Schema.NullOr(Schema.String)),
  confidence: Schema.optional(Schema.Number),
  createdAt: Schema.optional(Schema.Date),
});
export type EntityChunkMention = typeof EntityChunkMention.Type;
