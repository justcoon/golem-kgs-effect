import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Pg } from "@golemcloud/effect-golem/postgres";
import {
  type SaveCheckpointInput,
  type SyncCheckpoint,
  type SyncStatus,
} from "../domain/connector.js";

interface CheckpointRow {
  readonly connector_id: string;
  readonly cursor_data: unknown;
  readonly last_sync_time: Date | string;
  readonly status: string;
  readonly metrics: unknown;
  readonly updated_at: Date | string;
}

const mapCheckpointRow = (row: CheckpointRow): SyncCheckpoint => ({
  connectorId: row.connector_id,
  cursorData:
    typeof row.cursor_data === "string"
      ? JSON.parse(row.cursor_data)
      : ((row.cursor_data as Record<string, unknown>) ?? {}),
  lastSyncTime: new Date(row.last_sync_time),
  status: row.status as SyncStatus,
  metrics:
    typeof row.metrics === "string"
      ? JSON.parse(row.metrics)
      : ((row.metrics as Record<string, unknown>) ?? {}),
  updatedAt: new Date(row.updated_at),
});

import {
  CheckpointRepository,
  type CheckpointRepositoryShape,
} from "./repository-tags.js";
export { CheckpointRepository, type CheckpointRepositoryShape };

CheckpointRepository.Default = Layer.effect(
  CheckpointRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const saveCheckpoint = (input: SaveCheckpointInput) =>
      Effect.gen(function* () {
        const cursor = Pg.jsonb(input.cursorData);
        const status = input.status ?? "IDLE";
        const metrics = Pg.jsonb(input.metrics ?? {});

        const rows = (yield* sql<CheckpointRow>`
            INSERT INTO sync_checkpoints (connector_id, cursor_data, last_sync_time, status, metrics, updated_at)
            VALUES (${input.connectorId}, ${cursor}, NOW(), ${status}, ${metrics}, NOW())
            ON CONFLICT (connector_id) DO UPDATE SET
              cursor_data = EXCLUDED.cursor_data,
              last_sync_time = NOW(),
              status = EXCLUDED.status,
              metrics = EXCLUDED.metrics,
              updated_at = NOW()
            RETURNING connector_id, cursor_data, last_sync_time, status, metrics, updated_at
          `) as ReadonlyArray<CheckpointRow>;

        const row = rows[0];
        if (!row) {
          return yield* Effect.die(new Error("Failed to save sync checkpoint"));
        }
        return mapCheckpointRow(row);
      });

    const getCheckpoint = (connectorId: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<CheckpointRow>`
            SELECT connector_id, cursor_data, last_sync_time, status, metrics, updated_at
            FROM sync_checkpoints
            WHERE connector_id = ${connectorId}
            LIMIT 1
          `) as ReadonlyArray<CheckpointRow>;

        const row = rows[0];
        return row ? Option.some(mapCheckpointRow(row)) : Option.none();
      });

    const listCheckpoints = () =>
      Effect.gen(function* () {
        const rows = (yield* sql<CheckpointRow>`
            SELECT connector_id, cursor_data, last_sync_time, status, metrics, updated_at
            FROM sync_checkpoints
            ORDER BY last_sync_time DESC
          `) as ReadonlyArray<CheckpointRow>;

        return rows.map(mapCheckpointRow);
      });

    const deleteCheckpoint = (connectorId: string) =>
      Effect.gen(function* () {
        const affected = (yield* sql`
            DELETE FROM sync_checkpoints WHERE connector_id = ${connectorId}
          `.raw) as bigint | number;

        return Number(affected) > 0;
      });

    return {
      saveCheckpoint,
      getCheckpoint,
      listCheckpoints,
      deleteCheckpoint,
    };
  }),
);
