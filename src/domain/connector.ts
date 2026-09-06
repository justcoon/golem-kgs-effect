import { Schema } from "effect";

export const SyncStatus = Schema.Literals([
  "IDLE",
  "RUNNING",
  "FAILED",
  "COMPLETED",
]);
export type SyncStatus = typeof SyncStatus.Type;

export const SyncCheckpoint = Schema.Struct({
  connectorId: Schema.String,
  cursorData: Schema.Record(Schema.String, Schema.Unknown),
  lastSyncTime: Schema.Date,
  status: SyncStatus,
  metrics: Schema.Record(Schema.String, Schema.Unknown),
  updatedAt: Schema.Date,
});
export type SyncCheckpoint = typeof SyncCheckpoint.Type;

export const SaveCheckpointInput = Schema.Struct({
  connectorId: Schema.String,
  cursorData: Schema.Record(Schema.String, Schema.Unknown),
  status: Schema.optional(SyncStatus),
  metrics: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type SaveCheckpointInput = typeof SaveCheckpointInput.Type;

export const ConnectorConfig = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  endpoint: Schema.optional(Schema.String),
  bucket: Schema.optional(Schema.String),
  prefix: Schema.optional(Schema.String),
  pollIntervalSeconds: Schema.optional(Schema.Number),
  enabled: Schema.optional(Schema.Boolean),
});
export type ConnectorConfig = typeof ConnectorConfig.Type;
