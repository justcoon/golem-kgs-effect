import { Schema } from "effect";

// --- S3 Ingestion Task Agent Schemas ---

export const S3TaskMetricsSchema = Schema.Struct({
  totalDiscovered: Schema.Number,
  totalSynced: Schema.Number,
  totalFailed: Schema.Number,
  lastDurationMs: Schema.Number,
});
export type S3TaskMetrics = typeof S3TaskMetricsSchema.Type;

export const S3TaskStatusSchema = Schema.Literals([
  "IDLE",
  "SYNCING",
  "COMPLETED",
  "FAILED",
]);
export type S3TaskStatus = typeof S3TaskStatusSchema.Type;

export const S3TaskStateSchema = Schema.Struct({
  resourceName: Schema.String,
  status: S3TaskStatusSchema,
  lastSyncTimestamp: Schema.NullOr(Schema.String),
  processedKeys: Schema.Record(Schema.String, Schema.String),
  cursor: Schema.NullOr(Schema.String),
  metrics: S3TaskMetricsSchema,
  errorMessage: Schema.NullOr(Schema.String),
});
export type S3TaskState = typeof S3TaskStateSchema.Type;

// --- Ingestion Coordinator Agent Schemas ---

export const ScheduleStatusSchema = Schema.Literals([
  "ACTIVE",
  "PAUSED",
  "IDLE",
]);
export type ScheduleStatus = typeof ScheduleStatusSchema.Type;

export const SourceTypeSchema = Schema.Literals([
  "s3",
  // "postgres",
  // "confluence",
  // "web",
  // "github",
  // "custom",
]);
export type SourceType = typeof SourceTypeSchema.Type;

export const toScheduleKey = (
  sourceType: SourceType | string,
  resourceName: string,
): string => `${sourceType}:${resourceName}`;

export const parseScheduleKey = (
  key: string,
): { sourceType: SourceType; resourceName: string } => {
  const idx = key.indexOf(":");
  if (idx === -1) {
    return { sourceType: "s3", resourceName: key };
  }
  return {
    sourceType: key.slice(0, idx) as SourceType,
    resourceName: key.slice(idx + 1),
  };
};

export const TaskRunSummarySchema = Schema.Struct({
  sourceType: SourceTypeSchema,
  resourceName: Schema.String,
  status: Schema.Literals(["COMPLETED", "FAILED"]),
  syncedCount: Schema.Number,
  failedCount: Schema.Number,
  durationMs: Schema.Number,
  errorMessage: Schema.NullOr(Schema.String),
});
export type TaskRunSummary = typeof TaskRunSummarySchema.Type;

export const SyncScheduleSchema = Schema.Struct({
  sourceType: SourceTypeSchema,
  resourceName: Schema.String,
  intervalSeconds: Schema.Number,
  lastScheduledAt: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(Schema.String),
  status: ScheduleStatusSchema,
});
export type SyncSchedule = typeof SyncScheduleSchema.Type;

export const CoordinatorMetricsSchema = Schema.Struct({
  totalRunsTriggered: Schema.Number,
  totalSuccesses: Schema.Number,
  totalFailures: Schema.Number,
});
export type CoordinatorMetrics = typeof CoordinatorMetricsSchema.Type;

export const CoordinatorStateSchema = Schema.Struct({
  schedules: Schema.Record(Schema.String, SyncScheduleSchema),
  aggregatedMetrics: CoordinatorMetricsSchema,
});
export type CoordinatorState = typeof CoordinatorStateSchema.Type;

// --- Knowledge Access Agent Schemas ---

export const SearchResultItemSchema = Schema.Struct({
  chunkId: Schema.String,
  documentId: Schema.String,
  content: Schema.String,
  score: Schema.Number,
  metadata: Schema.Unknown,
});
export type SearchResultItem = typeof SearchResultItemSchema.Type;

export const SearchResponseSchema = Schema.Struct({
  results: Schema.Array(SearchResultItemSchema),
  totalResults: Schema.Number,
  query: Schema.String,
});
export type SearchResponse = typeof SearchResponseSchema.Type;

export const EdgeResultSchema = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.Number,
  confidence: Schema.Number,
  properties: Schema.Unknown,
});
export type EdgeResult = typeof EdgeResultSchema.Type;

export const NeighborhoodResponseSchema = Schema.Struct({
  entityIds: Schema.Array(Schema.String),
  edges: Schema.Array(EdgeResultSchema),
});
export type NeighborhoodResponse = typeof NeighborhoodResponseSchema.Type;

export const EntityResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  entityType: Schema.String,
  description: Schema.NullOr(Schema.String),
  properties: Schema.Unknown,
  metadata: Schema.Unknown,
});
export type EntityResult = typeof EntityResultSchema.Type;

// --- Helper Utilities ---

/**
 * Calculates WIT wall-clock datetime record for Golem native host scheduler (.schedule).
 */
export function calculateScheduledAt(
  intervalSeconds: number,
  fromTimeMillis = Date.now(),
): { seconds: bigint; nanoseconds: number } {
  const atMillis = fromTimeMillis + Math.max(1, intervalSeconds) * 1000;
  return {
    seconds: BigInt(Math.floor(atMillis / 1000)),
    nanoseconds: Math.floor(atMillis % 1000) * 1_000_000,
  };
}
