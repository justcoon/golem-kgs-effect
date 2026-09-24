import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  parseS3Targets,
  parseWebTargets,
  S3ResourceConfig,
  WebResourceConfig,
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

    return S3ConnectorService.Live.pipe(
      Layer.provide(Layer.succeed(S3ResourceConfig, target)),
      Layer.provide(FetchHttpClient.layer),
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

    return WebConnectorService.Live.pipe(
      Layer.provide(Layer.succeed(WebResourceConfig, target)),
      Layer.provide(FetchHttpClient.layer),
    );
  });
