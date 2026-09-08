import { Effect, Layer } from "effect";
import { defineConfig } from "@golemcloud/effect-golem";
import { EmbeddingConfigFields, EmbeddingConfigValues } from "./schema.js";

export class EmbeddingConfig extends defineConfig(
  "Embedding.Config",
  EmbeddingConfigFields,
) {
  static readonly ToValues = Layer.effect(
    EmbeddingConfigValues,
    Effect.gen(function* () {
      const config = yield* EmbeddingConfig;
      const api_base = yield* config.embedding.api_base;
      const model = yield* config.embedding.model;
      const apiKey = yield* config.embedding.apiKey.get;
      return {
        api_base,
        model,
        apiKey,
      };
    }),
  );
}
