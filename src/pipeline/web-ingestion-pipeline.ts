import { Effect, Option } from "effect";
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

    const newProcessedUrls: Record<string, WebProcessedUrlEntry> = force
      ? {}
      : { ...currentState.processedUrls };

    let syncedCount = 0;
    let failedCount = 0;

    const crawlResult = yield* connector
      .crawlOnTheFly(cursorData, (event) =>
        Effect.gen(function* () {
          if (event.notModified) {
            const existing = newProcessedUrls[event.finalUrl];
            if (existing) {
              newProcessedUrls[event.finalUrl] = {
                ...existing,
                syncedAt: new Date().toISOString(),
              };
            }
            syncedCount++;
            return;
          }

          if (Option.isSome(event.document)) {
            const document = event.document.value;
            yield* processAndIndexDocument(document);

            const meta = (document.metadata ?? {}) as Record<string, unknown>;
            newProcessedUrls[event.finalUrl] = {
              url: event.finalUrl,
              etag: typeof meta.etag === "string" ? meta.etag : event.etag,
              lastModified:
                typeof meta.lastModified === "string"
                  ? meta.lastModified
                  : event.lastModified,
              contentHash:
                typeof meta.contentHash === "string"
                  ? meta.contentHash
                  : undefined,
              syncedAt: new Date().toISOString(),
            };
            syncedCount++;

            // Progressive checkpointing every 10 pages
            if (syncedCount % 10 === 0) {
              yield* checkpointRepo
                .saveCheckpoint({
                  connectorId: `web_${resourceName}`,
                  cursorData: {
                    lastSyncTimestamp: new Date().toISOString(),
                    processedUrls: newProcessedUrls,
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
          Effect.catch((err: unknown) => {
            failedCount++;
            return Effect.logWarning(
              `Failed to process document for ${event.finalUrl}: ${String(err)}`,
            );
          }),
        ),
      )
      .pipe(
        Effect.catch(() => {
          failedCount++;
          return Effect.succeed({
            discovered: 0,
            synced: syncedCount,
            failed: failedCount,
          });
        }),
      );

    const duration = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    yield* checkpointRepo
      .saveCheckpoint({
        connectorId: `web_${resourceName}`,
        cursorData: {
          lastSyncTimestamp: nowIso,
          processedUrls: newProcessedUrls,
        },
        status: failedCount > 0 && syncedCount === 0 ? "FAILED" : "COMPLETED",
        metrics: {
          discovered: crawlResult.discovered,
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
      processedUrls: newProcessedUrls,
      cursor: null,
      metrics: {
        totalDiscovered:
          currentState.metrics.totalDiscovered + crawlResult.discovered,
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
