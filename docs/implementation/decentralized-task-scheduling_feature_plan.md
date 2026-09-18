# Feature Plan: Decentralized Ingestor Task Scheduling

- **Feature ID / Slug**: `decentralized-task-scheduling`
- **Date**: 2026-09-18
- **Status**: Approved (Option B: Pure Decentralized Autonomous Workers, IngestionCoordinatorAgent Removed)

---

## 1. Overview & Goals

Originally, `IngestionCoordinatorAgent` acted as a centralized scheduler and dispatcher for all ingestion tasks. Because Golem processes invocations on an agent instance sequentially, running all recurring timers through a singleton coordinator introduced a mailbox serialization bottleneck and tightly coupled failure domains.

Under **Option B**, we have completely removed `IngestionCoordinatorAgent`. Task scheduling and push webhook ingress are decentralized directly into worker agents (`S3IngestorTaskAgent` and `WebIngestorTaskAgent`). `README.md`, `golem.yaml`, and the HTTP test suites are updated accordingly.

### Goals
- Implement first-class self-scheduling directly inside `S3IngestorTaskAgent` and `WebIngestorTaskAgent` using Golem's native host timer (`.schedule(...)`).
- Provide per-resource isolation: bucket/domain A running a long crawl or encountering transient errors does not delay or block bucket/domain B.
- Support runtime management of schedules per agent (`startSchedule`, `stopSchedule`, `getStatus`) over HTTP and typed RPC.
- Add direct push webhook ingress (`/api/ingestion/{sourceType}/{resourceName}/webhook`) to task agents.
- Implement the **logical stop** pattern so scheduled ticks verify active status before execution, surviving Golem suspension and snapshot restores.
- Remove `IngestionCoordinatorAgent`, simplifying the architecture to three specialized agents.

### Non-Goals
- Adding external cron libraries or sleeping Node fibers (Golem native timers handle durable wakeups automatically).
- Modifying underlying connectors (`S3Connector`, `WebConnector`) or downstream pipelines.

---

## 2. Architecture & Technical Design

### Golem Host Timer Pattern (`golem-recurring-task-effect`)
Each task worker agent self-schedules its next invocation using Golem's WIT wall-clock timer:

```typescript
const scheduleNext = (intervalSeconds: number) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const atMillis = DateTime.toEpochMillis(now) + intervalSeconds * 1_000;
    const scheduledAt = {
      seconds: BigInt(Math.floor(atMillis / 1_000)),
      nanoseconds: Math.floor(atMillis % 1_000) * 1_000_000,
    };

    const self = yield* S3IngestorTaskAgent.client.get({ resourceName });
    yield* self.scheduledTick.schedule(scheduledAt, {});
  });
```

### Logical Stop Pattern
Because host timer handles (`Client.ScheduledInvocation`) are not schema-serializable across snapshot restorations:
1. `S3TaskState` and `WebTaskState` durably persist:
   - `scheduleRunning: boolean`
   - `scheduleIntervalSeconds: number | null`
   - `lastScheduledAt: string | null`
2. When `scheduledTick` is invoked:
   - It inspects `scheduleRunning`. If `false`, it exits immediately.
   - It executes `sync({ force: false })`.
   - After execution, if `scheduleRunning` is still `true`, it schedules the next tick.
3. Calling `stopSchedule`:
   - Sets `scheduleRunning = false` and `scheduleIntervalSeconds = null`. Any already-scheduled invocation arriving later becomes a no-op.

---

## 3. Proposed Changes & File Impact

| Action | File Path | Description |
| :--- | :--- | :--- |
| `[MODIFY]` | [`src/agents/types.ts`](../../src/agents/types.ts) | Add `scheduleRunning`, `scheduleIntervalSeconds`, `lastScheduledAt` to S3 and Web task state/response schemas; remove coordinator schemas |
| `[MODIFY]` | [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts) | Add `startSchedule`, `stopSchedule`, `scheduledTick`, and `ingestWebhook` methods with host timer self-scheduling logic |
| `[MODIFY]` | [`src/agents/web-task-agent.ts`](../../src/agents/web-task-agent.ts) | Add `startSchedule`, `stopSchedule`, `scheduledTick`, and `ingestWebhook` methods with host timer self-scheduling logic |
| `[DELETE]` | `src/agents/coordinator-agent.ts` | Removed coordinator agent completely |
| `[MODIFY]` | [`src/main.ts`](../../src/main.ts) | Remove coordinator agent import |
| `[MODIFY]` | [`src/agents/index.ts`](../../src/agents/index.ts) | Remove coordinator agent export |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml) | Remove `IngestionCoordinatorAgent` from HTTP deployments |
| `[MODIFY]` | [`README.md`](../../README.md) | Update architecture diagram, agent list, endpoints, and examples to reflect autonomous scheduling & direct webhooks |
| `[MODIFY]` | [`test/agents.test.ts`](../../test/agents.test.ts) | Add unit tests for worker self-scheduling state transitions and logical stop |
| `[MODIFY]` | [`test/http-gateway.test.ts`](../../test/http-gateway.test.ts) | Verify HTTP routes for `/schedule/start`, `/schedule/stop`, and `/webhook` on task agents; assert coordinator is not deployed |
| `[MODIFY]` | [`test/e2e/e2e-client.ts`](../../test/e2e/e2e-client.ts) | Replace coordinator calls with direct task agent sync and webhook endpoints |
| `[MODIFY]` | [`test/e2e/full-pipeline.e2e.test.ts`](../../test/e2e/full-pipeline.e2e.test.ts) | Update E2E test to invoke direct task agent sync and webhook |

---

## 4. Verification Plan

### Automated Checks
```bash
npm run format:check # Prettier compliance
npm run typecheck    # TypeScript compiler (tsc --noEmit)
npm run lint         # ESLint verification
npm test             # Automated unit & integration test suite
npm run build        # Golem WASM build compilation
```

### Manual / Integration Verification
- Inspect generated WIT / OpenAPI specs to verify the new HTTP endpoints:
  - `POST /api/ingestion/s3/{resourceName}/schedule/start`
  - `POST /api/ingestion/s3/{resourceName}/schedule/stop`
  - `POST /api/ingestion/s3/{resourceName}/webhook`
  - `POST /api/ingestion/web/{resourceName}/schedule/start`
  - `POST /api/ingestion/web/{resourceName}/schedule/stop`
  - `POST /api/ingestion/web/{resourceName}/webhook`
- Verify snapshot compatibility and start/stop behavior.

---

## 5. Architectural Decision
- **Option B (Approved & Implemented):** Completely remove `IngestionCoordinatorAgent`. Worker agents (`S3IngestorTaskAgent` and `WebIngestorTaskAgent`) are autonomous, handling their own self-scheduling, recurring polling, and push webhook ingestion directly. Client applications, the frontend, and test suites interact directly with worker agents per resource.
