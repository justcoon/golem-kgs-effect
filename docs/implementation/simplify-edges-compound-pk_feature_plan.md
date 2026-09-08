# Feature Implementation Plan: Simplify Edges Table with Compound Primary Key

## 1. Overview & Goals

The `edges` table represents directed relationships in the knowledge graph between entities. Currently, the schema defines an `id VARCHAR(255) PRIMARY KEY`, accompanied by a separate constraint `CONSTRAINT uq_edge_source_target_relation UNIQUE (source_id, target_id, relation_type)`, and two unused temporal columns `valid_from` and `valid_until`.

In the application:
1. Relationships are consolidated on conflict (`ON CONFLICT (source_id, target_id, relation_type) DO UPDATE SET weight = ..., confidence = ...`).
2. The `id` column is merely a synthetic string concatenation of the three natural key columns (`edge_${sourceId}_${relationType}_${targetId}`).
3. The temporal columns `valid_from` and `valid_until` are never extracted by the pipeline, never filtered by queries, and only make sense in a temporal multigraph model with duplicate edges (which is prohibited by the uniqueness constraint).

### Goals
- **Simplify the Relational Schema**: Convert `edges` to use a natural compound primary key: `PRIMARY KEY (source_id, target_id, relation_type)`.
- **Remove Redundant Columns & Indexes**: Drop `id`, `valid_from`, and `valid_until`. Drop redundant `uq_edge_source_target_relation` (PK handles this) and `idx_edges_source` (leftmost prefix of PK covers it).
- **Streamline the Domain Model & Repositories**: Remove synthetic edge ID generation, remove unused date fields from `Edge` and `CreateEdgeInput` domain schemas and `EdgeResultSchema`.
- **Align UI & Services**: Update frontend and test fixtures to identify edges by their natural compound tuple `(sourceId, relationType, targetId)`.

---

## 2. Architecture & Technical Design

### 2.1 Database Schema Changes (`migrations/002_graph_tables.sql`)

```sql
-- Directed Graph Relationships (Edges)
CREATE TABLE IF NOT EXISTS edges (
    source_id VARCHAR(255) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id VARCHAR(255) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation_type VARCHAR(100) NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    confidence REAL NOT NULL DEFAULT 1.0,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_edges_properties ON edges USING gin(properties);
```

*Note*:
- `PRIMARY KEY (source_id, target_id, relation_type)` creates a composite B-tree index on `(source_id, target_id, relation_type)`. Queries filtering by `source_id` or `(source_id, relation_type)` utilize this index directly, eliminating the need for `idx_edges_source`.
- `idx_edges_target ON edges(target_id, relation_type)` is preserved for inbound queries.
- `idx_edges_properties` is preserved for property JSONB filtering.

### 2.2 Domain Schema Updates (`src/domain/relationship.ts`)

```typescript
export const Edge = Schema.Struct({
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.Number,
  confidence: Schema.Number,
  properties: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});

export const CreateEdgeInput = Schema.Struct({
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
```

### 2.3 Storage Repository Changes (`src/storage/graph-repository.ts` & `src/storage/repository-tags.ts`)

- **`EdgeRow` & `mapEdgeRow`**: Remove `id`, `valid_from`, `valid_until`.
- **`upsertEdge`**: Remove synthetic `edgeId` computation. Direct insert into `(source_id, target_id, relation_type, weight, confidence, properties, updated_at)`.
- **`deleteEdge`**: Update signature to `deleteEdge(sourceId: string, targetId: string, relationType: string)` to delete directly by the compound primary key.
- **`findEdge`**, **`getOutboundEdges`**, **`getInboundEdges`**, **`queryEdgesForFrontier`**: Update `SELECT` projection to exclude `id`, `valid_from`, `valid_until`.

### 2.4 Agent Schema & Response Model (`src/agents/types.ts` & `src/agents/access-agent.ts`)

- `EdgeResultSchema` in `src/agents/types.ts`: Remove `id: Schema.String`.
- `access-agent.ts`: Map edges directly without passing synthetic `id`.

### 2.5 Frontend Adjustments (`frontend/`)

- `frontend/src/types/api.ts`: Remove `id: string` from `EdgeResult`.
- `frontend/src/views/GraphView.vue` and `frontend/src/views/AskView.vue`: Change `:key="edge.id"` to composite key template `:key="\`${edge.sourceId}-${edge.relationType}-${edge.targetId}\`"`.

---

## 3. File-by-File Changes

### Database Layer
- **[MODIFY] [migrations/002_graph_tables.sql](file:///Users/coon/workspace-zv/git/golem-kgs-effect/migrations/002_graph_tables.sql)**:
  - Update `edges` table DDL: remove `id`, `valid_from`, `valid_until`, and `uq_edge_source_target_relation`.
  - Add `PRIMARY KEY (source_id, target_id, relation_type)`.
  - Remove redundant `idx_edges_source`.

### Domain & Storage Layer
- **[MODIFY] [src/domain/relationship.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/relationship.ts)**:
  - Remove `id`, `validFrom`, `validUntil` from `Edge` and `CreateEdgeInput` schemas and types.
- **[MODIFY] [src/storage/repository-tags.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/repository-tags.ts)**:
  - Update `GraphRepositoryShape.deleteEdge` parameter to `(sourceId: string, targetId: string, relationType: string)`.
- **[MODIFY] [src/storage/graph-repository.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/graph-repository.ts)**:
  - Update `EdgeRow` and `mapEdgeRow`.
  - Update `upsertEdge`, `findEdge`, `getOutboundEdges`, `getInboundEdges`, `queryEdgesForFrontier`, and `deleteEdge`.

### Agent & API Gateway Layer
- **[MODIFY] [src/agents/types.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts)**:
  - Update `EdgeResultSchema` to remove `id`.
- **[MODIFY] [src/agents/access-agent.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts)**:
  - Remove `id` mapping in neighborhood and path endpoints.
- **[MODIFY] [openapi.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/openapi.yaml)**:
  - Remove `id` from embedded edge schemas if present.

### Frontend Layer
- **[MODIFY] [frontend/src/types/api.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/types/api.ts)**:
  - Remove `id` from `EdgeResult`.
- **[MODIFY] [frontend/src/views/GraphView.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/GraphView.vue)**:
  - Update template loop `:key="edge.id"` to `:key="\`${edge.sourceId}-${edge.relationType}-${edge.targetId}\`"`.
- **[MODIFY] [frontend/src/views/AskView.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/AskView.vue)**:
  - Update template loop `:key="edge.id"` to `:key="\`${edge.sourceId}-${edge.relationType}-${edge.targetId}\`"`.

### Test Suite
- **[MODIFY] [test/domain-schemas.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/domain-schemas.test.ts)**:
  - Update `Edge` schema test fixtures.
- **[MODIFY] [test/graphrag.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/graphrag.test.ts)**:
  - Update mock edge fixtures and `deleteEdge` mock.
- **[MODIFY] [test/http-gateway.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/http-gateway.test.ts)**:
  - Update edge schema assertions.
- **[MODIFY] [test/agents.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/agents.test.ts)**:
  - Update mock edge fixtures and mock repository methods.
- **[MODIFY] [test/entity-resolution.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/entity-resolution.test.ts)**:
  - Update edge assertions.

---

## 4. Verification Plan

### Automated Checks
1. **Formatting**:
   ```bash
   npm run format:check
   ```
2. **Type Checking**:
   ```bash
   npm run typecheck
   ```
3. **Linting**:
   ```bash
   npm run lint
   ```
4. **Unit & Integration Tests**:
   ```bash
   npm test
   ```
5. **Golem WASM Build**:
   ```bash
   npm run build
   ```

---

## 5. Risks & Mitigations

- **Risk**: Existing data in production PostgreSQL with `id` column.
  - *Mitigation*: This is currently a greenfield/development deployment; `migrations/002_graph_tables.sql` sets up the schema cleanly. If existing data exists, an `ALTER TABLE edges DROP CONSTRAINT edges_pkey, DROP COLUMN id, DROP COLUMN valid_from, DROP COLUMN valid_until, ADD PRIMARY KEY (source_id, target_id, relation_type);` migration can be applied.
- **Risk**: Frontend rendering performance with template literal key.
  - *Mitigation*: String interpolation for keys in Vue `:key="\`${edge.sourceId}-${edge.relationType}-${edge.targetId}\`"` is fast and standard for composite unique items.
