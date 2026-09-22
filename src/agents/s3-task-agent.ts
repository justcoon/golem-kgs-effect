import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import {
  calculateScheduledAt,
  S3TaskStateSchema,
  S3TaskStatusResponseSchema,
  type S3TaskState,
  type S3TaskStatusResponse,
} from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import { makeS3TaskAgentLayer } from "./agent-pipeline-layer.js";
import { runS3Ingestion } from "../pipeline/s3-ingestion-pipeline.js";
import { CheckpointRepository } from "../storage/index.js";

const toStatusResponse = (s: S3TaskState): S3TaskStatusResponse => ({
  resourceName: s.resourceName,
  status: s.status,
  lastSyncTimestamp: s.lastSyncTimestamp,
  cursor: s.cursor,
  metrics: s.metrics,
  errorMessage: s.errorMessage,
  scheduleRunning: s.scheduleRunning ?? false,
  scheduleIntervalSeconds: s.scheduleIntervalSeconds ?? null,
  lastScheduledAt: s.lastScheduledAt ?? null,
});

export const S3IngestorTaskAgentDefinition = defineAgent({
  name: "S3IngestorTaskAgent",
  description:
    "Durable S3 ingestion task worker bound 1:1 to an S3 resource target",
  mode: "durable",
  config: AppAgentConfig,
  constructorParams: {
    resourceName: Schema.String,
  },
  http: Http.mount("/api/ingestion/s3/{resourceName}", { cors: ["*"] }),
  snapshot: Snapshot.define({
    schema: S3TaskStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    sync: method({
      params: {
        force: Schema.optional(Schema.Boolean),
      },
      success: S3TaskStatusResponseSchema,
      description:
        "Executes full or incremental synchronization of the bound S3 resource",
      http: [Http.post("/sync")],
    }),
    getStatus: method({
      params: {},
      success: S3TaskStatusResponseSchema,
      description: "Returns the current synchronization state and metrics",
      http: [Http.get("/status")],
    }),
    resetCursor: method({
      params: {},
      success: S3TaskStatusResponseSchema,
      description:
        "Resets the sync cursor to force a full rescan on the next sync",
      http: [Http.post("/reset")],
    }),
    startSchedule: method({
      params: {
        intervalSeconds: Schema.Number,
      },
      success: S3TaskStatusResponseSchema,
      description: "Starts recurring synchronization for this S3 resource",
      http: [Http.post("/schedule/start")],
    }),
    stopSchedule: method({
      params: {},
      success: S3TaskStatusResponseSchema,
      description: "Stops recurring synchronization for this S3 resource",
      http: [Http.post("/schedule/stop")],
    }),
    scheduledTick: method({
      params: {},
      success: Schema.Boolean,
      description:
        "Called by Golem host timer to execute scheduled sync and schedule next cycle",
    }),
  },
});

export const S3IngestorTaskAgent = S3IngestorTaskAgentDefinition.implement(
  ({ resourceName }, snapshot) =>
    Effect.gen(function* () {
      const config = yield* AppAgentConfig;
      const pipelineLayer = yield* makeS3TaskAgentLayer(config, resourceName);

      const state = yield* snapshot.init({
        resourceName,
        status: "IDLE",
        lastSyncTimestamp: null,
        cursor: null,
        metrics: {
          totalDiscovered: 0,
          totalSynced: 0,
          totalFailed: 0,
          lastDurationMs: 0,
        },
        errorMessage: null,
        scheduleRunning: false,
        scheduleIntervalSeconds: null,
        lastScheduledAt: null,
      });

      yield* Effect.logInfo("S3IngestorTaskAgent initialized").pipe(
        Effect.annotateLogs({ resourceName }),
      );

      const scheduleNext = (intervalSeconds: number) =>
        Effect.gen(function* () {
          const scheduledAt = calculateScheduledAt(intervalSeconds);
          const self = yield* S3IngestorTaskAgentDefinition.client.get({
            resourceName,
          });
          yield* self.scheduledTick.schedule(scheduledAt, {});
        });

      const doSync = (force?: boolean) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (s) => ({
            ...s,
            status: "SYNCING" as const,
            errorMessage: null,
          }));

          const currentState = yield* Ref.get(state);

          const result = yield* runS3Ingestion(resourceName, currentState, {
            force,
          }).pipe(Effect.provide(pipelineLayer));

          const updated = yield* Ref.updateAndGet(state, (s) => ({
            ...s,
            status: result.status,
            lastSyncTimestamp: result.lastSyncTimestamp,
            cursor: result.cursor,
            metrics: result.metrics,
            errorMessage: result.errorMessage,
          }));
          return toStatusResponse(updated);
        });

      return {
        sync: ({ force }) => doSync(force),

        getStatus: () => Ref.get(state).pipe(Effect.map(toStatusResponse)),

        resetCursor: () =>
          Effect.gen(function* () {
            const checkpointRepo = yield* CheckpointRepository.pipe(
              Effect.provide(pipelineLayer),
            );
            yield* checkpointRepo
              .deleteCheckpoint(`s3_${resourceName}`)
              .pipe(Effect.ignore);

            const updated = yield* Ref.updateAndGet(state, (s) => ({
              ...s,
              lastSyncTimestamp: null,
              cursor: null,
              status: "IDLE" as const,
              errorMessage: null,
            }));
            return toStatusResponse(updated);
          }),

        startSchedule: ({ intervalSeconds }) =>
          Effect.gen(function* () {
            const nowIso = new Date().toISOString();
            const updated = yield* Ref.updateAndGet(state, (s) => ({
              ...s,
              scheduleRunning: true,
              scheduleIntervalSeconds: intervalSeconds,
              lastScheduledAt: nowIso,
            }));
            yield* scheduleNext(intervalSeconds);
            return toStatusResponse(updated);
          }),

        stopSchedule: () =>
          Ref.updateAndGet(state, (s) => ({
            ...s,
            scheduleRunning: false,
            scheduleIntervalSeconds: null,
          })).pipe(Effect.map(toStatusResponse)),

        scheduledTick: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(state);
            if (
              !current.scheduleRunning ||
              typeof current.scheduleIntervalSeconds !== "number"
            ) {
              return false;
            }

            yield* doSync(false);

            const latest = yield* Ref.get(state);
            if (
              latest.scheduleRunning &&
              typeof latest.scheduleIntervalSeconds === "number"
            ) {
              const nowIso = new Date().toISOString();
              yield* Ref.update(state, (s) => ({
                ...s,
                lastScheduledAt: nowIso,
              }));
              yield* scheduleNext(latest.scheduleIntervalSeconds);
            }
            return true;
          }).pipe(Effect.orDie),
      };
    }),
);
