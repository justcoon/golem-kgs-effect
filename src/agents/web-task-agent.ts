import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import {
  calculateScheduledAt,
  WebTaskStateSchema,
  WebTaskStatusResponseSchema,
  type WebTaskState,
  type WebTaskStatusResponse,
} from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import { makeWebTaskAgentLayer } from "./agent-pipeline-layer.js";
import { runWebIngestion } from "../pipeline/web-ingestion-pipeline.js";
import { CheckpointRepository } from "../storage/index.js";

const toStatusResponse = (s: WebTaskState): WebTaskStatusResponse => ({
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

export const WebIngestorTaskAgentDefinition = defineAgent({
  name: "WebIngestorTaskAgent",
  description:
    "Durable Web Page / Documentation ingestion task worker bound 1:1 to a web resource target",
  mode: "durable",
  config: AppAgentConfig,
  id: {
    resourceName: Schema.String,
  },
  http: Http.mount("/api/ingestion/web/{resourceName}", { cors: ["*"] }),
  snapshotting: Snapshot.define({
    schema: WebTaskStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    sync: method({
      input: {
        force: Schema.optional(Schema.Boolean),
      },
      success: WebTaskStatusResponseSchema,
      description:
        "Executes full or incremental synchronization of the bound Web resource",
      http: [Http.post("/sync")],
    }),
    getStatus: method({
      input: {},
      success: WebTaskStatusResponseSchema,
      description: "Returns the current synchronization state and metrics",
      http: [Http.get("/status")],
    }),
    resetCursor: method({
      input: {},
      success: WebTaskStatusResponseSchema,
      description:
        "Resets the sync cursor to force a full rescan on the next sync",
      http: [Http.post("/reset")],
    }),
    startSchedule: method({
      input: {
        intervalSeconds: Schema.Number,
      },
      success: WebTaskStatusResponseSchema,
      description: "Starts recurring synchronization for this Web resource",
      http: [Http.post("/schedule/start")],
    }),
    stopSchedule: method({
      input: {},
      success: WebTaskStatusResponseSchema,
      description: "Stops recurring synchronization for this Web resource",
      http: [Http.post("/schedule/stop")],
    }),
    scheduledTick: method({
      input: {},
      success: Schema.Boolean,
      description:
        "Called by Golem host timer to execute scheduled sync and schedule next cycle",
    }),
  },
});

export const WebIngestorTaskAgent = WebIngestorTaskAgentDefinition.implement<
  Ref.Ref<WebTaskState>
>({
  init: ({ resourceName }) =>
    Ref.make<WebTaskState>({
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
    }),

  methods: (state) =>
    Effect.gen(function* () {
      const { resourceName } = yield* Ref.get(state);
      const config = yield* AppAgentConfig;
      const pipelineLayer = yield* makeWebTaskAgentLayer(config, resourceName);

      const scheduleNext = (intervalSeconds: number) =>
        Effect.scoped(
          Effect.gen(function* () {
            const scheduledAt = calculateScheduledAt(intervalSeconds);
            const self = yield* WebIngestorTaskAgentDefinition.client.get({
              resourceName,
            });
            yield* self.scheduledTick.schedule(scheduledAt, {});
          }).pipe(Effect.orDie),
        );

      const doSync = (force?: boolean) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (s) => ({
            ...s,
            status: "SYNCING" as const,
            errorMessage: null,
          }));

          const currentState = yield* Ref.get(state);

          const result = yield* runWebIngestion(resourceName, currentState, {
            force,
          }).pipe(Effect.provide(pipelineLayer), Effect.orDie);

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
              Effect.orDie,
            );
            yield* checkpointRepo
              .deleteCheckpoint(`web_${resourceName}`)
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

  snapshot: Snapshot.ref<WebTaskState>(),
});
