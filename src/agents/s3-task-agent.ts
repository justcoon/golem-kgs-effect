import { Effect, Redacted, Ref, Schema } from "effect";
import {
  defineAgent,
  Http,
  method,
  Snapshot,
  Webhook,
} from "@golemcloud/effect-golem";
import { createPostgresClient } from "../storage/database-client.js";
import { BatchJobCallbackResultSchema, S3TaskStateSchema } from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import { makeAgentPipelineLayer } from "./agent-pipeline-layer.js";
import { runS3Ingestion } from "../pipeline/s3-ingestion-pipeline.js";

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
      success: S3TaskStateSchema,
      description:
        "Executes full or incremental synchronization of the bound S3 resource",
      http: [Http.post("/sync")],
    }),
    getStatus: method({
      params: {},
      success: S3TaskStateSchema,
      description: "Returns the current synchronization state and metrics",
      http: [Http.get("/status")],
    }),
    resetCursor: method({
      params: {},
      success: S3TaskStateSchema,
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
    const sql = yield* createPostgresClient(config);

    const api_base = yield* config.embedding.api_base;
    const model = yield* config.embedding.model;
    const apiKey = yield* config.embedding.apiKey.get;

    const resourcesVal = Redacted.value(yield* config.resources.get);
    const s3Targets = resourcesVal?.s3 ?? {};

    const pipelineLayer = makeAgentPipelineLayer({
      sql,
      embeddingConfig: { api_base, model, apiKey },
      s3Targets,
    });

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

          return yield* Ref.updateAndGet(state, (s) => ({
            ...s,
            status: result.status,
            lastSyncTimestamp: result.lastSyncTimestamp,
            processedKeys: result.processedKeys,
            cursor: result.cursor,
            metrics: result.metrics,
            errorMessage: result.errorMessage,
          }));
        }),

      getStatus: () => Ref.get(state),

      resetCursor: () =>
        Ref.updateAndGet(state, (s) => ({
          ...s,
          lastSyncTimestamp: null,
          processedKeys: {},
          cursor: null,
          status: "IDLE" as const,
          errorMessage: null,
        })),

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
