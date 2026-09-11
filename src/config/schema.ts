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

export const HttpHeaderSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
});
export type HttpHeader = typeof HttpHeaderSchema.Type;

export const WebResourceTargetSchema = Schema.Struct({
  name: Schema.String,
  baseUrl: Schema.String,
  sitemapUrl: Schema.optional(Schema.String),
  seedUrls: Schema.optional(Schema.Array(Schema.String)),
  includePatterns: Schema.optional(Schema.Array(Schema.String)),
  excludePatterns: Schema.optional(Schema.Array(Schema.String)),
  headers: Schema.optional(Schema.Array(HttpHeaderSchema)),
  maxPages: Schema.optional(Schema.Number),
});
export type WebResourceTarget = typeof WebResourceTargetSchema.Type;

export const ResourcesSecretSchema = Schema.Struct({
  s3: Schema.Array(S3ResourceTargetSchema),
  web: Schema.Array(WebResourceTargetSchema),
});
export type ResourcesSecretSchema = typeof ResourcesSecretSchema.Type;

export const ResourcesConfigFields = {
  resources: Schema.Redacted(ResourcesSecretSchema),
};

export const ResourcesConfigSchema = Schema.Struct(ResourcesConfigFields);
export type ResourcesConfigSchema = typeof ResourcesConfigSchema.Type;

export interface S3ResourcesConfigShape {
  readonly s3: Record<string, S3ResourceTarget>;
  readonly getS3Resource: (name: string) => Option.Option<S3ResourceTarget>;
}

export class S3ResourcesConfig extends Context.Service<
  S3ResourcesConfig,
  S3ResourcesConfigShape
>()("app/config/S3ResourcesConfig") {}

export interface WebResourcesConfigShape {
  readonly web: Record<string, WebResourceTarget>;
  readonly getWebResource: (name: string) => Option.Option<WebResourceTarget>;
}

export class WebResourcesConfig extends Context.Service<
  WebResourcesConfig,
  WebResourcesConfigShape
>()("app/config/WebResourcesConfig") {}

export interface ResourcesConfigShape
  extends S3ResourcesConfigShape, WebResourcesConfigShape {}

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

export const CooccurrenceConfigSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  window: Schema.optional(Schema.Literals(["sentence", "chunk"])),
  confidence: Schema.optional(Schema.Number),
  relation: Schema.optional(Schema.String),
  maxEdgesPerChunk: Schema.optional(Schema.Number),
});
export type CooccurrenceConfig = typeof CooccurrenceConfigSchema.Type;

export const ExtractionConfigSchema = Schema.Struct({
  dictionary: Schema.optional(Schema.Array(DictionaryEntrySchema)),
  relationPatterns: Schema.optional(Schema.Array(RelationPatternRuleSchema)),
  stopwords: Schema.optional(Schema.Array(Schema.String)),
  cooccurrence: Schema.optional(CooccurrenceConfigSchema),
});
export type ExtractionConfig = typeof ExtractionConfigSchema.Type;

export const ExtractionConfigFields = {
  extraction: Schema.optional(ExtractionConfigSchema),
};
