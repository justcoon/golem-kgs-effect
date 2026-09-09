import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import {
  WebTaskStateSchema,
  WebTaskStatusResponseSchema,
  type WebTaskState,
  type WebTaskStatusResponse,
} from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import { makeAgentPipelineLayer } from "./agent-pipeline-layer.js";
import { runWebIngestion } from "../pipeline/web-ingestion-pipeline.js";

const toStatusResponse = (s: WebTaskState): WebTaskStatusResponse => ({
  resourceName: s.resourceName,
  status: s.status,
  lastSyncTimestamp: s.lastSyncTimestamp,
  processedUrls: Object.values(s.processedUrls),
  cursor: s.cursor,
  metrics: s.metrics,
  errorMessage: s.errorMessage,
});

export const WebIngestorTaskAgent = defineAgent({
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
  },
}).implement(({ resourceName }, snapshot) =>
  Effect.gen(function* () {
    const config = yield* AppAgentConfig;
    const pipelineLayer = yield* makeAgentPipelineLayer(config);

    const state = yield* snapshot.init({
      resourceName,
      status: "IDLE",
      lastSyncTimestamp: null,
      processedUrls: {},
      cursor: null,
      metrics: {
        totalDiscovered: 0,
        totalSynced: 0,
        totalFailed: 0,
        lastDurationMs: 0,
      },
      errorMessage: null,
    });

    yield* Effect.logInfo("WebIngestorTaskAgent initialized").pipe(
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

          const result = yield* runWebIngestion(resourceName, currentState, {
            force,
          }).pipe(Effect.provide(pipelineLayer));

          const updated = yield* Ref.updateAndGet(state, (s) => ({
            ...s,
            status: result.status,
            lastSyncTimestamp: result.lastSyncTimestamp,
            processedUrls: result.processedUrls,
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
          processedUrls: {},
          cursor: null,
          status: "IDLE" as const,
          errorMessage: null,
        })).pipe(Effect.map(toStatusResponse)),
    };
  }),
);
