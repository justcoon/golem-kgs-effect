import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import {
  calculateScheduledAt,
  WebTaskStateSchema,
  WebTaskStatusResponseSchema,
  WebhookIngestPayloadSchema,
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
  constructorParams: {
    resourceName: Schema.String,
  },
  http: Http.mount("/api/ingestion/web/{resourceName}", { cors: ["*"] }),
  snapshot: Snapshot.define({
    schema: WebTaskStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    sync: method({
      params: {
        force: Schema.optional(Schema.Boolean),
      },
      success: WebTaskStatusResponseSchema,
      description:
        "Executes full or incremental synchronization of the bound Web resource",
      http: [Http.post("/sync")],
    }),
    getStatus: method({
      params: {},
      success: WebTaskStatusResponseSchema,
      description: "Returns the current synchronization state and metrics",
      http: [Http.get("/status")],
    }),
    resetCursor: method({
      params: {},
      success: WebTaskStatusResponseSchema,
      description:
        "Resets the sync cursor to force a full rescan on the next sync",
      http: [Http.post("/reset")],
    }),
    startSchedule: method({
      params: {
        intervalSeconds: Schema.Number,
      },
      success: WebTaskStatusResponseSchema,
      description: "Starts recurring synchronization for this Web resource",
      http: [Http.post("/schedule/start")],
    }),
    stopSchedule: method({
      params: {},
      success: WebTaskStatusResponseSchema,
      description: "Stops recurring synchronization for this Web resource",
      http: [Http.post("/schedule/stop")],
    }),
    scheduledTick: method({
      params: {},
      success: Schema.Boolean,
      description:
        "Called by Golem host timer to execute scheduled sync and schedule next cycle",
    }),
    ingestWebhook: method({
      params: {
        payload: WebhookIngestPayloadSchema,
      },
      success: WebTaskStatusResponseSchema,
      description: "Push webhook ingress for external change events",
      http: [Http.post("/webhook")],
    }),
  },
});

export const WebIngestorTaskAgent = WebIngestorTaskAgentDefinition.implement(
  ({ resourceName }, snapshot) =>
    Effect.gen(function* () {
      const config = yield* AppAgentConfig;
      const pipelineLayer = yield* makeWebTaskAgentLayer(config);

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

      yield* Effect.logInfo("WebIngestorTaskAgent initialized").pipe(
        Effect.annotateLogs({ resourceName }),
      );

      const scheduleNext = (intervalSeconds: number) =>
        Effect.gen(function* () {
          const scheduledAt = calculateScheduledAt(intervalSeconds);
          const self = yield* WebIngestorTaskAgentDefinition.client.get({
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

          const result = yield* runWebIngestion(resourceName, currentState, {
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

        ingestWebhook: ({ payload }) =>
          Effect.gen(function* () {
            yield* Effect.logInfo(
              `Push webhook received for web:${resourceName} (action=${payload.action ?? "default"})`,
            );
            return yield* doSync(payload.force);
          }),
      };
    }),
);
