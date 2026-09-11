import { Effect, HashMap, Option, Ref, Stream } from "effect";
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

    const processedRef = yield* Ref.make<HashMap.HashMap<string, string>>(
      force
        ? HashMap.empty()
        : HashMap.fromIterable(Object.entries(currentState.processedKeys)),
    );

    const discoveredCountRef = yield* Ref.make(0);
    const syncedCountRef = yield* Ref.make(0);
    const failedCountRef = yield* Ref.make(0);

    yield* connector.discoverStream(cursorData).pipe(
      Stream.runForEach((item) =>
        Effect.gen(function* () {
          yield* Ref.update(discoveredCountRef, (n) => n + 1);

          const { document } = yield* connector.fetch(item);
          yield* processAndIndexDocument(document);

          yield* Ref.update(processedRef, (map) =>
            HashMap.set(map, item.id, item.eTag ?? ""),
          );
          const syncedCount = yield* Ref.updateAndGet(
            syncedCountRef,
            (n) => n + 1,
          );

          // Progressive checkpointing every 10 documents
          if (syncedCount % 10 === 0) {
            const currentProcessed = yield* Ref.get(processedRef);
            const failedCount = yield* Ref.get(failedCountRef);
            yield* checkpointRepo
              .saveCheckpoint({
                connectorId: `s3_${resourceName}`,
                cursorData: {
                  lastSyncTimestamp: new Date().toISOString(),
                  processedKeys: Object.fromEntries(currentProcessed),
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
        }).pipe(
          Effect.catch((_err: unknown) =>
            Ref.update(failedCountRef, (n) => n + 1),
          ),
        ),
      ),
    );

    const duration = Date.now() - startTime;
    const nowIso = new Date().toISOString();
    const finalProcessedMap = yield* Ref.get(processedRef);
    const finalProcessedKeys = Object.fromEntries(finalProcessedMap);
    const totalDiscovered = yield* Ref.get(discoveredCountRef);
    const totalSynced = yield* Ref.get(syncedCountRef);
    const totalFailed = yield* Ref.get(failedCountRef);

    const status: "COMPLETED" | "FAILED" =
      totalFailed > 0 && totalSynced === 0 ? "FAILED" : "COMPLETED";
    const errorMessage =
      status === "FAILED"
        ? `Failed to ingest all ${totalFailed} discovered items from resource ${resourceName}`
        : null;

    yield* checkpointRepo
      .saveCheckpoint({
        connectorId: `s3_${resourceName}`,
        cursorData: {
          lastSyncTimestamp: nowIso,
          processedKeys: finalProcessedKeys,
        },
        status,
        metrics: {
          discovered: totalDiscovered,
          synced: totalSynced,
          failed: totalFailed,
          durationMs: duration,
        },
      })
      .pipe(Effect.ignore);

    return {
      status,
      lastSyncTimestamp: nowIso,
      processedKeys: finalProcessedKeys,
      cursor: null,
      metrics: {
        totalDiscovered: currentState.metrics.totalDiscovered + totalDiscovered,
        totalSynced: currentState.metrics.totalSynced + totalSynced,
        totalFailed: currentState.metrics.totalFailed + totalFailed,
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
