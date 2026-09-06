import { Effect, Layer, Option, Redacted } from "effect";
import { defineConfig } from "@golemcloud/effect-golem";
import {
  ResourcesConfigFields,
  ResourcesConfigValues,
  type S3ResourceTarget,
} from "./schema.js";

export class ResourcesConfig extends defineConfig(
  "Resources.Config",
  ResourcesConfigFields,
) {
  static readonly ToValues = Layer.effect(
    ResourcesConfigValues,
    Effect.gen(function* () {
      const config = yield* ResourcesConfig;
      const secret = yield* config.resources.get;
      const val = Redacted.value(secret);
      const s3Targets: Record<string, S3ResourceTarget> = val?.s3 ?? {};

      return {
        s3: s3Targets,
        getS3Resource: (name: string): Option.Option<S3ResourceTarget> => {
          const target = s3Targets[name];
          return target !== undefined ? Option.some(target) : Option.none();
        },
      };
    }),
  );
}
