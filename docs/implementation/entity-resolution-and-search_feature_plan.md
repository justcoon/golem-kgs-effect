# Feature Implementation Plan: Entity Resolution, Enrichment & Search for Neighborhood & Path APIs

## Overview & Goals

The Knowledge Graph frontend and API clients currently suffer from two usability issues when exploring neighborhoods (`/api/knowledge/neighborhood`) or discovering multi-hop paths (`/api/knowledge/paths`):

1. **Input Issue (IDs Required as Input)**: The endpoints require internal database IDs (e.g. `ent_technology_postgresql`) rather than human-readable names (e.g. `"PostgreSQL"`) or aliases (e.g. `"postgres"`). Users cannot be expected to know internal database IDs.
2. **Output Issue (Raw IDs Returned without Names)**: Previously, `NeighborhoodResponse` returned only `entityIds: string[]`. As a result, the graph canvas (`GraphCanvas.vue`), path chains, and the relationships table rendered truncated IDs (`ent_technology_po…`) rather than human names like `PostgreSQL` and entity types like `[TECHNOLOGY]`.

To avoid redundant data payloads, we do **not** duplicate both `entityIds` and `entities`. Instead:
- In `NeighborhoodResponse`: Replace `entityIds: string[]` entirely with `entities: EntityResult[]` (since each `EntityResult` already contains `id`, `name`, `entityType`, `description`, etc.).
- In `PathFindingResult`: Keep `path.entityIds: string[]` solely to record the ordered hop sequence (e.g. `[A, B, C]`), and provide `entities: EntityResult[]` as the top-level entity lookup pool for those paths.

---

## User Review Required

> [!IMPORTANT]
> - **Clean Non-Redundant Contracts**: `NeighborhoodResponse` returns `{ entities: EntityResult[], edges: EdgeResult[] }`. Clients have access to full entity metadata (including `.id`) without transferring redundant ID arrays.
> - **Transparent Input Resolution**: Callers can supply human-readable names (`"PostgreSQL"`), aliases (`"postgres"`), or internal IDs (`"ent_technology_postgresql"`). The backend automatically resolves them before querying the graph.

---

## Proposed Changes

### 1. Agent Contracts & Schemas (`src/agents/`)

#### [MODIFY] [`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts)
- Update `NeighborhoodResponseSchema`:
  ```ts
  export const NeighborhoodResponseSchema = Schema.Struct({
    entities: Schema.Array(EntityResultSchema),
    edges: Schema.Array(EdgeResultSchema),
  });
  export type NeighborhoodResponse = typeof NeighborhoodResponseSchema.Type;
  ```
- Update `PathFindingResultSchema`:
  ```ts
  export const PathFindingResultSchema = Schema.Struct({
    paths: Schema.Array(GraphPathSchema),
    entities: Schema.Array(EntityResultSchema),
    shortestPathLength: Schema.NullOr(Schema.Number),
  });
  export type PathFindingResult = typeof PathFindingResultSchema.Type;
  ```
- Add `EntitySearchResponseSchema`:
  ```ts
  export const EntitySearchResponseSchema = Schema.Struct({
    entities: Schema.Array(EntityResultSchema),
    total: Schema.Number,
    query: Schema.String,
  });
  export type EntitySearchResponse = typeof EntitySearchResponseSchema.Type;
  ```

#### [MODIFY] [`src/agents/access-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts)
- Add entity resolution helper `resolveEntityId(input, entityRepo)`:
  - Exact ID (`findById`) -> Exact Name (`findByName`) -> Alias (`findByAlias`) -> Fuzzy match (`searchByName(..., 1)`) -> Fallback to input string.
- Add entity batch-loader `fetchEntitiesByIds(ids, entityRepo)`:
  - Fetches `Entity` objects and maps them to `EntityResult` records.
- Update `getNeighborhood`:
  - Resolves `entityId` before traversal.
  - Fetches and returns `entities: EntityResult[]` and `edges: EdgeResult[]`.
- Update `findPaths`:
  - Resolves `sourceEntityId` and `targetEntityId` before pathfinding.
  - Collects all unique entity IDs across all paths, fetches them, and returns `{ paths, entities, shortestPathLength }`.
- Add `searchEntities` method:
  - Input: `{ query: Schema.String, limit: Schema.optional(Schema.Number) }`
  - Output: `EntitySearchResponseSchema`
  - Endpoints: `Http.post("/entities/search")` and `Http.get("/entities/search?q={query}")`

---

### 2. Frontend Services & Components (`frontend/`)

#### [MODIFY] [`frontend/src/types/api.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/types/api.ts)
- Update `NeighborhoodResponse`:
  ```ts
  export interface NeighborhoodResponse {
    entities: EntityResult[];
    edges: EdgeResult[];
  }
  ```
- Update `PathFindingResult`:
  ```ts
  export interface PathFindingResult {
    paths: GraphPath[];
    entities: EntityResult[];
    shortestPathLength: number | null;
  }
  ```
- Add `EntitySearchResponse` interface.

#### [MODIFY] [`frontend/src/services/api.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/services/api.ts)
- Add `searchEntities(query: string, limit?: number): Promise<EntityResult[]>`.
- Update `getNeighborhood` and `findPaths` to normalize the returned `entities` array.

#### [MODIFY] [`frontend/src/components/GraphCanvas.vue`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/components/GraphCanvas.vue)
- Update props: replace `entityIds: string[]` with `entities: EntityResult[]`.
- Build nodes using `entity.id`, `name: entity.name`, `type: entity.entityType`.
- Render readable name `node.name` in SVG text labels.
- Color-code nodes by `entityType` (`CONCEPT`, `TECHNOLOGY`, `ORGANIZATION`, `DOCUMENT`).
- Hover/tooltip displays `Name`, `[EntityType]`, and internal `ID`.

#### [MODIFY] [`frontend/src/views/GraphView.vue`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/GraphView.vue)
- Store `graphEntities = ref<EntityResult[]>([])` and pass directly to `GraphCanvas`.
- Build `entityMap` computed property (`id -> EntityResult`).
- In Path Chain list: display readable entity names (`entityMap.get(id)?.name || id`) inside `.node-chip`.
- In Relationships table: display readable names for `source` and `target`.
- Add interactive autocomplete suggestions dropdown for `targetEntityId`, `sourceEntityId`, and `destEntityId` using `searchEntities`.
- Keep quick-select sample chips working seamlessly via transparent name resolution.

---

### 3. Verification & Tests

#### [NEW] [`test/entity-resolution.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/entity-resolution.test.ts)
- Test resolution helper:
  - Exact ID returns ID.
  - Exact name (e.g. "PostgreSQL") resolves to `ent_technology_postgresql`.
  - Alias (e.g. "KGS") resolves to `ent_concept_knowledge_graph_system`.
  - Case-insensitive / fuzzy match resolves to correct entity.
  - Unknown string returns original string.
- Test enriched response outputs:
  - `getNeighborhood` returns `entities: EntityResult[]` with names and types.
  - `findPaths` returns `entities: EntityResult[]` for all nodes along paths.
- Test `searchEntities` method and schema validation.

#### [MODIFY] [`test/http-gateway.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/http-gateway.test.ts)
- Update `NeighborhoodResponseSchema` test fixture to use `entities: EntityResult[]`.
- Update `PathFindingResultSchema` test fixture to include `entities: EntityResult[]`.
- Add route verification for `/api/knowledge/entities/search`.

#### [MODIFY] [`test/agents.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/agents.test.ts)
- Update any mock contracts expecting `NeighborhoodResponseSchema`.

---

## Verification Plan

### Automated Tests
```bash
# 1. Format check
npm run format:check

# 2. Linter check
npm run lint

# 3. TypeScript typecheck
npm run typecheck

# 4. Run test suite
npm test

# 5. Build WASM component with Golem SDK
npm run build
```
