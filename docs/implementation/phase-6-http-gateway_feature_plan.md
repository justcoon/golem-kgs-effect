# Feature Plan: Phase 6 - Golem Native HTTP Gateway & Agent Mounts

- **Feature ID / Slug**: `phase-6-http-gateway`
- **Date**: 2026-09-06
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Following the completion of Phase 1 (Storage Substrate), Phase 2 (Processing Pipeline), Phase 3 (S3 Connector Framework), Phase 4 (Durable Agents & Orchestration), and Phase 5 (Search Engine & GraphRAG Retrieval), **Phase 6** implements the **Golem Native HTTP Gateway & Agent Mounts** as defined in [`plan.md`](../../plan.md).

Phase 6 exposes the entire Knowledge Graph System to external clients, Web UIs, and external services via Golem's native API Gateway, HTTP mounts, and declarative routing metadata. Golem handles incoming HTTP requests, decodes path, query, header, and JSON bodies against Effect Schemas, routes them directly to the target agent instances, and serializes responses according to standard HTTP status conventions.

### Core Objectives

1. **Golem Application Manifest Configuration (`golem.yaml`)**:
   - Update `httpApi.deployments` in `golem.yaml` to bind all agents (`KnowledgeAccessAgent`, `IngestionCoordinatorAgent`, `S3IngestorTaskAgent`, and `Counter`) to `golem-kgs-effect.localhost:9006`.
   - Configure global webhook URL prefix if necessary (`webhookUrl: "/webhooks"`).

2. **Unified Query Gateway Routes (`KnowledgeAccessAgent`)**:
   - Add `Http.mount("/api/knowledge", { cors: ["*"] })` to `KnowledgeAccessAgent` (`mode: "ephemeral"`).
   - Expose REST endpoints for all 7 query capabilities:
     - `POST /search` & `GET /search?q={query}`: Hybrid, vector, and keyword search across document chunks.
     - `GET /entities/{id}`: Direct entity lookup by ID (yielding 200 on found, 404 on null).
     - `POST /neighborhood` & `GET /neighborhood/{entityId}`: Multi-hop graph expansion around entities.
     - `POST /paths`: Shortest paths and relationship chain discovery between two concepts.
     - `POST /graphrag`: Structured GraphRAG context retrieval with LLM-ready synthesized prompt.
     - `POST /ask`: Grounded question-answering with verifiable citations and confidence scoring.
     - `GET /overview`: High-level knowledge base statistics (document, chunk, entity, edge counts) and sync status.

3. **Orchestration & Ingestion Management Routes (`IngestionCoordinatorAgent`)**:
   - Add `Http.mount("/api/coordinator", { cors: ["*"] })` to `IngestionCoordinatorAgent` (`mode: "durable"`).
   - Expose administrative endpoints:
     - `GET /status`: Retrieves current coordinator state, active schedules, and execution metrics.
     - `POST /schedules`: Registers or updates recurring sync intervals for resources.
     - `POST /sync`: Manually triggers immediate synchronization for a target resource.
     - `POST /schedules/pause` & `POST /schedules/resume`: Pauses or resumes recurring timers.
     - `POST /webhook/{sourceType}/{resourceName}`: Stable push webhook ingress endpoint to trigger resource ingestion on external event notifications.

4. **Task Worker Endpoints & Durable One-Shot Webhooks (`S3IngestorTaskAgent`)**:
   - Add `Http.mount("/api/ingestion/{resourceName}", { cors: ["*"] })` to `S3IngestorTaskAgent` (`mode: "durable"`).
   - Expose worker endpoints:
     - `POST /sync`: Executes full or incremental synchronization of the bound S3 resource.
     - `GET /status`: Returns current synchronization state, progress, and metrics.
     - `POST /reset`: Resets sync cursor to force full rescan.
     - `POST /batch-callback`: Implements Golem's durable one-shot webhook primitive (`Webhook.create` / `handle.await`) allowing long-running asynchronous batch workers (such as external OCR or export jobs) to complete without consuming compute during idle wait.

5. **CORS & Error Mapping**:
   - Configure mount-level CORS (`cors: ["*"]`) enabling seamless integration with browser-based frontends.
   - Map `Schema.NullOr` results to HTTP 404 Not Found and `Schema.Void` to HTTP 204 No Content.

6. **Comprehensive Automated Test Suite**:
   - Implement `test/http-gateway.test.ts` validating parameter bindings, endpoint schema decodings, response mappings, and webhook workflows.

---

## 2. Architecture & API Surface

### 2.1 HTTP Deployment Architecture

```
                                    Incoming HTTP Client Requests
                                                  │
                                                  ▼
                          ┌───────────────────────────────────────────────┐
                          │         Golem Native API Gateway              │
                          │          (golem.yaml: httpApi)                │
                          └───────┬───────────────┬───────────────┬───────┘
                                  │               │               │
            /api/knowledge/*      │               │               │ /api/ingestion/{resourceName}/*
                                  ▼               │               ▼
                   ┌──────────────────────┐       │    ┌──────────────────────┐
                   │ KnowledgeAccessAgent │       │    │ S3IngestorTaskAgent  │
                   │ (mode: "ephemeral")  │       │    │ (mode: "durable")    │
                   └──────────────────────┘       │    └──────────────────────┘
                                                  │
                               /api/coordinator/* │
                                                  ▼
                                   ┌─────────────────────────────┐
                                   │  IngestionCoordinatorAgent  │
                                   │  (mode: "durable")          │
                                   └─────────────────────────────┘
```

### 2.2 Endpoint Specification Table

| Agent | HTTP Method | Path Pattern | Method Name | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`KnowledgeAccessAgent`** | `GET` / `POST` | `/api/knowledge/search` | `search` | Hybrid, vector, or keyword search across document chunks |
| | `GET` | `/api/knowledge/entities/{id}` | `getEntity` | Lookup entity by exact ID (200 JSON or 404 empty) |
| | `GET` | `/api/knowledge/neighborhood/{entityId}` | `getNeighborhood` | Multi-hop graph expansion around target entity |
| | `POST` | `/api/knowledge/neighborhood` | `getNeighborhood` | Graph expansion with relation filters and confidence cutoffs |
| | `POST` | `/api/knowledge/paths` | `findPaths` | Path finding and shortest connection chains between two entities |
| | `POST` | `/api/knowledge/graphrag` | `graphRag` | Structured GraphRAG context retrieval with LLM-ready prompt |
| | `POST` | `/api/knowledge/ask` | `ask` | Grounded question-answering with citations and confidence score |
| | `GET` | `/api/knowledge/overview` | `getOverview` | Knowledge base statistics (documents, chunks, entities, edges) |
| **`IngestionCoordinatorAgent`** | `GET` | `/api/coordinator/status` | `getSystemStatus` | Retrieves coordinator status, active schedules, and metrics |
| | `POST` | `/api/coordinator/schedules` | `registerSchedule` | Registers or updates recurring sync intervals |
| | `POST` | `/api/coordinator/sync` | `triggerSync` | Triggers immediate sync on worker agent |
| | `POST` | `/api/coordinator/schedules/pause` | `pauseSchedule` | Pauses recurring sync timer for a resource |
| | `POST` | `/api/coordinator/schedules/resume` | `resumeSchedule` | Resumes paused recurring sync timer |
| | `POST` | `/api/coordinator/webhook/{sourceType}/{resourceName}` | `ingestWebhook` | Stable push webhook ingress triggering ingestion on external event |
| **`S3IngestorTaskAgent`** | `POST` | `/api/ingestion/{resourceName}/sync` | `sync` | Triggers full/incremental S3 sync |
| | `GET` | `/api/ingestion/{resourceName}/status` | `getStatus` | Returns worker status, cursor position, and metrics |
| | `POST` | `/api/ingestion/{resourceName}/reset` | `resetCursor` | Resets sync cursor to force rescan |
| | `POST` | `/api/ingestion/{resourceName}/batch-callback` | `awaitBatchJob` | Allocates durable one-shot webhook and awaits external completion |

---

## 3. Proposed Changes

### Configuration
#### [MODIFY] [`golem.yaml`](../../golem.yaml)
- Add `KnowledgeAccessAgent`, `IngestionCoordinatorAgent`, and `S3IngestorTaskAgent` to `httpApi.deployments.local`.

### Domain & Agent Schemas
#### [MODIFY] [`src/agents/types.ts`](../../src/agents/types.ts)
- Add webhook request/response schemas for stable webhook ingress (`WebhookIngestPayloadSchema`) and durable one-shot callbacks (`BatchJobCallbackResultSchema`).

### Agent Implementations
#### [MODIFY] [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)
- Add `http: Http.mount("/api/knowledge", { cors: ["*"] })` to `KnowledgeAccessAgent`.
- Add `http: [...]` route annotations to all methods (`search`, `getEntity`, `getNeighborhood`, `findPaths`, `graphRag`, `ask`, `getOverview`).

#### [MODIFY] [`src/agents/coordinator-agent.ts`](../../src/agents/coordinator-agent.ts)
- Add `http: Http.mount("/api/coordinator", { cors: ["*"] })` to `IngestionCoordinatorAgent`.
- Add `http: [...]` route annotations to administrative methods (`getSystemStatus`, `registerSchedule`, `triggerSync`, `pauseSchedule`, `resumeSchedule`).
- Add `ingestWebhook` method exposing a stable push webhook endpoint `/webhook/{sourceType}/{resourceName}`.

#### [MODIFY] [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts)
- Add `http: Http.mount("/api/ingestion/{resourceName}", { cors: ["*"] })` to `S3IngestorTaskAgent`.
- Add `http: [...]` route annotations to worker methods (`sync`, `getStatus`, `resetCursor`).
- Implement `awaitBatchJob` leveraging `Webhook.create` and `handle.await`.

### Automated Testing
#### [NEW] [`test/http-gateway.test.ts`](../../test/http-gateway.test.ts)
- Test HTTP route bindings, endpoint path variable extraction, query/body parameter schema validation, response mapping, and webhook payloads.

---

## 4. Verification Plan

### Automated Validation Suite (5-Stage Validation)
1. **Code Formatting**:
   ```bash
   npm run format:check
   ```
2. **Static Analysis & Linting**:
   ```bash
   npm run lint
   ```
3. **Type Checking**:
   ```bash
   npm run typecheck
   ```
4. **Automated Tests**:
   ```bash
   npm test
   ```
   Verify that all existing tests and new Phase 6 tests pass cleanly.
5. **Golem WASM Build**:
   ```bash
   npm run build # golem build --yes
   ```
   Verify that the QuickJS WASM component compiles and preinitializes with all HTTP metadata embedded.

---

## 5. Risks & Considerations

1. **Golem SDK Route Binding Constraints**:
   - Every placeholder `{var}` in mount and endpoint paths must strictly match the TypeScript parameter casing.
   - For bodyful methods (`POST`, `PUT`), parameters not bound to path/query become JSON body fields of the same name.
   - `Schema.NullOr(T)` enables 404 response mapping on `null`.
2. **One-Shot Webhooks and Compute Suspension**:
   - `Webhook.create` requires an active HTTP mount on the agent.
   - `handle.await` durably suspends the agent fiber in Golem's runtime without polling or CPU consumption.
