import { Effect, Layer, Option, Redacted } from "effect";
import { defineConfig } from "@golemcloud/effect-golem";
import {
  ResourcesConfigFields,
  ResourcesConfigValues,
  type S3ResourceTarget,
  type WebResourceTarget,
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
      const s3Raw = val?.s3 as any;
      const s3Entries: [string, S3ResourceTarget][] = Array.isArray(s3Raw)
        ? s3Raw.map((target: S3ResourceTarget) => [target.name, target])
        : s3Raw instanceof Map
          ? Array.from(s3Raw.entries())
          : typeof s3Raw === "object" && s3Raw !== null
            ? Object.entries(s3Raw)
            : [];
      const s3Targets: Record<string, S3ResourceTarget> =
        Object.fromEntries(s3Entries);

      const webRaw = val?.web as any;
      const webEntries: [string, WebResourceTarget][] = Array.isArray(webRaw)
        ? webRaw.map((target: WebResourceTarget) => [target.name, target])
        : webRaw instanceof Map
          ? Array.from(webRaw.entries())
          : typeof webRaw === "object" && webRaw !== null
            ? Object.entries(webRaw)
            : [];
      const webTargets: Record<string, WebResourceTarget> =
        Object.fromEntries(webEntries);

      return {
        s3: s3Targets,
        web: webTargets,
        getS3Resource: (name: string): Option.Option<S3ResourceTarget> => {
          const target = s3Targets[name];
          return target !== undefined ? Option.some(target) : Option.none();
        },
        getWebResource: (name: string): Option.Option<WebResourceTarget> => {
          const target = webTargets[name];
          return target !== undefined ? Option.some(target) : Option.none();
        },
      };
    }),
  );
}
