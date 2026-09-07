import { Schema, SchemaGetter } from "effect";

/**
 * Schema representing arbitrary JSON data lowered to a string for WIT compatibility.
 * Decodes a JSON string into an object; encodes an object to a JSON string on the wire.
 */
export const JsonFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, {
    decode: SchemaGetter.transform((s) => {
      if (!s) return {};
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }),
    encode: SchemaGetter.transform((u) => {
      if (u === undefined || u === null) return "{}";
      return typeof u === "string" ? u : JSON.stringify(u);
    }),
  }),
);

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

export const S3ProcessedKeyEntrySchema = Schema.Struct({
  key: Schema.String,
  etag: Schema.String,
});
export type S3ProcessedKeyEntry = typeof S3ProcessedKeyEntrySchema.Type;

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

export const S3TaskStatusResponseSchema = Schema.Struct({
  resourceName: Schema.String,
  status: S3TaskStatusSchema,
  lastSyncTimestamp: Schema.NullOr(Schema.String),
  processedKeys: Schema.Array(S3ProcessedKeyEntrySchema),
  cursor: Schema.NullOr(Schema.String),
  metrics: S3TaskMetricsSchema,
  errorMessage: Schema.NullOr(Schema.String),
});
export type S3TaskStatusResponse = typeof S3TaskStatusResponseSchema.Type;

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

export const CoordinatorStatusResponseSchema = Schema.Struct({
  schedules: Schema.Array(SyncScheduleSchema),
  aggregatedMetrics: CoordinatorMetricsSchema,
});
export type CoordinatorStatusResponse =
  typeof CoordinatorStatusResponseSchema.Type;

// --- Knowledge Access Agent Schemas ---

export const SearchResultItemSchema = Schema.Struct({
  chunkId: Schema.String,
  documentId: Schema.String,
  content: Schema.String,
  score: Schema.Number,
  metadata: JsonFromString,
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
  properties: JsonFromString,
});
export type EdgeResult = typeof EdgeResultSchema.Type;

export const EntityResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  entityType: Schema.String,
  description: Schema.NullOr(Schema.String),
  properties: JsonFromString,
  metadata: JsonFromString,
});
export type EntityResult = typeof EntityResultSchema.Type;

export const EntitySearchRequestSchema = Schema.Struct({
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
});
export type EntitySearchRequest = typeof EntitySearchRequestSchema.Type;

export const EntitySearchResponseSchema = Schema.Struct({
  entities: Schema.Array(EntityResultSchema),
  total: Schema.Number,
  query: Schema.String,
});
export type EntitySearchResponse = typeof EntitySearchResponseSchema.Type;

export const NeighborhoodResponseSchema = Schema.Struct({
  entities: Schema.optional(Schema.Array(EntityResultSchema)),
  edges: Schema.Array(EdgeResultSchema),
});
export type NeighborhoodResponse = typeof NeighborhoodResponseSchema.Type;

export const DocumentResultSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  metadata: JsonFromString,
  tags: Schema.Array(Schema.String),
  source: Schema.String,
  namespace: Schema.String,
  sizeBytes: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type DocumentResult = typeof DocumentResultSchema.Type;

// --- Path Finding Schemas ---

export const PathFindingQuerySchema = Schema.Struct({
  sourceEntityId: Schema.String,
  targetEntityId: Schema.String,
  maxDepth: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
  direction: Schema.optional(Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"])),
});
export type PathFindingQuery = typeof PathFindingQuerySchema.Type;

export const GraphPathSchema = Schema.Struct({
  entityIds: Schema.Array(Schema.String),
  edges: Schema.Array(EdgeResultSchema),
  totalWeight: Schema.Number,
});
export type GraphPath = typeof GraphPathSchema.Type;

export const PathFindingResultSchema = Schema.Struct({
  paths: Schema.Array(GraphPathSchema),
  entities: Schema.optional(Schema.Array(EntityResultSchema)),
  shortestPathLength: Schema.NullOr(Schema.Number),
});
export type PathFindingResult = typeof PathFindingResultSchema.Type;

// --- GraphRAG Schemas ---

export const GraphRAGQuerySchema = Schema.Struct({
  query: Schema.String,
  topK: Schema.optional(Schema.Number),
  maxHops: Schema.optional(Schema.Number),
  minConfidence: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
});
export type GraphRAGQuery = typeof GraphRAGQuerySchema.Type;

export const GraphRAGContextBundleSchema = Schema.Struct({
  query: Schema.String,
  entities: Schema.Array(EntityResultSchema),
  relationships: Schema.Array(EdgeResultSchema),
  relevantChunks: Schema.Array(SearchResultItemSchema),
  formattedContextPrompt: Schema.String,
  metadata: Schema.Struct({
    totalEntities: Schema.Number,
    totalRelationships: Schema.Number,
    totalChunks: Schema.Number,
    retrievalDurationMs: Schema.Number,
  }),
});
export type GraphRAGContextBundle = typeof GraphRAGContextBundleSchema.Type;

// --- KnowledgeBaseAgent Schemas (Interface Contract) ---

export const CitationSchema = Schema.Struct({
  documentId: Schema.String,
  chunkId: Schema.String,
  sourceUri: Schema.String,
  title: Schema.String,
  excerpt: Schema.String,
});
export type Citation = typeof CitationSchema.Type;

export const AnswerResponseSchema = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
  citations: Schema.Array(CitationSchema),
  groundedEntities: Schema.Array(EntityResultSchema),
  groundedRelationships: Schema.Array(EdgeResultSchema),
  confidenceScore: Schema.Number,
});
export type AnswerResponse = typeof AnswerResponseSchema.Type;

export const KnowledgeBaseOverviewSchema = Schema.Struct({
  totalDocuments: Schema.Number,
  totalChunks: Schema.Number,
  totalEntities: Schema.Number,
  totalRelationships: Schema.Number,
  supportedSources: Schema.Array(Schema.String),
  lastSynchronizedAt: Schema.NullOr(Schema.String),
});
export type KnowledgeBaseOverview = typeof KnowledgeBaseOverviewSchema.Type;

// --- Webhook & Callback Schemas ---

export const WebhookIngestPayloadSchema = Schema.Struct({
  action: Schema.optional(Schema.String),
  force: Schema.optional(Schema.Boolean),
});
export type WebhookIngestPayload = typeof WebhookIngestPayloadSchema.Type;

export const BatchJobCallbackResultSchema = Schema.Struct({
  jobId: Schema.String,
  status: Schema.Literals(["COMPLETED", "FAILED"]),
  processedItems: Schema.Number,
  details: Schema.optional(Schema.String),
});
export type BatchJobCallbackResult = typeof BatchJobCallbackResultSchema.Type;

export const OneShotWebhookHandleResponseSchema = Schema.Struct({
  callbackUrl: Schema.String,
  instructions: Schema.String,
});
export type OneShotWebhookHandleResponse =
  typeof OneShotWebhookHandleResponseSchema.Type;

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
