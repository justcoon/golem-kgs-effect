# Implementation Walkthrough: Simplify Edges Table with Compound Primary Key

## Summary of Implementation

We simplified the knowledge graph relationship data model by replacing the synthetic `id VARCHAR(255) PRIMARY KEY` and dormant temporal columns (`valid_from`, `valid_until`) with a natural compound primary key:

```sql
PRIMARY KEY (source_id, target_id, relation_type)
```

This eliminates redundant indexes, removes artificial string ID concatenation across the ingestion and extraction pipeline, simplifies SQL queries and upserts, and aligns the `edges` table with existing compound key patterns (like `entity_chunks`).

---

## Changes Implemented

### 1. Relational Schema & Indexes
- **File**: [`migrations/002_graph_tables.sql`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/migrations/002_graph_tables.sql)
  - Dropped `id VARCHAR(255) PRIMARY KEY`.
  - Dropped `valid_from TIMESTAMPTZ` and `valid_until TIMESTAMPTZ`.
  - Replaced `CONSTRAINT uq_edge_source_target_relation UNIQUE (source_id, target_id, relation_type)` with `PRIMARY KEY (source_id, target_id, relation_type)`.
  - Removed redundant `idx_edges_source ON edges(source_id, relation_type)` (the compound primary key's leftmost prefix naturally serves queries on `source_id` and `(source_id, relation_type)`).
  - Preserved `idx_edges_target ON edges(target_id, relation_type)` for inbound traversal and `idx_edges_properties ON edges USING gin(properties)` for JSONB attributes.

### 2. Domain Models & Schemas
- **File**: [`src/domain/relationship.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/relationship.ts)
  - Removed `id`, `validFrom`, and `validUntil` from the `Edge` struct schema.
  - Removed `id`, `validFrom`, and `validUntil` from the `CreateEdgeInput` schema.

### 3. Storage Layer
- **File**: [`src/storage/repository-tags.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/repository-tags.ts)
  - Updated `GraphRepositoryShape.deleteEdge` signature to:
    ```typescript
    deleteEdge: (sourceId: string, targetId: string, relationType: string) => Effect.Effect<boolean, SqlError>
    ```
- **File**: [`src/storage/graph-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/graph-repository.ts)
  - Updated `EdgeRow` and `mapEdgeRow` to remove `id`, `valid_from`, and `valid_until`.
  - Updated `upsertEdge` to eliminate synthetic `edgeId` string formatting; now performs direct upsert into `(source_id, target_id, relation_type, weight, confidence, properties, updated_at)`.
  - Updated `findEdge`, `getOutboundEdges`, `getInboundEdges`, and `queryEdgesForFrontier` (all 6 branches) projections to select only active fields.
  - Updated `getNeighborhood` to deduplicate edges in memory using the compound key `${edge.sourceId}_${edge.relationType}_${edge.targetId}`.
  - Updated `deleteEdge` to delete by `WHERE source_id = ${sourceId} AND target_id = ${targetId} AND relation_type = ${relationType}`.

### 4. Ingestion & Extraction Pipeline
- **File**: [`src/pipeline/extractor.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/extractor.ts)
  - Removed synthetic `edgeId` generation in both rule-based extraction and co-occurrence extraction.
- **File**: [`src/pipeline/entity-resolver.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/entity-resolver.ts)
  - Removed `id: existing.id` when calling `graphRepo.upsertEdge`.

### 5. API Gateway & Agents
- **File**: [`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts)
  - Removed `id: Schema.String` from `EdgeResultSchema`.
- **File**: [`src/agents/access-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts)
  - Removed `id: e.id` mapping in `getNeighborhood`, `findPaths`, `overview`, and `ask` methods.

### 6. Frontend
- **File**: [`frontend/src/types/api.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/types/api.ts)
  - Removed `id: string` from `EdgeResult` interface.
- **File**: [`frontend/src/views/GraphView.vue`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/GraphView.vue)
  - Updated table row key to `:key="\`${edge.sourceId}-${edge.relationType}-${edge.targetId}\`"`.
- **File**: [`frontend/src/views/AskView.vue`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/AskView.vue)
  - Updated grounded relationships pill key to `:key="\`${edge.sourceId}-${edge.relationType}-${edge.targetId}\`"`.

---

## Verification Results

### 1. Code Formatting
```bash
npm run format:check
```
**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 2. TypeScript Compilation
```bash
npm run typecheck
```
**Result**:
```text
> tsc --noEmit
# Exit code 0
```

### 3. Linter Check
```bash
npm run lint
```
**Result**:
```text
> eslint src/ test/
# 0 errors, 2 pre-existing type warnings in configuration
```

### 4. Automated Tests
```bash
npm test
```
**Result**:
```text
ℹ tests 105
ℹ suites 41
ℹ pass 105
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1292.853757
```

### 5. Golem WASM Component Build
```bash
npm run build
```
**Result**:
```text
> build
> golem build --yes

Selecting components
  Found components: golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
Done! Input: 12616.4 KB, Output: 36320.8 KB
Adding metadata to components
Finished building [OK]
```
