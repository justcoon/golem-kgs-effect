# Co-occurrence Relation Extraction Implementation Walkthrough

## Summary of Implementation
We implemented configuration-driven Co-occurrence Relation Extraction and opened `RelationType` to support dynamic, configuration-defined relation types. This completes the knowledge graph extraction pipeline by generating semantic proximity edges (`CO_OCCURS_WITH`) when entities appear together within configured sentence or chunk windows.

---

## Changes Implemented

### 1. Dynamic Relation Types
- File: [`src/domain/relationship.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/relationship.ts)
  - Converted `RelationType` from a rigid `Schema.Literals([...])` union into an open-ended `Schema.String`.
  - Added `DefaultRelationTypes` export (`["AUTHORED_BY", "DEPENDS_ON", "PART_OF", "DISCUSSES", "OWNS", "RELATES_TO", "MEMBER_OF", "MENTIONS", "CO_OCCURS_WITH"] as const`).
- File: [`test/domain-schemas.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/domain-schemas.test.ts)
  - Updated test to verify `RelationType` parses custom string relations and includes `CO_OCCURS_WITH` in `DefaultRelationTypes`.

### 2. Configuration Schema & Manifest
- File: [`src/config/schema.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts)
  - Added `CooccurrenceConfigSchema` with fields:
    - `enabled?: boolean`
    - `window?: "sentence" | "chunk"` (defaults to `"sentence"`)
    - `confidence?: number` (defaults to `0.75`)
    - `relation?: string` (defaults to `"CO_OCCURS_WITH"`)
    - `maxEdgesPerChunk?: number` (defaults to `25`)
  - Nested `cooccurrence: Schema.optional(CooccurrenceConfigSchema)` under `ExtractionConfigSchema`.
- File: [`golem.yaml`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml)
  - Configured `cooccurrence` under `components.golem-kgs-effect:effect-main.config.extraction`.

### 3. Pipeline Extractor Logic
- File: [`src/pipeline/extractor.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/extractor.ts)
  - Updated `ExtractionRules` interface to accept `readonly cooccurrence?: CooccurrenceConfig;`.
  - Enhanced dictionary matching to test for both alias and canonical terms in text.
  - Added entity slug deduplication in `addEntity` to avoid duplicate entity definitions across dictionary and title case matchers.
  - Implemented `findEntityFirstIndex` to identify character positions of entities or their aliases within text segments.
  - Implemented Section 6: Co-occurrence Edge Extraction:
    - Splits chunk into windows according to `windowMode` (`"sentence"` vs `"chunk"`).
    - Sorts entities by appearance position to guarantee reading order `sourceId -> targetId`.
    - Deduplicates undirected entity pairs using `[first.id, second.id].sort().join("<->")`.
    - Caps edge count at `maxEdgesPerChunk`.

### 4. Test Suite
- File: [`test/cooccurrence-extractor.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/cooccurrence-extractor.test.ts)
  - Disabled / undefined behavior: 0 edges generated.
  - Sentence window isolation: entities within same sentence produce edges; cross-sentence pairs are not connected.
  - Chunk window: cross-sentence entities within chunk produce edges.
  - Edge capping: `maxEdgesPerChunk: 2` limits generated edges.
  - Canonical dictionary term matching: canonical names match without needing aliases.
  - Pair deduplication: repeated mentions across sentences do not duplicate edges.

---

## 5-Stage Verification Results

| Stage | Command | Result | Details |
|---|---|---|---|
| **1. Formatting** | `npm run format:check` | ✅ PASSED | All source and test files formatted with Prettier |
| **2. Linting** | `npm run lint` | ✅ PASSED | 0 errors |
| **3. Typechecking** | `npm run typecheck` | ✅ PASSED | TypeScript 0 errors with strict indexing |
| **4. Automated Tests** | `npm test` | ✅ PASSED | **86 passing** tests across 37 suites (0 failures) |
| **5. WASM Build** | `npm run build` | ✅ PASSED | Rollup bundled, injected into QuickJS WASM, Wizer pre-initialized (36.1 MB) |
