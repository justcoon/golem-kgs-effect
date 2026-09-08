# Feature Plan: Phase 4 - Durable Agent Implementation

- **Feature ID / Slug**: `phase-4-durable-agents`
- **Date**: 2026-09-06
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

With Phase 1 (Foundations & Storage Substrate), Phase 2 (Processing Pipeline & Semantic Services), and Phase 3 (Base Connector Framework & S3 Ingestion) complete and approved, **Phase 4** implements the **Durable Agent Topology and Orchestration Layer**.

In Golem, durable agents provide persistent virtual compute actors whose execution state, operation log, and memory are guaranteed across host restarts, node migrations, and network disruptions. Phase 4 operationalizes the entire end-to-end ingestion and query pipeline into three dedicated agent types:

1. **Multi-Prefix Resource Configuration & S3 Connector Enhancement**:
   - Enhance `S3ResourceTargetSchema` in [`src/config/schema.ts`](../../src/config/schema.ts) with `prefixes: Schema.optional(Schema.Array(Schema.String))`.
   - Allows an S3 resource in [`golem.yaml`](../../golem.yaml) to configure an optional list of folder prefixes (e.g. `prefixes: ["rfcs/", "specs/"]`). If omitted or empty, it scans the entire bucket root.
   - Update `S3Connector` in [`src/connectors/s3-connector.ts`](../../src/connectors/s3-connector.ts) to iterate across each configured prefix during `discover`.
2. **`S3IngestorTaskAgent` (Durable Resource Worker)**:
   - Dedicated durable worker whose identity is bound 1:1 to a named S3 resource target:
     ```typescript
     constructorParams: {
       resourceName: Schema.String,
     }
     ```
   - Automatically loads its target bucket, `prefixes`, endpoint, and credentials from `ResourcesConfigValues`.
   - Drives S3 object discovery across all configured prefixes, content retrieval, chunking, embedding generation, entity extraction, resolution, and relational PostgreSQL persistence.
   - Durably records incremental sync cursors (`lastSyncTimestamp`, `processedKeys`) and operational metrics using Golem schema-backed snapshots (`Snapshot.define(...)`).
3. **`IngestionCoordinatorAgent` (Durable Supervisor)**:
   - Central coordinator maintaining the catalog of configured sources, tracking synchronization status, and supervising workers.
   - Orchestrates automated recurring synchronization using **Golem native host scheduling** (`.schedule(...)`), durably suspending with zero compute consumption between scheduled runs.
4. **`KnowledgeAccessAgent` (Stateless Ephemeral Retrieval Gateway)**:
   - High-throughput query gateway (`mode: "ephemeral"`) allowing concurrent client requests without sequential queueing.
   - Provides entity lookups, graph neighborhood traversals, and hybrid vector/lexical search.
5. **Runtime Registration & Manifest Configuration**:
   - Register all agents in `src/main.ts` and `golem.yaml`.
6. **Comprehensive Testing**:
   - Unit and mock integration tests in `test/agents.test.ts` validating state snapshots, multi-prefix discovery, agent RPC dispatching, and orchestration logic.

### Non-Goals

- Deep GraphRAG context packaging with LLM synthesis (Phase 5).
- Public HTTP gateway route mounts and domain bindings (Phase 6).

---

## 2. Architecture & Agent Topology

```
 ┌───────────────────────────────────────────────────────────────┐
 │               IngestionCoordinatorAgent (Durable)            │
 │ • Constructor: { coordinatorId: string }                      │
 │ • State Snapshot: Active sync schedules & aggregated metrics   │
 │ • Golem Native Scheduler (.schedule) for recurring sync       │
 └───────────────────────────────┬───────────────────────────────┘
                                 │
                   Dispatches via Typed RPC Handle
                                 │
                                 ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                S3IngestorTaskAgent (Durable)                  │
 │ • Constructor: { resourceName: string }                       │
 │ • Reads Target Config (bucket, prefixes: ["rfcs/", "specs/"]) │
 │ • State Snapshot: { lastSyncTimestamp, processedKeys, status }│
 │ • Executes: S3Connector ──▶ Chunker ──▶ EmbeddingService      │
 │             ──▶ EntityExtractor ──▶ EntityResolver            │
 │             ──▶ Repositories (PostgreSQL)                     │
 └───────────────────────────────────────────────────────────────┘

 ┌───────────────────────────────────────────────────────────────┐
 │             KnowledgeAccessAgent (Stateless Ephemeral)        │
 │ • Constructor: {} (Singleton)                                 │
 │ • Mode: "ephemeral" (Independent handler per request)         │
 │ • High-concurrency read queries: entity, neighborhood, search │
 └───────────────────────────────────────────────────────────────┘
```

### 2.1 Multi-Prefix Resource Specification

In [`golem.yaml`](../../golem.yaml):
```yaml
secretDefaults:
  local:
    resources:
      s3:
        main:
          endpoint: "{{ S3_ENDPOINT_URL }}"
          region: "{{ AWS_DEFAULT_REGION }}"
          bucket: "golem-documents"
          prefixes:
            - "technical-docs/"
            - "rfcs/"
          accessKeyId: "{{ AWS_ACCESS_KEY_ID }}"
          secretAccessKey: "{{ AWS_SECRET_ACCESS_KEY }}"
        legal:
          endpoint: "{{ S3_ENDPOINT_URL }}"
          region: "{{ AWS_DEFAULT_REGION }}"
          bucket: "legal-docs"
          # Omitted or empty prefixes -> scans the whole bucket root
          accessKeyId: "{{ AWS_ACCESS_KEY_ID }}"
          secretAccessKey: "{{ AWS_SECRET_ACCESS_KEY }}"
```

---

## 3. Proposed Changes

| Action     | File Path                                                                     | Purpose                                                                             |
| :--------- | :---------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                          | Add optional `prefixes: Schema.optional(Schema.Array(Schema.String))` to target    |
| `[MODIFY]` | [`src/connectors/s3-connector.ts`](../../src/connectors/s3-connector.ts)      | Support iterating over multiple configured `prefixes` during discovery              |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                              | Add `prefixes` list example under resources and register agents                     |
| `[NEW]`    | [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts)            | `S3IngestorTaskAgent` implementation with durable snapshot, sync loop, and metrics  |
| `[NEW]`    | [`src/agents/coordinator-agent.ts`](../../src/agents/coordinator-agent.ts)    | `IngestionCoordinatorAgent` implementation with native Golem scheduling & registry   |
| `[NEW]`    | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)              | `KnowledgeAccessAgent` ephemeral query agent for graph & vector search             |
| `[NEW]`    | [`src/agents/index.ts`](../../src/agents/index.ts)                            | Barrel exports for agent definitions and clients                                    |
| `[MODIFY]` | [`src/main.ts`](../../src/main.ts)                                            | Import agent implementation modules for runtime registration                        |
| `[NEW]`    | [`test/agents.test.ts`](../../test/agents.test.ts)                            | Unit tests for agent schemas, snapshots, and orchestration flows                    |

---

## 4. Verification Plan

### 4.1 Automated Validation Suite
1. **Formatting**: `npm run format:check` (Prettier)
2. **Linting**: `npm run lint` (ESLint)
3. **Type Checking**: `npm run typecheck` (`tsc --noEmit` with `strict: true`)
4. **Unit Tests**: `npm test` (`tsx --test`) covering Phase 1 through Phase 4 test suites.
5. **Golem Build**: `npm run build` (`golem build --yes`) compiling QuickJS WASM with all agents registered.

### 4.2 Walkthrough Artifact
- Generate `docs/implementation/phase-4-durable-agents_implementation_walkthrough.md`.
- Mark `phase-4-durable-agents_feature_plan.md` as `Completed`.
