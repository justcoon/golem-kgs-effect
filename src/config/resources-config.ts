import { Effect, Layer, Option, Redacted } from "effect";
import { defineConfig } from "@golemcloud/effect-golem";
import {
  parseS3Targets,
  parseWebTargets,
  ResourcesConfigFields,
  ResourcesConfigValues,
  S3ResourcesConfig,
  WebResourcesConfig,
  type S3ResourceTarget,
  type WebResourceTarget,
} from "./schema.js";

export { parseS3Targets, parseWebTargets };

export class ResourcesConfig extends defineConfig(
  "Resources.Config",
  ResourcesConfigFields,
) {
  static readonly ToS3Values = Layer.effect(
    S3ResourcesConfig,
    Effect.gen(function* () {
      const config = yield* ResourcesConfig;
      const secret = yield* config.resources.s3.get;
      const val = Redacted.value(secret);
      const s3Targets = parseS3Targets(val);

      return {
        s3: s3Targets,
        getS3Resource: (name: string): Option.Option<S3ResourceTarget> =>
          Option.fromNullishOr(s3Targets[name]),
      };
    }),
  );

  static readonly ToWebValues = Layer.effect(
    WebResourcesConfig,
    Effect.gen(function* () {
      const config = yield* ResourcesConfig;
      const secret = yield* config.resources.web.get;
      const val = Redacted.value(secret);
      const webTargets = parseWebTargets(val);

      return {
        web: webTargets,
        getWebResource: (name: string): Option.Option<WebResourceTarget> =>
          Option.fromNullishOr(webTargets[name]),
      };
    }),
  );

  static readonly ToValues = Layer.effect(
    ResourcesConfigValues,
    Effect.gen(function* () {
      const config = yield* ResourcesConfig;
      const s3Secret = yield* config.resources.s3.get;
      const webSecret = yield* config.resources.web.get;
      const s3Targets = parseS3Targets(Redacted.value(s3Secret));
      const webTargets = parseWebTargets(Redacted.value(webSecret));

      return {
        s3: s3Targets,
        web: webTargets,
        getS3Resource: (name: string): Option.Option<S3ResourceTarget> =>
          Option.fromNullishOr(s3Targets[name]),
        getWebResource: (name: string): Option.Option<WebResourceTarget> =>
          Option.fromNullishOr(webTargets[name]),
      };
    }),
  );
}
