import { Effect, Ref, Schema } from "effect";
import { defineAgent, method, Snapshot } from "@golemcloud/effect-golem";
import {
  calculateScheduledAt,
  CoordinatorStateSchema,
  SourceTypeSchema,
  SyncScheduleSchema,
  TaskRunSummarySchema,
  toScheduleKey,
  type SyncSchedule,
  type TaskRunSummary,
} from "./types.js";
import { S3IngestorTaskAgent } from "./s3-task-agent.js";

export const IngestionCoordinatorAgent = defineAgent({
  name: "IngestionCoordinatorAgent",
  description:
    "Durable supervisor managing sync schedules and dispatching to worker agents across resource types",
  mode: "durable",
  constructorParams: {},
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
      success: CoordinatorStateSchema,
      description:
        "Returns current coordinator state and all configured schedules",
    }),
    pauseSchedule: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
      },
      success: Schema.Boolean,
      description: "Pauses recurring schedule for a typed resource",
    }),
    resumeSchedule: method({
      params: {
        sourceType: SourceTypeSchema,
        resourceName: Schema.String,
      },
      success: Schema.Boolean,
      description: "Resumes a paused recurring schedule for a typed resource",
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
              status:
                syncResult.status === "COMPLETED" ? "COMPLETED" : "FAILED",
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

      getSystemStatus: () => Ref.get(state),

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
