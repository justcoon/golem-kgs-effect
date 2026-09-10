import { Effect, Option } from "effect";
import { type S3TaskMetrics, type S3TaskState } from "../agents/types.js";
import { type S3CursorData } from "../connectors/connector-base.js";
import { S3ConnectorService } from "../connectors/s3-connector.js";
import { processAndIndexDocument } from "./document-processor.js";
import { EmbeddingService } from "./embedding-service.js";
import { EntityResolverService } from "./entity-resolver.js";
import { ExtractionService } from "./extractor.js";
import {
  CheckpointRepository,
  ChunkRepository,
  DocumentRepository,
} from "../storage/repository-tags.js";

export interface IngestionRunResult {
  readonly status: "COMPLETED" | "FAILED";
  readonly lastSyncTimestamp: string | null;
  readonly processedKeys: Record<string, string>;
  readonly cursor: string | null;
  readonly metrics: S3TaskMetrics;
  readonly errorMessage: string | null;
}

/**
 * Core orchestration logic for S3 ingestion task.
 */
export function runS3Ingestion(
  resourceName: string,
  currentState: S3TaskState,
  options?: { force?: boolean },
): Effect.Effect<
  IngestionRunResult,
  never,
  | S3ConnectorService
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

    const s3Service = yield* S3ConnectorService;
    const checkpointRepo = yield* CheckpointRepository;

    const connector = yield* s3Service.createConnector(resourceName);

    const cursorData: Option.Option<S3CursorData> =
      force || !currentState.lastSyncTimestamp
        ? Option.none()
        : Option.some({
            lastSyncTimestamp: currentState.lastSyncTimestamp,
            processedKeys: currentState.processedKeys,
            continuationToken: currentState.cursor ?? undefined,
          });

    const discoveredItems = yield* connector.discover(cursorData);

    const newProcessedKeys: Record<string, string> = force
      ? {}
      : { ...currentState.processedKeys };

    let syncedCount = 0;
    let failedCount = 0;

    for (const item of discoveredItems) {
      const ok = yield* Effect.match(
        Effect.gen(function* () {
          const { document } = yield* connector.fetch(item);
          yield* processAndIndexDocument(document);
          newProcessedKeys[item.id] = item.eTag ?? "";
          syncedCount++;
        }),
        {
          onFailure: () => false,
          onSuccess: () => true,
        },
      );
      if (!ok) {
        failedCount++;
      }
    }

    const duration = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    yield* checkpointRepo
      .saveCheckpoint({
        connectorId: `s3_${resourceName}`,
        cursorData: {
          lastSyncTimestamp: nowIso,
          processedKeys: newProcessedKeys,
        },
        status: failedCount > 0 && syncedCount === 0 ? "FAILED" : "COMPLETED",
        metrics: {
          discovered: discoveredItems.length,
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
        ? `Failed to ingest all ${failedCount} discovered items from resource ${resourceName}`
        : null;

    return {
      status,
      lastSyncTimestamp: nowIso,
      processedKeys: newProcessedKeys,
      cursor: null,
      metrics: {
        totalDiscovered:
          currentState.metrics.totalDiscovered + discoveredItems.length,
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
        processedKeys: currentState.processedKeys,
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
