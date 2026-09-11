import { Effect, Layer, Option, Redacted } from "effect";
import { defineConfig } from "@golemcloud/effect-golem";
import {
  ResourcesConfigFields,
  ResourcesConfigValues,
  S3ResourcesConfig,
  WebResourcesConfig,
  type S3ResourceTarget,
  type WebResourceTarget,
} from "./schema.js";

function parseS3Targets(val: unknown): Record<string, S3ResourceTarget> {
  const s3Raw = (val as { s3?: unknown })?.s3;
  const s3Entries: [string, S3ResourceTarget][] = Array.isArray(s3Raw)
    ? s3Raw.map((target: S3ResourceTarget) => [target.name, target])
    : s3Raw instanceof Map
      ? Array.from(s3Raw.entries())
      : typeof s3Raw === "object" && s3Raw !== null
        ? Object.entries(s3Raw as Record<string, S3ResourceTarget>)
        : [];
  return Object.fromEntries(s3Entries);
}

function parseWebTargets(val: unknown): Record<string, WebResourceTarget> {
  const webRaw = (val as { web?: unknown })?.web;
  const webEntries: [string, WebResourceTarget][] = Array.isArray(webRaw)
    ? webRaw.map((target: WebResourceTarget) => [target.name, target])
    : webRaw instanceof Map
      ? Array.from(webRaw.entries())
      : typeof webRaw === "object" && webRaw !== null
        ? Object.entries(webRaw as Record<string, WebResourceTarget>)
        : [];
  return Object.fromEntries(webEntries);
}

export class ResourcesConfig extends defineConfig(
  "Resources.Config",
  ResourcesConfigFields,
) {
  static readonly ToS3Values = Layer.effect(
    S3ResourcesConfig,
    Effect.gen(function* () {
      const config = yield* ResourcesConfig;
      const secret = yield* config.resources.get;
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
      const secret = yield* config.resources.get;
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
      const secret = yield* config.resources.get;
      const val = Redacted.value(secret);
      const s3Targets = parseS3Targets(val);
      const webTargets = parseWebTargets(val);

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
