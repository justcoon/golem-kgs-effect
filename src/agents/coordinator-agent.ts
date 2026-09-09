import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import {
  calculateScheduledAt,
  CoordinatorStateSchema,
  CoordinatorStatusResponseSchema,
  SourceTypeSchema,
  SyncScheduleSchema,
  TaskRunSummarySchema,
  toScheduleKey,
  WebhookIngestPayloadSchema,
  type SourceType,
  type SyncSchedule,
  type TaskRunSummary,
} from "./types.js";
import { S3IngestorTaskAgent } from "./s3-task-agent.js";
import { WebIngestorTaskAgent } from "./web-task-agent.js";

export const IngestionCoordinatorAgent = defineAgent({
  name: "IngestionCoordinatorAgent",
  description:
    "Durable supervisor managing sync schedules and dispatching to worker agents across resource types",
  mode: "durable",
  constructorParams: {},
  http: Http.mount("/api/coordinator", { cors: ["*"] }),
  snapshot: Snapshot.define({
    schema: CoordinatorStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    registerSchedule: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
        intervalSeconds: Schema.Number,
      },
      success: SyncScheduleSchema,
      description:
        "Registers or updates a recurring synchronization schedule for a typed resource",
      http: [Http.post("/schedules")],
    }),
    triggerSync: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
        force: Schema.optional(Schema.Boolean),
      },
      success: TaskRunSummarySchema,
      description:
        "Immediately triggers synchronization on the worker agent for the given typed resource",
      http: [Http.post("/sync")],
    }),
    ingestWebhook: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
        payload: WebhookIngestPayloadSchema,
      },
      success: TaskRunSummarySchema,
      description:
        "Stable push webhook endpoint for external event-driven ingestion",
      http: [Http.post("/webhook/{sourceType}/{resourceName}")],
    }),
    scheduleNext: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
      },
      success: Schema.Boolean,
      description:
        "Schedules the next execution using Golem native host scheduler (.schedule)",
    }),
    triggerScheduledRun: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
      },
      success: Schema.Boolean,
      description:
        "Called by Golem host timer to execute scheduled sync and schedule next cycle",
    }),
    getSystemStatus: method({
      params: {},
      success: CoordinatorStatusResponseSchema,
      description:
        "Returns current coordinator state and all configured schedules",
      http: [Http.get("/status")],
    }),
    pauseSchedule: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
      },
      success: Schema.Boolean,
      description: "Pauses recurring schedule for a typed resource",
      http: [Http.post("/schedules/pause")],
    }),
    resumeSchedule: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
      },
      success: Schema.Boolean,
      description: "Resumes a paused recurring schedule for a typed resource",
      http: [Http.post("/schedules/resume")],
    }),
  },
}).implement((_params, snapshot) =>
  Effect.gen(function* () {
    const state = yield* snapshot.init({
      schedules: {},
      aggregatedMetrics: {
        totalRunsTriggered: 0,
        totalSuccesses: 0,
        totalFailures: 0,
      },
    });

    yield* Effect.logInfo("IngestionCoordinatorAgent initialized");

    const doTriggerSync = (
      sourceType: SourceType,
      resourceName: string,
      force?: boolean,
    ) =>
      Effect.gen(function* () {
        const key = toScheduleKey(sourceType, resourceName);
        let runSummary: TaskRunSummary;

        if (sourceType === "s3") {
          const worker = yield* S3IngestorTaskAgent.client.get({
            resourceName,
          });
          const syncResult = yield* worker.sync({ force });
          runSummary = {
            sourceType: "s3",
            resourceName,
            status: syncResult.status === "COMPLETED" ? "COMPLETED" : "FAILED",
            syncedCount: syncResult.metrics.totalSynced,
            failedCount: syncResult.metrics.totalFailed,
            durationMs: syncResult.metrics.lastDurationMs,
            errorMessage: syncResult.errorMessage,
          };
        } else if (sourceType === "web") {
          const worker = yield* WebIngestorTaskAgent.client.get({
            resourceName,
          });
          const syncResult = yield* worker.sync({ force });
          runSummary = {
            sourceType: "web",
            resourceName,
            status: syncResult.status === "COMPLETED" ? "COMPLETED" : "FAILED",
            syncedCount: syncResult.metrics.totalSynced,
            failedCount: syncResult.metrics.totalFailed,
            durationMs: syncResult.metrics.lastDurationMs,
            errorMessage: syncResult.errorMessage,
          };
        } else {
          runSummary = {
            sourceType,
            resourceName,
            status: "FAILED",
            syncedCount: 0,
            failedCount: 0,
            durationMs: 0,
            errorMessage: `Worker for source type '${sourceType}' is not implemented`,
          };
        }

        const nowIso = new Date().toISOString();

        yield* Ref.update(state, (s) => {
          const existing = s.schedules[key];
          const updatedSchedules = existing
            ? {
                ...s.schedules,
                [key]: {
                  ...existing,
                  lastRunAt: nowIso,
                },
              }
            : s.schedules;

          return {
            ...s,
            schedules: updatedSchedules,
            aggregatedMetrics: {
              totalRunsTriggered: s.aggregatedMetrics.totalRunsTriggered + 1,
              totalSuccesses:
                runSummary.status === "COMPLETED"
                  ? s.aggregatedMetrics.totalSuccesses + 1
                  : s.aggregatedMetrics.totalSuccesses,
              totalFailures:
                runSummary.status === "FAILED"
                  ? s.aggregatedMetrics.totalFailures + 1
                  : s.aggregatedMetrics.totalFailures,
            },
          };
        });

        return runSummary;
      });

    return {
      registerSchedule: ({ sourceType, resourceName, intervalSeconds }) =>
        Effect.gen(function* () {
          const key = toScheduleKey(sourceType, resourceName);
          const schedule: SyncSchedule = {
            sourceType,
            resourceName,
            intervalSeconds,
            lastScheduledAt: null,
            lastRunAt: null,
            status: "ACTIVE",
          };

          yield* Ref.update(state, (s) => ({
            ...s,
            schedules: {
              ...s.schedules,
              [key]: schedule,
            },
          }));

          return schedule;
        }),

      triggerSync: ({ sourceType, resourceName, force }) =>
        doTriggerSync(sourceType, resourceName, force),

      ingestWebhook: ({ sourceType, resourceName, payload }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `Push webhook received for ${sourceType}:${resourceName} (action=${payload.action ?? "default"})`,
          );
          return yield* doTriggerSync(sourceType, resourceName, payload.force);
        }),

      scheduleNext: ({ sourceType, resourceName }) =>
        Effect.gen(function* () {
          const key = toScheduleKey(sourceType, resourceName);
          const s = yield* Ref.get(state);
          const sched = s.schedules[key];
          if (!sched || sched.status !== "ACTIVE") {
            return false;
          }

          const scheduledAt = calculateScheduledAt(sched.intervalSeconds);
          const selfHandle = yield* IngestionCoordinatorAgent.client.get({});
          yield* selfHandle.triggerScheduledRun.schedule(scheduledAt, {
            sourceType,
            resourceName,
          });

          const nowIso = new Date().toISOString();
          yield* Ref.update(state, (prev) => {
            const existing = prev.schedules[key];
            if (!existing) return prev;
            return {
              ...prev,
              schedules: {
                ...prev.schedules,
                [key]: {
                  ...existing,
                  lastScheduledAt: nowIso,
                },
              },
            };
          });

          return true;
        }),

      triggerScheduledRun: ({ sourceType, resourceName }) =>
        Effect.gen(function* () {
          const selfHandle = yield* IngestionCoordinatorAgent.client.get({});
          yield* selfHandle.triggerSync({
            sourceType,
            resourceName,
            force: false,
          });
          yield* selfHandle.scheduleNext({ sourceType, resourceName });
          return true;
        }),

      getSystemStatus: () =>
        Ref.get(state).pipe(
          Effect.map((s) => ({
            schedules: Object.values(s.schedules),
            aggregatedMetrics: s.aggregatedMetrics,
          })),
        ),

      pauseSchedule: ({ sourceType, resourceName }) =>
        Effect.gen(function* () {
          const key = toScheduleKey(sourceType, resourceName);
          let found = false;
          yield* Ref.update(state, (s) => {
            const sched = s.schedules[key];
            if (!sched) return s;
            found = true;
            return {
              ...s,
              schedules: {
                ...s.schedules,
                [key]: {
                  ...sched,
                  status: "PAUSED" as const,
                },
              },
            };
          });
          return found;
        }),

      resumeSchedule: ({ sourceType, resourceName }) =>
        Effect.gen(function* () {
          const key = toScheduleKey(sourceType, resourceName);
          let found = false;
          yield* Ref.update(state, (s) => {
            const sched = s.schedules[key];
            if (!sched) return s;
            found = true;
            return {
              ...s,
              schedules: {
                ...s.schedules,
                [key]: {
                  ...sched,
                  status: "ACTIVE" as const,
                },
              },
            };
          });
          return found;
        }),
    };
  }),
);
