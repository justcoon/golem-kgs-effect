import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  parseS3Targets,
  parseWebTargets,
  S3ResourcesConfig,
  WebResourcesConfig,
} from "../config/schema.js";
import type { AppAgentConfigService } from "../config/agent-config.js";
import { S3ConnectorService } from "../connectors/s3-connector.js";
import { WebConnectorService } from "../connectors/web-connector.js";
import { ConnectorError } from "../connectors/connector-base.js";

export { parseS3Targets, parseWebTargets };

/**
 * Builds the S3 connector service layer configured strictly for a specific S3 resource target.
 */
export const makeS3ConnectorLayer = (
  config: AppAgentConfigService,
  resourceName: string,
) =>
  Effect.gen(function* () {
    const resourcesVal = Redacted.value(yield* config.resources.s3.get);
    const s3Targets = parseS3Targets(resourcesVal);
    const target = s3Targets[resourceName];

    if (!target) {
      return yield* Effect.fail(
        new ConnectorError({
          connectorId: `s3_${resourceName}`,
          message: `S3 resource target '${resourceName}' is not configured in secrets`,
        }),
      );
    }

    const scopedTargets = { [resourceName]: target };
    const s3ConfigLayer = Layer.succeed(S3ResourcesConfig, {
      s3: scopedTargets,
      getS3Resource: (name: string) =>
        name === resourceName ? Option.some(target) : Option.none(),
    });

    const httpLayer = FetchHttpClient.layer;
    return S3ConnectorService.Live.pipe(
      Layer.provide(s3ConfigLayer),
      Layer.provide(httpLayer),
    );
  });

/**
 * Builds the Web connector service layer configured strictly for a specific Web resource target.
 */
export const makeWebConnectorLayer = (
  config: AppAgentConfigService,
  resourceName: string,
) =>
  Effect.gen(function* () {
    const resourcesVal = Redacted.value(yield* config.resources.web.get);
    const webTargets = parseWebTargets(resourcesVal);
    const target = webTargets[resourceName];

    if (!target) {
      return yield* Effect.fail(
        new ConnectorError({
          connectorId: `web:${resourceName}`,
          message: `Web resource target '${resourceName}' is not configured in secrets`,
        }),
      );
    }

    const scopedTargets = { [resourceName]: target };
    const webConfigLayer = Layer.succeed(WebResourcesConfig, {
      web: scopedTargets,
      getWebResource: (name: string) =>
        name === resourceName ? Option.some(target) : Option.none(),
    });

    const httpLayer = FetchHttpClient.layer;
    return WebConnectorService.Live.pipe(
      Layer.provide(webConfigLayer),
      Layer.provide(httpLayer),
    );
  });
