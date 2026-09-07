import { Effect, Ref, Schema } from "effect";
import {
  defineAgent,
  Http,
  method,
  Snapshot,
  Webhook,
} from "@golemcloud/effect-golem";
import {
  BatchJobCallbackResultSchema,
  S3TaskStateSchema,
  S3TaskStatusResponseSchema,
  type S3TaskState,
  type S3TaskStatusResponse,
} from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import { makeAgentPipelineLayer } from "./agent-pipeline-layer.js";
import { runS3Ingestion } from "../pipeline/s3-ingestion-pipeline.js";

const toStatusResponse = (s: S3TaskState): S3TaskStatusResponse => ({
  resourceName: s.resourceName,
  status: s.status,
  lastSyncTimestamp: s.lastSyncTimestamp,
  processedKeys: Object.entries(s.processedKeys).map(([key, etag]) => ({
    key,
    etag,
  })),
  cursor: s.cursor,
  metrics: s.metrics,
  errorMessage: s.errorMessage,
});

export const S3IngestorTaskAgent = defineAgent({
  name: "S3IngestorTaskAgent",
  description:
    "Durable S3 ingestion task worker bound 1:1 to an S3 resource target",
  mode: "durable",
  config: AppAgentConfig,
  constructorParams: {
    resourceName: Schema.String,
  },
  http: Http.mount("/api/ingestion/{resourceName}", { cors: ["*"] }),
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
    awaitBatchJob: method({
      params: {
        jobId: Schema.optional(Schema.String),
      },
      success: BatchJobCallbackResultSchema,
      description:
        "Allocates a durable one-shot webhook handle and awaits external batch completion callback",
      http: [Http.post("/batch-callback")],
    }),
  },
}).implement(({ resourceName }, snapshot) =>
  Effect.gen(function* () {
    const config = yield* AppAgentConfig;
    const pipelineLayer = yield* makeAgentPipelineLayer(config);

    const state = yield* snapshot.init({
      resourceName,
      status: "IDLE",
      lastSyncTimestamp: null,
      processedKeys: {},
      cursor: null,
      metrics: {
        totalDiscovered: 0,
        totalSynced: 0,
        totalFailed: 0,
        lastDurationMs: 0,
      },
      errorMessage: null,
    });

    yield* Effect.logInfo("S3IngestorTaskAgent initialized").pipe(
      Effect.annotateLogs({ resourceName }),
    );

    return {
      sync: ({ force }) =>
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
            processedKeys: result.processedKeys,
            cursor: result.cursor,
            metrics: result.metrics,
            errorMessage: result.errorMessage,
          }));
          return toStatusResponse(updated);
        }),

      getStatus: () => Ref.get(state).pipe(Effect.map(toStatusResponse)),

      resetCursor: () =>
        Ref.updateAndGet(state, (s) => ({
          ...s,
          lastSyncTimestamp: null,
          processedKeys: {},
          cursor: null,
          status: "IDLE" as const,
          errorMessage: null,
        })).pipe(Effect.map(toStatusResponse)),

      awaitBatchJob: ({ jobId }) =>
        Effect.gen(function* () {
          const hook = yield* Webhook.create;
          yield* Effect.logInfo(
            `Allocated one-shot webhook for jobId=${jobId ?? "unspecified"}: ${hook.url}`,
          );
          const payload = yield* hook.await;
          return yield* payload.decode(BatchJobCallbackResultSchema);
        }).pipe(Effect.orDie),
    };
  }),
);
