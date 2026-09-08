# Feature Implementation Plan: Co-occurrence & Proximity Relation Extraction

## Overview & Goals
Currently, relationship extraction strictly relies on a 1–3 word regular expression requiring an exact grammatical pattern `<Entity1> <trigger_phrase> <Entity2>`. In technical documentation, bullet points, and markdown prose, entities rarely appear immediately adjacent to trigger phrases like `depends on`, which previously resulted in 0 extracted edges.

This feature adds **configurable Co-occurrence and Proximity Graph Extraction** to the pipeline:
1. Automatically discovers relationships (`CO_OCCURS_WITH` or `RELATES_TO`) between entities co-occurring within the same sentence or chunk.
2. Supports structured configuration nested under `extraction.cooccurrence`:
   - `enabled`: boolean toggle (`true` by default)
   - `window`: `"sentence"` or `"chunk"` (`"sentence"` by default)
   - `confidence`: edge confidence float (default `0.75`)
   - `relation`: edge relation type (default `"CO_OCCURS_WITH"`, dynamically configurable to any relation name)
   - `maxEdgesPerChunk`: edge cap per chunk to prevent dense clique explosions (default `25`)
3. **Dynamic Configuration-Driven Relations**: Removes the restrictive hardcoded `RelationType` enum restriction. Relationships are open-ended strings driven by configuration (`relationPatterns` and `cooccurrence.relation`) and stored as `VARCHAR(100)` in PostgreSQL.
4. Also matches canonical dictionary terms in text (e.g., "Golem Cloud", "PostgreSQL", "Docker") in addition to aliases.
5. Preserves full backward compatibility with explicit phrase-based relation rules (`DEPENDS_ON`, `AUTHORED_BY`, etc.).

---

## User Review Required

> [!IMPORTANT]
> **Configuration-Driven Relations**: `RelationType` in `src/domain/relationship.ts` is an open-ended `Schema.String` rather than a closed enum, aligning with `Edge.relationType: Schema.String`, `RelationPatternRuleSchema.relation: Schema.String`, and the `VARCHAR(100)` database column. Any relation defined in `golem.yaml` is fully supported.
>
> **Nested Configuration**: The co-occurrence options are grouped under `extraction.cooccurrence` in `golem.yaml`:
> ```yaml
> extraction:
>   cooccurrence:
>     enabled: true
>     window: "sentence"
>     confidence: 0.75
>     relation: "CO_OCCURS_WITH"
>     maxEdgesPerChunk: 25
> ```

---

## Proposed Changes

### 1. Domain Model
#### [MODIFY] [src/domain/relationship.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/relationship.ts)
- Update `RelationType` to `Schema.String` (with `DefaultRelationTypes` exported as reference constants) so relations are fully configuration-driven and open-ended.

### 2. Configuration Schemas
#### [MODIFY] [src/config/schema.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts)
- `CooccurrenceConfigSchema` is defined and embedded under `ExtractionConfigSchema`:
  ```typescript
  export const CooccurrenceConfigSchema = Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    window: Schema.optional(Schema.Literals(["sentence", "chunk"])),
    confidence: Schema.optional(Schema.Number),
    relation: Schema.optional(Schema.String),
    maxEdgesPerChunk: Schema.optional(Schema.Number),
  });
  export type CooccurrenceConfig = typeof CooccurrenceConfigSchema.Type;
  ```

#### [MODIFY] [golem.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml)
- Configure `cooccurrence` under `components.golem-kgs-effect:effect-main.config.extraction`.

### 3. Pipeline Extractor
#### [MODIFY] [src/pipeline/extractor.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/extractor.ts)
- Update `ExtractionRules` interface:
  - Add `readonly cooccurrence?: CooccurrenceConfig;`.
- Enhance dictionary matching:
  - Match both alias and canonical names in text.
- Implement Co-occurrence Edge Extraction:
  - Read `rules?.cooccurrence` with fallback defaults.
  - Track existing entity pairs to avoid duplicate or redundant edges.
  - Handle window mode (`"sentence"` vs `"chunk"`).
  - Search entity occurrences in the target unit (by entity name or alias).
  - Construct edges with ordered source/target based on text appearance order (`edge_${source.id}_${rel.toLowerCase()}_${target.id}`).
  - Enforce `maxEdgesPerChunk` cap and avoid self-loops.

### 4. Automated Tests
#### [MODIFY] [test/pipeline.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/pipeline.test.ts)
- Validate `CooccurrenceConfigSchema` decoding and nested schema parsing.

#### [MODIFY] [test/domain-schemas.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/domain-schemas.test.ts)
- Update relation type tests to verify open-ended string acceptance for configuration-driven relations.

#### [NEW] [test/cooccurrence-extractor.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/cooccurrence-extractor.test.ts)
- Unit tests verifying:
  - Entities in the same sentence produce `CO_OCCURS_WITH` edges.
  - Entities across different sentences link under `window: "chunk"`, but not under `window: "sentence"`.
  - Disabling co-occurrence (`enabled: false`) extracts 0 co-occurrence edges.
  - `maxEdgesPerChunk` cap is respected.
  - Canonical dictionary term matching works without explicit alias matches.

---

## Verification Plan

### Automated Tests
1. **Formatting**:
   ```bash
   npm run format:check
   ```
2. **Linting**:
   ```bash
   npm run lint
   ```
3. **Type Checking**:
   ```bash
   npm run typecheck
   ```
4. **Unit Tests**:
   ```bash
   npm test
   ```
5. **Golem WASM Build**:
   ```bash
   npm run build
   ```

### Runtime Verification
1. Verify endpoint deployment and status:
   ```bash
   curl -s http://localhost:9006/api/knowledge/overview
   ```
2. Trigger incremental sync:
   ```bash
   curl -X POST 'http://localhost:9006/api/ingestion/main/sync' -H 'Content-Type: application/json' -d '{"force": true}'
   ```
3. Verify that `totalRelationships` is populated with generated edges.
