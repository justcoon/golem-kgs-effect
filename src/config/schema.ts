import { Context, Redacted, Schema } from "effect";

export const DatabaseConfigFields = {
  db: Schema.Struct({
    host: Schema.String,
    db: Schema.String,
    port: Schema.Union([Schema.String, Schema.Number]),
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
