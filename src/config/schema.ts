import { Context, Option, Redacted, Schema } from "effect";

export const DatabaseConfigFields = {
  db: Schema.Struct({
    host: Schema.String,
    db: Schema.String,
    port: Schema.String,
    user: Schema.Redacted(Schema.String),
    password: Schema.Redacted(Schema.String),
  }),
};

export const DatabaseConfigSchema = Schema.Struct(DatabaseConfigFields);
export type DatabaseConfigSchema = typeof DatabaseConfigSchema.Type;

export const EmbeddingConfigFields = {
  embedding: Schema.Struct({
    api_base: Schema.String,
    model: Schema.String,
    apiKey: Schema.Redacted(Schema.String),
  }),
};

export const EmbeddingConfigSchema = Schema.Struct(EmbeddingConfigFields);
export type EmbeddingConfigSchema = typeof EmbeddingConfigSchema.Type;

export interface EmbeddingConfigShape {
  readonly api_base: string;
  readonly model: string;
  readonly apiKey: Redacted.Redacted<string>;
}

export class EmbeddingConfigValues extends Context.Service<
  EmbeddingConfigValues,
  EmbeddingConfigShape
>()("app/config/EmbeddingConfigValues") {}

export const S3ResourceTargetSchema = Schema.Struct({
  name: Schema.String,
  endpoint: Schema.String,
  region: Schema.String,
  bucket: Schema.String,
  prefixes: Schema.optional(Schema.Array(Schema.String)),
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
});
export type S3ResourceTarget = typeof S3ResourceTargetSchema.Type;

export const ResourcesSecretSchema = Schema.Struct({
  s3: Schema.Array(S3ResourceTargetSchema),
});
export type ResourcesSecretSchema = typeof ResourcesSecretSchema.Type;

export const ResourcesConfigFields = {
  resources: Schema.Redacted(ResourcesSecretSchema),
};

export const ResourcesConfigSchema = Schema.Struct(ResourcesConfigFields);
export type ResourcesConfigSchema = typeof ResourcesConfigSchema.Type;

export interface ResourcesConfigShape {
  readonly s3: Record<string, S3ResourceTarget>;
  readonly getS3Resource: (name: string) => Option.Option<S3ResourceTarget>;
}

export class ResourcesConfigValues extends Context.Service<
  ResourcesConfigValues,
  ResourcesConfigShape
>()("app/config/ResourcesConfigValues") {}

export const RelationPatternRuleSchema = Schema.Struct({
  relation: Schema.String,
  phrases: Schema.Array(Schema.String),
  confidence: Schema.optional(Schema.Number),
});
export type RelationPatternRule = typeof RelationPatternRuleSchema.Type;

export const DictionaryEntrySchema = Schema.Struct({
  alias: Schema.String,
  canonical: Schema.String,
});
export type DictionaryEntry = typeof DictionaryEntrySchema.Type;

export const ExtractionConfigSchema = Schema.Struct({
  dictionary: Schema.optional(Schema.Array(DictionaryEntrySchema)),
  relationPatterns: Schema.optional(Schema.Array(RelationPatternRuleSchema)),
  stopwords: Schema.optional(Schema.Array(Schema.String)),
});
export type ExtractionConfig = typeof ExtractionConfigSchema.Type;

export const ExtractionConfigFields = {
  extraction: Schema.optional(ExtractionConfigSchema),
};
