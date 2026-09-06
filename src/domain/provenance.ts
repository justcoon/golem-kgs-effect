import { Schema } from "effect";

export const SourceType = Schema.Literals([
  "s3",
  "filesystem",
  "slack",
  "confluence",
  "manual",
  "api",
  "unknown",
]);
export type SourceType = typeof SourceType.Type;

export const ProvenanceRecord = Schema.Struct({
  source: SourceType,
  documentId: Schema.String,
  uri: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  timestamp: Schema.Date,
  extractor: Schema.optional(Schema.String),
  extractionConfidence: Schema.optional(Schema.Number),
});
export type ProvenanceRecord = typeof ProvenanceRecord.Type;

export const RawDocument = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  tags: Schema.Array(Schema.String),
  source: Schema.String,
  namespace: Schema.String,
  sizeBytes: Schema.Number,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type RawDocument = typeof RawDocument.Type;
