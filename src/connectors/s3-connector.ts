import { Context, Effect, Layer, Option } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  ConnectorError,
  type DiscoveredItem,
  type ExtractedDocument,
  type S3CursorData,
  type SourceConnector,
} from "./connector-base.js";
import {
  buildS3Url,
  parseListBucketResultXml,
  signS3Request,
} from "./s3-signer.js";
import {
  type S3ResourceTarget,
  ResourcesConfigValues,
} from "../config/schema.js";
import {
  type RawDocument,
  type ProvenanceRecord,
} from "../domain/provenance.js";
import {
  type SaveCheckpointInput,
  type SyncStatus,
} from "../domain/connector.js";

export const DEFAULT_SUPPORTED_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".csv",
  ".xml",
  ".html",
  ".htm",
];

export interface S3ConnectorOptions {
  readonly target: S3ResourceTarget;
  readonly prefix?: string;
  readonly prefixes?: ReadonlyArray<string>;
  readonly supportedExtensions?: ReadonlyArray<string>;
}

function extractTitle(content: string, key: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const heading = headingMatch?.[1]?.trim();
  if (heading && heading.length > 0) {
    return heading;
  }
  const filename = key.split("/").pop() ?? key;
  return filename.replace(/\.[^.]+$/, "");
}

function getFileExtension(filename: string): string {
  const match = filename.match(/\.([0-9a-z]+)(?:[?#]|$)/i);
  return match?.[1] ? match[1].toLowerCase() : "unknown";
}

function hasSupportedExtension(
  key: string,
  extensions: ReadonlyArray<string>,
): boolean {
  const lower = key.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
}

export class S3Connector implements SourceConnector<
  S3ResourceTarget,
  S3CursorData,
  DiscoveredItem
> {
  readonly id: string;
  readonly source = "s3";
  readonly target: S3ResourceTarget;
  readonly prefix: string;
  readonly prefixes: ReadonlyArray<string>;
  readonly supportedExtensions: ReadonlyArray<string>;
  private readonly httpClient: HttpClient.HttpClient;

  constructor(options: S3ConnectorOptions, httpClient: HttpClient.HttpClient) {
    this.target = options.target;
    if (options.prefixes && options.prefixes.length > 0) {
      this.prefixes = options.prefixes;
    } else if (options.target.prefixes && options.target.prefixes.length > 0) {
      this.prefixes = options.target.prefixes;
    } else if (options.prefix && options.prefix.length > 0) {
      this.prefixes = [options.prefix];
    } else {
      this.prefixes = [""];
    }
    this.prefix = this.prefixes[0] ?? "";
    this.supportedExtensions =
      options.supportedExtensions ?? DEFAULT_SUPPORTED_EXTENSIONS;
    this.httpClient = httpClient;
    this.id = `s3_${this.target.bucket}_${this.target.region}`;
  }

  connect(): Effect.Effect<void, ConnectorError> {
    const url = buildS3Url(this.target.endpoint, this.target.bucket, "", {
      "list-type": "2",
      "max-keys": "1",
    });

    const headers = signS3Request({
      method: "GET",
      url,
      region: this.target.region,
      accessKeyId: this.target.accessKeyId,
      secretAccessKey: this.target.secretAccessKey,
    });

    const request = HttpClientRequest.get(url.toString()).pipe(
      HttpClientRequest.setHeaders(headers),
    );

    return this.httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.asVoid,
      Effect.mapError(
        (err) =>
          new ConnectorError({
            connectorId: this.id,
            message: `Failed to connect to S3 bucket '${this.target.bucket}' at ${this.target.endpoint}: ${String(err)}`,
            cause: err,
          }),
      ),
    );
  }

  discover(
    cursor: Option.Option<S3CursorData>,
  ): Effect.Effect<ReadonlyArray<DiscoveredItem>, ConnectorError> {
    const { id, prefixes, target, supportedExtensions, httpClient } = this;
    return Effect.gen(function* () {
      const cursorVal = Option.getOrUndefined(cursor);
      const lastSyncTime = cursorVal
        ? new Date(cursorVal.lastSyncTimestamp).getTime()
        : 0;
      const processedKeys = cursorVal?.processedKeys ?? {};

      const discovered: DiscoveredItem[] = [];
      const seenIds = new Set<string>();

      for (const scanPrefix of prefixes) {
        let isTruncated = true;
        let continuationToken: string | undefined = undefined;

        while (isTruncated) {
          const queryParams: Record<string, string> = {
            "list-type": "2",
            "max-keys": "1000",
          };
          if (scanPrefix.length > 0) {
            queryParams["prefix"] = scanPrefix;
          }
          if (continuationToken) {
            queryParams["continuation-token"] = continuationToken;
          }

          const url = buildS3Url(
            target.endpoint,
            target.bucket,
            "",
            queryParams,
          );

          const headers = signS3Request({
            method: "GET",
            url,
            region: target.region,
            accessKeyId: target.accessKeyId,
            secretAccessKey: target.secretAccessKey,
          });

          const request = HttpClientRequest.get(url.toString()).pipe(
            HttpClientRequest.setHeaders(headers),
          );

          const response = yield* httpClient.execute(request).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.mapError(
              (err) =>
                new ConnectorError({
                  connectorId: id,
                  message: `Failed to list objects in bucket '${target.bucket}': ${String(err)}`,
                  cause: err,
                }),
            ),
          );

          const xmlText = yield* response.text.pipe(
            Effect.mapError(
              (err) =>
                new ConnectorError({
                  connectorId: id,
                  message: `Failed to read ListObjectsV2 response body: ${String(err)}`,
                  cause: err,
                }),
            ),
          );

          const parsed = parseListBucketResultXml(xmlText);

          for (const obj of parsed.objects) {
            if (seenIds.has(obj.key)) {
              continue;
            }
            if (!hasSupportedExtension(obj.key, supportedExtensions)) {
              continue;
            }

            const objTime = obj.lastModified.getTime();
            const knownEtag = processedKeys[obj.key];

            // Incremental check: skip if timestamp <= lastSyncTime AND etag matches
            if (
              knownEtag &&
              knownEtag === obj.etag &&
              objTime <= lastSyncTime
            ) {
              continue;
            }

            seenIds.add(obj.key);
            discovered.push({
              id: obj.key,
              uri: `s3://${target.bucket}/${obj.key}`,
              sizeBytes: obj.size,
              eTag: obj.etag,
              lastModified: obj.lastModified,
              metadata: {
                bucket: target.bucket,
                region: target.region,
                endpoint: target.endpoint,
              },
            });
          }

          isTruncated = parsed.isTruncated;
          continuationToken = parsed.nextContinuationToken;
        }
      }

      return discovered;
    });
  }

  fetch(
    item: DiscoveredItem,
  ): Effect.Effect<ExtractedDocument, ConnectorError> {
    const { id, target, httpClient } = this;
    return Effect.gen(function* () {
      const url = buildS3Url(target.endpoint, target.bucket, item.id);

      const headers = signS3Request({
        method: "GET",
        url,
        region: target.region,
        accessKeyId: target.accessKeyId,
        secretAccessKey: target.secretAccessKey,
      });

      const request = HttpClientRequest.get(url.toString()).pipe(
        HttpClientRequest.setHeaders(headers),
      );

      const response = yield* httpClient.execute(request).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.mapError(
          (err) =>
            new ConnectorError({
              connectorId: id,
              message: `Failed to fetch object '${item.id}' from bucket '${target.bucket}': ${String(err)}`,
              cause: err,
            }),
        ),
      );

      const content = yield* response.text.pipe(
        Effect.mapError(
          (err) =>
            new ConnectorError({
              connectorId: id,
              message: `Failed to read object content for '${item.id}': ${String(err)}`,
              cause: err,
            }),
        ),
      );

      const title = extractTitle(content, item.id);
      const ext = getFileExtension(item.id);
      const safeKeyId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const docId = `doc_s3_${target.bucket}_${safeKeyId}`;

      const document: RawDocument = {
        id: docId,
        title,
        content,
        metadata: {
          bucket: target.bucket,
          key: item.id,
          eTag: item.eTag,
          sizeBytes: item.sizeBytes,
          lastModified: item.lastModified.toISOString(),
          region: target.region,
          endpoint: target.endpoint,
        },
        tags: ["s3", target.bucket, ext],
        source: "s3",
        namespace: target.bucket,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        createdAt: item.lastModified,
        updatedAt: new Date(),
      };

      const provenance: ProvenanceRecord = {
        source: "s3",
        documentId: docId,
        uri: item.uri,
        timestamp: item.lastModified,
        extractor: "S3Connector",
        extractionConfidence: 1.0,
      };

      return {
        document,
        provenance,
      };
    });
  }

  checkpoint(
    cursor: S3CursorData,
    status?: SyncStatus,
    metrics?: Record<string, unknown>,
  ): SaveCheckpointInput {
    return {
      connectorId: this.id,
      cursorData: {
        lastSyncTimestamp: cursor.lastSyncTimestamp,
        processedKeys: cursor.processedKeys,
        continuationToken: cursor.continuationToken,
      },
      status: status ?? "IDLE",
      metrics: metrics ?? {},
    };
  }
}

export interface S3ConnectorServiceShape {
  readonly createConnector: (
    targetOrName: S3ResourceTarget | string,
    prefixOrPrefixes?: string | ReadonlyArray<string>,
  ) => Effect.Effect<
    SourceConnector<S3ResourceTarget, S3CursorData, DiscoveredItem>,
    ConnectorError
  >;
}

export class S3ConnectorService extends Context.Service<
  S3ConnectorService,
  S3ConnectorServiceShape
>()("app/connectors/S3ConnectorService") {
  static readonly Live = Layer.effect(
    S3ConnectorService,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const resourcesConfig = yield* ResourcesConfigValues;

      return {
        createConnector: (
          targetOrName: S3ResourceTarget | string,
          prefixOrPrefixes?: string | ReadonlyArray<string>,
        ) =>
          Effect.gen(function* () {
            let target: S3ResourceTarget;
            if (typeof targetOrName === "string") {
              const resOpt = resourcesConfig.getS3Resource(targetOrName);
              if (Option.isNone(resOpt)) {
                return yield* new ConnectorError({
                  connectorId: `s3_${targetOrName}`,
                  message: `S3 resource '${targetOrName}' not found in resources configuration`,
                });
              }
              target = resOpt.value;
            } else {
              target = targetOrName;
            }

            const prefix =
              typeof prefixOrPrefixes === "string"
                ? prefixOrPrefixes
                : undefined;
            const prefixes = Array.isArray(prefixOrPrefixes)
              ? prefixOrPrefixes
              : undefined;

            return new S3Connector({ target, prefix, prefixes }, httpClient);
          }),
      };
    }),
  );

  static readonly Mock = (
    mockFiles: Record<
      string,
      {
        readonly content: string;
        readonly lastModified?: Date;
        readonly etag?: string;
      }
    > = {},
    mockResources: Record<
      string,
      {
        readonly prefixes?: ReadonlyArray<string>;
      }
    > = {},
  ) =>
    Layer.succeed(S3ConnectorService, {
      createConnector: (
        targetOrName: S3ResourceTarget | string,
        prefixOrPrefixes?: string | ReadonlyArray<string>,
      ) => {
        const resourceTarget =
          typeof targetOrName === "string"
            ? mockResources[targetOrName]
            : targetOrName;

        const scanPrefixes: ReadonlyArray<string> = Array.isArray(
          prefixOrPrefixes,
        )
          ? prefixOrPrefixes
          : typeof prefixOrPrefixes === "string" && prefixOrPrefixes.length > 0
            ? [prefixOrPrefixes]
            : resourceTarget?.prefixes && resourceTarget.prefixes.length > 0
              ? resourceTarget.prefixes
              : [""];

        return Effect.succeed({
          id:
            typeof targetOrName === "string"
              ? `mock_s3_${targetOrName}`
              : `mock_s3_${targetOrName.bucket}`,
          source: "s3",
          connect: () => Effect.void,
          discover: (cursor: Option.Option<S3CursorData>) =>
            Effect.sync(() => {
              const cursorVal = Option.getOrUndefined(cursor);
              const lastSyncTime = cursorVal
                ? new Date(cursorVal.lastSyncTimestamp).getTime()
                : 0;
              const processedKeys = cursorVal?.processedKeys ?? {};

              const bucketName =
                typeof targetOrName === "string"
                  ? targetOrName
                  : targetOrName.bucket;

              const items: DiscoveredItem[] = [];

              for (const [key, entry] of Object.entries(mockFiles)) {
                const matchesPrefix =
                  scanPrefixes.length === 0 ||
                  scanPrefixes.some((p) => p.length === 0 || key.startsWith(p));
                if (!matchesPrefix) {
                  continue;
                }
                const lm = entry.lastModified ?? new Date(0);
                const etag = entry.etag ?? `mock_etag_${key}`;

                if (
                  processedKeys[key] &&
                  processedKeys[key] === etag &&
                  lm.getTime() <= lastSyncTime
                ) {
                  continue;
                }

                items.push({
                  id: key,
                  uri: `s3://${bucketName}/${key}`,
                  sizeBytes: Buffer.byteLength(entry.content, "utf8"),
                  eTag: etag,
                  lastModified: lm,
                  metadata: { bucket: bucketName, key },
                });
              }

              return items;
            }),
          fetch: (item: DiscoveredItem) =>
            Effect.gen(function* () {
              const entry = mockFiles[item.id];
              if (!entry) {
                return yield* new ConnectorError({
                  connectorId: "mock_s3",
                  message: `Object '${item.id}' not found in mock S3 store`,
                });
              }

              const bucketName =
                typeof targetOrName === "string"
                  ? targetOrName
                  : targetOrName.bucket;
              const title = extractTitle(entry.content, item.id);
              const ext = getFileExtension(item.id);
              const safeKeyId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_");
              const docId = `doc_s3_${bucketName}_${safeKeyId}`;

              const document: RawDocument = {
                id: docId,
                title,
                content: entry.content,
                metadata: {
                  bucket: bucketName,
                  key: item.id,
                  eTag: item.eTag,
                  sizeBytes: item.sizeBytes,
                  lastModified: item.lastModified.toISOString(),
                },
                tags: ["s3", bucketName, ext],
                source: "s3",
                namespace: bucketName,
                sizeBytes: Buffer.byteLength(entry.content, "utf8"),
                createdAt: item.lastModified,
                updatedAt: new Date(),
              };

              const provenance: ProvenanceRecord = {
                source: "s3",
                documentId: docId,
                uri: item.uri,
                timestamp: item.lastModified,
                extractor: "S3Connector.Mock",
                extractionConfidence: 1.0,
              };

              return { document, provenance };
            }),
          checkpoint: (
            cursor: S3CursorData,
            status?: SyncStatus,
            metrics?: Record<string, unknown>,
          ) => ({
            connectorId:
              typeof targetOrName === "string"
                ? `mock_s3_${targetOrName}`
                : `mock_s3_${targetOrName.bucket}`,
            cursorData: {
              lastSyncTimestamp: cursor.lastSyncTimestamp,
              processedKeys: cursor.processedKeys,
              continuationToken: cursor.continuationToken,
            },
            status: status ?? "IDLE",
            metrics: metrics ?? {},
          }),
        });
      },
    });
}
