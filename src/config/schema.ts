import { Schema } from "effect";

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
