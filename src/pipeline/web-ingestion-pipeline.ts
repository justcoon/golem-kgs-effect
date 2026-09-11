import { Effect, HashMap, Option, Ref, Stream } from "effect";
import {
  type WebProcessedUrlEntry,
  type WebTaskMetrics,
  type WebTaskState,
} from "../agents/types.js";
import { type WebCursorData } from "../connectors/connector-base.js";
import { WebConnectorService } from "../connectors/web-connector.js";
import { processAndIndexDocument } from "./document-processor.js";
import { EmbeddingService } from "./embedding-service.js";
import { EntityResolverService } from "./entity-resolver.js";
import { ExtractionService } from "./extractor.js";
import {
  CheckpointRepository,
  ChunkRepository,
  DocumentRepository,
} from "../storage/repository-tags.js";

export interface WebIngestionRunResult {
  readonly status: "COMPLETED" | "FAILED";
  readonly lastSyncTimestamp: string | null;
  readonly processedUrls: Record<string, WebProcessedUrlEntry>;
  readonly cursor: string | null;
  readonly metrics: WebTaskMetrics;
  readonly errorMessage: string | null;
}

/**
 * Core orchestration logic for Web Page / Documentation ingestion task.
 */
export function runWebIngestion(
  resourceName: string,
  currentState: WebTaskState,
  options?: { force?: boolean },
): Effect.Effect<
  WebIngestionRunResult,
  never,
  | WebConnectorService
  | DocumentRepository
  | ChunkRepository
  | CheckpointRepository
  | EntityResolverService
  | EmbeddingService
  | ExtractionService
> {
  return Effect.gen(function* () {
    const startTime = Date.now();
    const force = options?.force ?? false;

    const webService = yield* WebConnectorService;
    const checkpointRepo = yield* CheckpointRepository;

    const connector = yield* webService.createConnector(resourceName);

    const cursorData: Option.Option<WebCursorData> =
      force || !currentState.lastSyncTimestamp
        ? Option.none()
        : Option.some({
            lastSyncTimestamp: currentState.lastSyncTimestamp,
            processedUrls: currentState.processedUrls,
          });

    const processedRef = yield* Ref.make<
      HashMap.HashMap<string, WebProcessedUrlEntry>
    >(
      force
        ? HashMap.empty()
        : HashMap.fromIterable(Object.entries(currentState.processedUrls)),
    );

    const discoveredCountRef = yield* Ref.make(0);
    const syncedCountRef = yield* Ref.make(0);
    const failedCountRef = yield* Ref.make(0);

    yield* connector.crawlStream(cursorData).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          yield* Ref.update(discoveredCountRef, (n) => n + 1);

          if (event.notModified) {
            yield* Ref.update(processedRef, (map) =>
              HashMap.modifyAt(
                map,
                event.finalUrl,
                Option.map((entry) => ({
                  ...entry,
                  syncedAt: new Date().toISOString(),
                })),
              ),
            );
            yield* Ref.update(syncedCountRef, (n) => n + 1);
            return;
          }

          if (Option.isSome(event.document)) {
            const document = event.document.value;
            yield* processAndIndexDocument(document);

            const meta = (document.metadata ?? {}) as Record<string, unknown>;
            const entry: WebProcessedUrlEntry = {
              etag: typeof meta.etag === "string" ? meta.etag : event.etag,
              lastModified:
                typeof meta.lastModified === "string"
                  ? meta.lastModified
                  : event.lastModified,
              syncedAt: new Date().toISOString(),
            };
            yield* Ref.update(processedRef, (map) =>
              HashMap.set(map, event.finalUrl, entry),
            );
            const syncedCount = yield* Ref.updateAndGet(
              syncedCountRef,
              (n) => n + 1,
            );

            // Progressive checkpointing every 10 pages
            if (syncedCount % 10 === 0) {
              const currentProcessed = yield* Ref.get(processedRef);
              const failedCount = yield* Ref.get(failedCountRef);
              yield* checkpointRepo
                .saveCheckpoint({
                  connectorId: `web_${resourceName}`,
                  cursorData: {
                    lastSyncTimestamp: new Date().toISOString(),
                    processedUrls: Object.fromEntries(currentProcessed),
                  },
                  status: "RUNNING",
                  metrics: {
                    synced: syncedCount,
                    failed: failedCount,
                    durationMs: Date.now() - startTime,
                  },
                })
                .pipe(Effect.ignore);
            }
          }
        }).pipe(
          Effect.catch((err: unknown) =>
            Effect.gen(function* () {
              yield* Ref.update(failedCountRef, (n) => n + 1);
              yield* Effect.logWarning(
                `Failed to process document for ${event.finalUrl}: ${String(err)}`,
              );
            }),
          ),
        ),
      ),
      Effect.catch((err) =>
        Effect.gen(function* () {
          yield* Ref.update(failedCountRef, (n) => n + 1);
          yield* Effect.logWarning(
            `Crawl stream error for resource ${resourceName}: ${String(err)}`,
          );
        }),
      ),
    );

    const duration = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    const finalProcessed = yield* Ref.get(processedRef);
    const finalProcessedUrls: Record<string, WebProcessedUrlEntry> =
      Object.fromEntries(finalProcessed);
    const discoveredCount = yield* Ref.get(discoveredCountRef);
    const syncedCount = yield* Ref.get(syncedCountRef);
    const failedCount = yield* Ref.get(failedCountRef);

    yield* checkpointRepo
      .saveCheckpoint({
        connectorId: `web_${resourceName}`,
        cursorData: {
          lastSyncTimestamp: nowIso,
          processedUrls: finalProcessedUrls,
        },
        status: failedCount > 0 && syncedCount === 0 ? "FAILED" : "COMPLETED",
        metrics: {
          discovered: discoveredCount,
          synced: syncedCount,
          failed: failedCount,
          durationMs: duration,
        },
      })
      .pipe(Effect.ignore);

    const status: "COMPLETED" | "FAILED" =
      failedCount > 0 && syncedCount === 0 ? "FAILED" : "COMPLETED";
    const errorMessage =
      status === "FAILED"
        ? `Failed to ingest all ${failedCount} discovered web pages from resource ${resourceName}`
        : null;

    return {
      status,
      lastSyncTimestamp: nowIso,
      processedUrls: finalProcessedUrls,
      cursor: null,
      metrics: {
        totalDiscovered: currentState.metrics.totalDiscovered + discoveredCount,
        totalSynced: currentState.metrics.totalSynced + syncedCount,
        totalFailed: currentState.metrics.totalFailed + failedCount,
        lastDurationMs: duration,
      },
      errorMessage,
    };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed({
        status: "FAILED" as const,
        lastSyncTimestamp: currentState.lastSyncTimestamp,
        processedUrls: currentState.processedUrls,
        cursor: currentState.cursor,
        metrics: {
          ...currentState.metrics,
          totalFailed: currentState.metrics.totalFailed + 1,
          lastDurationMs: 0,
        },
        errorMessage: String(cause),
      }),
    ),
  );
}
