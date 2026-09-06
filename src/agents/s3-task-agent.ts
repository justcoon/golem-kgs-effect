import { Effect, Redacted, Ref, Schema } from "effect";
import { defineAgent, method, Snapshot } from "@golemcloud/effect-golem";
import { PgClient } from "@golemcloud/effect-golem/postgres";
import { S3TaskStateSchema } from "./types.js";
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
  snapshot: Snapshot.define({
    schema: S3TaskStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    sync: method({
      params: { force: Schema.optional(Schema.Boolean) },
      success: S3TaskStateSchema,
      description:
        "Executes an incremental or forced synchronization of the S3 resource",
    }),
    getStatus: method({
      params: {},
      success: S3TaskStateSchema,
      description: "Returns the current synchronization state and metrics",
    }),
    resetCursor: method({
      params: {},
      success: S3TaskStateSchema,
      description:
        "Resets the sync cursor to force a full rescan on the next sync",
    }),
  },
}).implement(({ resourceName }, snapshot) =>
  Effect.gen(function* () {
    const config = yield* AppAgentConfig;
    const host = yield* config.db.host;
    const db = yield* config.db.db;
    const port = yield* config.db.port;
    const user = Redacted.value(yield* config.db.user.get);
    const password = Redacted.value(yield* config.db.password.get);

    const connectionAddress = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
    const sql = yield* PgClient.make({
      connectionAddress,
      decodeTemporal: "date",
    });

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
    };
  }),
);
