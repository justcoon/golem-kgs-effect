# Feature Implementation Walkthrough: Decentralized Ingestor Task Scheduling

- **Feature ID / Slug**: `decentralized-task-scheduling`
- **Date**: 2026-09-18
- **Status**: Ready for Review

---

## 1. Executive Summary

This feature implements decentralized, autonomous recurring task scheduling and push webhook ingress directly inside [S3IngestorTaskAgent](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/s3-task-agent.ts) and [WebIngestorTaskAgent](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/web-task-agent.ts) using Golem's native host timer (`.schedule(...)`).

By adopting **Option B (Pure Decentralized Autonomous Workers, IngestionCoordinatorAgent Removed)**:
- Each task worker self-schedules its own recurring ticks via Golem's WIT wall-clock timer, completely isolating failure domains and eliminating the singleton coordinator's mailbox serialization bottleneck.
- Workers persist `scheduleRunning`, `scheduleIntervalSeconds`, and `lastScheduledAt` in durable snapshots and enforce the **logical stop pattern** across sleep/resume cycles.
- Direct push webhook ingress (`POST /api/ingestion/{sourceType}/{resourceName}/webhook`) is handled directly by each task worker, triggering immediate sync and metadata extraction without central routing.
- `IngestionCoordinatorAgent` has been **completely removed** (`src/agents/coordinator-agent.ts` deleted, removed from `golem.yaml`, `src/main.ts`, and `src/agents/index.ts`).
- [README.md](file:///Users/coon/workspace-zv/git/golem-kgs-effect/README.md) has been updated with the simplified 3-agent architecture, endpoints table, manifest configuration, and cURL examples.

---

## 2. Changes Implemented

### File Modifications

| Action | File Path | Summary of Changes |
| :--- | :--- | :--- |
| `[MODIFY]` | [`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts) | Added `scheduleRunning`, `scheduleIntervalSeconds`, and `lastScheduledAt` to `S3TaskStateSchema`, `S3TaskStatusResponseSchema`, `WebTaskStateSchema`, and `WebTaskStatusResponseSchema`; removed deprecated coordinator schemas. |
| `[MODIFY]` | [`src/agents/s3-task-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/s3-task-agent.ts) | Added `startSchedule`, `stopSchedule`, `scheduledTick`, and `ingestWebhook` methods with self-scheduling host timer logic and logical stop guards. |
| `[MODIFY]` | [`src/agents/web-task-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/web-task-agent.ts) | Added `startSchedule`, `stopSchedule`, `scheduledTick`, and `ingestWebhook` methods with self-scheduling host timer logic and logical stop guards. |
| `[DELETE]` | `src/agents/coordinator-agent.ts` | Removed coordinator agent implementation completely. |
| `[MODIFY]` | [`src/main.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/main.ts) | Removed coordinator agent side-effect import. |
| `[MODIFY]` | [`src/agents/index.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/index.ts) | Removed coordinator agent exports. |
| `[MODIFY]` | [`golem.yaml`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml) | Removed `IngestionCoordinatorAgent` from HTTP API local and test deployments. |
| `[MODIFY]` | [`README.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/README.md) | Documented autonomous task worker scheduling and push webhooks, updated architecture diagrams and HTTP endpoints table. |
| `[MODIFY]` | [`test/agents.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/agents.test.ts) | Added unit tests verifying schedule schema decoding, state transitions, and logical stop guard behavior. |
| `[MODIFY]` | [`test/http-gateway.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/http-gateway.test.ts) | Added route matching verification tests for S3 and Web task agent `/schedule/start`, `/schedule/stop`, and `/webhook` endpoints; verified coordinator is not deployed. |
| `[MODIFY]` | [`test/e2e/e2e-client.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/e2e/e2e-client.ts) | Updated E2E client to trigger task agent sync and send webhooks directly to task agents instead of coordinator. |
| `[MODIFY]` | [`test/e2e/full-pipeline.e2e.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/e2e/full-pipeline.e2e.test.ts) | Updated full pipeline E2E tests to invoke task agent sync and webhook directly. |

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
Command executed:
```bash
npm run format:check
```
**Result**:
```text
All matched files use Prettier code style!
```

### 3.2 Type Checking
Command executed:
```bash
npm run typecheck
```
**Result**:
```text
> tsc --noEmit
(zero errors)
```

### 3.3 Linter Verification
Command executed:
```bash
npm run lint
```
**Result**:
```text
> eslint src/ test/
(zero errors, zero warnings)
```

### 3.4 Golem Component Build
Command executed:
```bash
npm run build
```
**Result**:
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
Writing pre-initialized component to golem-temp/agents/golem_kgs_effect_effect_main.preinitialized.wasm...
Done! Input: 13677.1 KB, Output: 49069.8 KB
Finished building [OK]
```

### 3.5 Automated Unit & Integration Test Suite Execution
Command executed:
```bash
npm test
```
**Result**:
```text
ℹ tests 143
ℹ suites 50
ℹ pass 143
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### 3.6 Containerized Full E2E Test Suite Execution
Command executed:
```bash
./run_e2e_test.sh
```
**Result**:
```text
[INFO] Starting clean E2E stack (PostgreSQL, RustFS, Fixtures, Golem Server)...
[SUCCESS] Golem server container is healthy and ready!
[INFO] Deploying application to containerized Golem test server...
[SUCCESS] HTTP Gateway is responsive!
[INFO] Executing E2E test suite...

▶ Golem KGS Full End-to-End (E2E) Test Suite
  ▶ Suite 1: Gateway Connectivity & Agent Initialization
    ✔ should reach KnowledgeAccessAgent overview endpoint
    ✔ should reach S3IngestorTaskAgent status endpoint
  ✔ Suite 1: Gateway Connectivity & Agent Initialization
  ▶ Suite 2: S3 Ingestion, Storage Persistence & Checkpointing
    ✔ should trigger S3 sync and poll until task completes
    ✔ should verify ingested documents and knowledge graph state in storage
    ✔ should verify incremental checkpointing skips unchanged files on subsequent sync
  ✔ Suite 2: S3 Ingestion, Storage Persistence & Checkpointing
  ▶ Suite 3: Event-Driven Webhook Ingestion
    ✔ should trigger a sync via direct task agent webhook
    ✔ should retrieve an ingested document by ID
  ✔ Suite 3: Event-Driven Webhook Ingestion
  ▶ Suite 4: Multi-Modal Search (Hybrid, Vector & Keyword)
    ✔ should execute hybrid search and return ranked results with RRF scores
    ✔ should execute vector semantic search
    ✔ should execute keyword search
  ✔ Suite 4: Multi-Modal Search (Hybrid, Vector & Keyword)
  ▶ Suite 5: Knowledge Graph Traversal & Entity Exploration
    ✔ should list top hub entities sorted by degree centrality
    ✔ should search entities by name prefix or alias
    ✔ should retrieve entity details and document associations
    ✔ should traverse graph neighborhood up to 2 hops
  ✔ Suite 5: Knowledge Graph Traversal & Entity Exploration
  ▶ Suite 6: GraphRAG Context Retrieval & Answer Synthesis
    ✔ should retrieve GraphRAG context bundle with grounded entities and relationships
    ✔ should synthesize an answer with citations via /ask endpoint
  ✔ Suite 6: GraphRAG Context Retrieval & Answer Synthesis
✔ Golem KGS Full End-to-End (E2E) Test Suite

ℹ tests 16
ℹ suites 7
ℹ pass 16
ℹ fail 0
[SUCCESS] All E2E test suites passed!
[SUCCESS] E2E Test Run Completed Successfully!
```

---

## 4. How to Run & Verify

### 1. Autonomous S3 Ingestion Scheduling
Start recurring synchronization every 300 seconds for the `"main"` S3 target:
```bash
curl -X POST 'http://localhost:9006/api/ingestion/s3/main/schedule/start' \
  -H 'Content-Type: application/json' \
  -d '{"intervalSeconds": 300}'
```

Inspect schedule running status and metrics:
```bash
curl -s 'http://localhost:9006/api/ingestion/s3/main/status'
```

Stop recurring sync:
```bash
curl -X POST 'http://localhost:9006/api/ingestion/s3/main/schedule/stop'
```

Send push webhook to S3 worker:
```bash
curl -X POST 'http://localhost:9006/api/ingestion/s3/main/webhook' \
  -H 'Content-Type: application/json' \
  -d '{"eventType": "s3:ObjectCreated:Put", "bucket": "knowledge-bucket", "key": "docs/architecture.pdf"}'
```

### 2. Autonomous Web Ingestion Scheduling
Start recurring crawl and sync every 600 seconds for `"golem-docs"`:
```bash
curl -X POST 'http://localhost:9006/api/ingestion/web/golem-docs/schedule/start' \
  -H 'Content-Type: application/json' \
  -d '{"intervalSeconds": 600}'
```

Stop recurring crawl:
```bash
curl -X POST 'http://localhost:9006/api/ingestion/web/golem-docs/schedule/stop'
```

Send push webhook to Web worker:
```bash
curl -X POST 'http://localhost:9006/api/ingestion/web/golem-docs/webhook' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://learn.golem.cloud/docs", "action": "reindex"}'
```

---

## 5. Sign-off / Next Steps

- Implementation and validation are complete across all 5 verification gates.
- Option B has been fully implemented with clean code removal, documentation updates, and passing tests.
- Ready for final user sign-off.

