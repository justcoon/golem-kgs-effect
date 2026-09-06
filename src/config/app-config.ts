import { Schema } from "effect";

export const AppEnvironment = Schema.Literals(["local", "cloud", "test"]);
export type AppEnvironment = typeof AppEnvironment.Type;

export const AppConfig = Schema.Struct({
  environment: Schema.optional(AppEnvironment),
  logLevel: Schema.optional(
    Schema.Literals(["debug", "info", "warn", "error"]),
  ),
  defaultNamespace: Schema.optional(Schema.String),
});
export type AppConfig = typeof AppConfig.Type;
