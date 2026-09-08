# Feature Implementation Walkthrough: Phase 2 - Processing Pipeline & Semantic Services

- **Feature ID / Slug**: `phase-2-processing-pipeline`
- **Date**: 2026-09-06
- **Status**: Approved <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

Phase 2 ("Processing Pipeline & Semantic Services") has been fully implemented in accordance with the approved feature plan. This phase establishes the complete transformation pipeline that transforms raw ingested documents into structured knowledge graph entities and dense vector representations:

1. **Decoupled Embedding Configuration & Secrets**: Structured embedding settings (`api_base`, `model`) under `config.embedding` and sensitive tokens (`apiKey`) under `secretDefaults.local.embedding` in [`golem.yaml`](../../golem.yaml), paired with typed Effect schemas in [`src/config/schema.ts`](../../src/config/schema.ts) and Golem `defineConfig` in [`src/config/embedding-config.ts`](../../src/config/embedding-config.ts).
2. **Raw Document Storage Substrate**: Created [`DocumentRepository`](../../src/storage/document-repository.ts) to manage CRUD operations on the PostgreSQL `documents` table, ensuring relational foreign-key integrity before chunk persistence (`chunks.document_id REFERENCES documents(id)`).
3. **Markdown-Aware Document Chunker**: Implemented [`DocumentChunker`](../../src/pipeline/chunker.ts) featuring sliding window segmentation, token estimation, and recursive markdown header breadcrumb preservation.
4. **Resilient Vector Embedding Service**: Created [`EmbeddingService`](../../src/pipeline/embedding-service.ts) supporting 768-dimensional embeddings via Ollama (`nomic-embed-text`) or OpenAI-compatible endpoints using `effect/unstable/http`, complemented by a deterministic normalized mock layer for testing and offline execution.
5. **Entity & Relation Extraction Pipeline**: Built [`EntityExtractor`](../../src/pipeline/extractor.ts) supporting acronym detection, known technical vocabularies, and pattern-based relation extraction into canonical domain schema types.
6. **Entity Resolution & Bayesian Confidence Fusion**: Implemented [`EntityResolverService`](../../src/pipeline/entity-resolver.ts) and pure Bayesian score fusion in [`src/pipeline/fusion-utils.ts`](../../src/pipeline/fusion-utils.ts) for deduplication, alias resolution, and edge weight consolidation.
7. **Comprehensive Testing & Validation**: 25 out of 25 unit tests passing across all test suites, with zero lint errors, 100% strict type safety, and clean Golem WebAssembly compilation.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                              | Summary of Changes                                                                             |
| :--------- | :------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                       | Configured `config.embedding` (`api_base`, `model`) and `secretDefaults.local.embedding`     |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                                   | Added `EmbeddingConfigSchema`, `EmbeddingConfigFields`, and `EmbeddingConfigValues` Tag       |
| `[NEW]`    | [`src/config/embedding-config.ts`](../../src/config/embedding-config.ts)               | Implemented Golem `defineConfig` for embedding service and exported `ToValues` Layer           |
| `[MODIFY]` | [`src/config/index.ts`](../../src/config/index.ts)                                     | Exported `embedding-config.js`                                                                 |
| `[NEW]`    | [`src/storage/document-repository.ts`](../../src/storage/document-repository.ts)       | Implemented `DocumentRepository` service for raw document CRUD in `documents` table            |
| `[MODIFY]` | [`src/storage/index.ts`](../../src/storage/index.ts)                                   | Exported `document-repository.js`                                                              |
| `[NEW]`    | [`src/pipeline/chunker.ts`](../../src/pipeline/chunker.ts)                             | Implemented `DocumentChunker` with windowing, overlap, and markdown header context tracking   |
| `[NEW]`    | [`src/pipeline/embedding-service.ts`](../../src/pipeline/embedding-service.ts)         | Implemented `EmbeddingService` with Ollama/OpenAI HTTP client and deterministic `Mock` layer  |
| `[NEW]`    | [`src/pipeline/extractor.ts`](../../src/pipeline/extractor.ts)                         | Implemented `EntityExtractor` for candidate entity, acronym, and relation extraction          |
| `[NEW]`    | [`src/pipeline/fusion-utils.ts`](../../src/pipeline/fusion-utils.ts)                   | Pure Bayesian confidence fusion formula (`fuseConfidence`) isolated for host-agnostic testing  |
| `[NEW]`    | [`src/pipeline/entity-resolver.ts`](../../src/pipeline/entity-resolver.ts)             | Implemented `EntityResolverService` for deduplication, alias linking, and edge weight fusion  |
| `[NEW]`    | [`src/pipeline/index.ts`](../../src/pipeline/index.ts)                                 | Barrel export for all pipeline services, chunkers, and extractors                             |
| `[NEW]`    | [`test/pipeline.test.ts`](../../test/pipeline.test.ts)                                 | 10 comprehensive unit tests for chunking, embedding, extraction, fusion, and configuration    |
| `[MODIFY]` | [`docs/implementation/phase-2-processing-pipeline_feature_plan.md`](../../docs/implementation/phase-2-processing-pipeline_feature_plan.md) | Updated plan status from `Draft` to `Completed`                                               |

---

## 3. Key Logic & Architectural Highlights

### 3.1 Decoupled Configuration & Secret Handling

In [`src/config/schema.ts`](../../src/config/schema.ts) and [`src/config/embedding-config.ts`](../../src/config/embedding-config.ts):
- `EmbeddingConfigSchema` enforces typed URL and string schemas, wrapping `apiKey` in `Schema.Redacted(Schema.String)` so API tokens are never leaked in logs or error stacks.
- `EmbeddingConfig` exposes a `ToValues` layer that resolves the secret asynchronously (`yield* config.embedding.apiKey.get`) into plain `EmbeddingConfigValues`, cleanly decoupling the runtime HTTP service from Golem's host-specific config bindings during testing.

### 3.2 Relational Integrity: `DocumentRepository`

In [`src/storage/document-repository.ts`](../../src/storage/document-repository.ts):
- Interacts directly with the PostgreSQL `documents` table via `@golemcloud/effect-golem/postgres`.
- Supports `findById`, `findBySourceUri`, `save`, `updateStatus`, `delete`, and `listAll` with cursor/limit pagination.
- Enforces relational consistency: all ingested documents are persisted before chunk generation, satisfying the foreign key constraint on `chunks.document_id`.

### 3.3 Semantic Document Chunker

In [`src/pipeline/chunker.ts`](../../src/pipeline/chunker.ts):
- Tracks markdown headings (`#`, `##`, `###`) to preserve hierarchical context breadcrumbs (e.g. `Architecture > Storage Substrate`) across chunks.
- Computes character and estimated token counts, maintaining sliding window overlap across paragraph boundaries.
- Produces fully-formed `CreateChunkInput` objects matching domain schemas.

### 3.4 Resilient Embedding Service

In [`src/pipeline/embedding-service.ts`](../../src/pipeline/embedding-service.ts):
- Uses Effect 4 `effect/unstable/http` (`HttpClientRequest.bodyJson`) for POST requests to `/api/embeddings` or `/v1/embeddings`.
- Enforces strict 768-dimensional vector validation, failing with typed `EmbeddingError`.
- `EmbeddingService.Mock` provides a fast, deterministic, L2-normalized 768-dimensional vector generator based on content hashing for testing and host-independent execution.

### 3.5 Rule-Based Entity & Relation Extraction

In [`src/pipeline/extractor.ts`](../../src/pipeline/extractor.ts):
- Extracts uppercase acronyms (e.g. `KGS`, `WASM`, `LLM`) and generates bidirectional `EntityAlias` mappings.
- Identifies technology mentions against curated vocabulary lists (including `wasm`, `webassembly`, `effect`, `postgresql`).
- Extracts relational triples matching canonical `RelationType` literals (`DEPENDS_ON`, `AUTHORED_BY`, `PART_OF`, `RELATES_TO`).

### 3.6 Bayesian Knowledge Fusion

In [`src/pipeline/fusion-utils.ts`](../../src/pipeline/fusion-utils.ts):
- Computes Bayesian noisy-OR confidence updates:
  $$c_{\text{fused}} = 1 - (1 - c_1)(1 - c_2)$$
- Clamped within $(0.0, 1.0]$, ensuring multi-mention confirmation monotonically strengthens edge confidence.

---

## 4. Verification & Validation Results

### 4.1 Code Formatting

```bash
npm run format:check
```

**Output**:
```text
> format:check
> prettier --check src/ test/

Checking formatting...
All matched files use Prettier code style!
```

### 4.2 Linter Verification

```bash
npm run lint
```

**Output**:
```text
> lint
> eslint src/ test/
```
Zero lint warnings or errors.

### 4.3 Type Checking

```bash
npm run typecheck
```

**Output**:
```text
> typecheck
> tsc --noEmit
```
Zero TypeScript compilation errors with `strict: true`.

### 4.4 Automated Unit Tests

```bash
npm test
```

**Output**:
```text
> test
> tsx --test

▶ Domain Schemas
  ▶ Entity Schemas
    ✔ should validate and parse a valid Entity (6.88287ms)
    ✔ should validate CreateEntityInput with optional properties (0.496192ms)
    ✔ should reject invalid EntityType (0.811455ms)
    ✔ should validate EntityAlias (0.362241ms)
  ✔ Entity Schemas (9.598957ms)
  ▶ Relationship & Edge Schemas
    ✔ should parse an Edge (0.649792ms)
    ✔ should parse CreateEdgeInput with optional fields (0.476437ms)
    ✔ should validate RelationType literals (0.418923ms)
  ✔ Relationship & Edge Schemas (1.869994ms)
  ▶ Chunk and Vector Schemas
    ✔ should validate DocumentChunk with vector embedding (1.832373ms)
    ✔ should validate CreateChunkInput and VectorEmbedding (0.402255ms)
    ✔ should validate EntityChunkMention (0.28819ms)
  ✔ Chunk and Vector Schemas (2.785378ms)
  ▶ Provenance and Document Schemas
    ✔ should validate RawDocument and ProvenanceRecord (0.45261ms)
  ✔ Provenance and Document Schemas (0.551584ms)
  ▶ Query Schemas
    ✔ should parse NeighborhoodQuery (0.272276ms)
    ✔ should parse VectorSearchQuery and HybridSearchQuery (0.323373ms)
  ✔ Query Schemas (0.711122ms)
  ▶ Connector Schemas
    ✔ should parse SaveCheckpointInput and SyncCheckpoint (0.420781ms)
  ✔ Connector Schemas (0.508834ms)
  ▶ Configuration Schemas
    ✔ should verify DatabaseConfigSchema decoding (0.797836ms)
  ✔ Configuration Schemas (4.255581ms)
✔ Domain Schemas (21.360413ms)
▶ Phase 2 Processing Pipeline & Semantic Services
  ▶ Embedding Configuration Schema
    ✔ should decode valid EmbeddingConfigSchema with Redacted apiKey (2.840697ms)
  ✔ Embedding Configuration Schema (3.84049ms)
  ▶ Document Chunker
    ✔ should chunk markdown documents and preserve heading breadcrumbs (1.07174ms)
    ✔ should chunk RawDocument domain model with Effect (1.606462ms)
    ✔ should handle empty or whitespace-only documents cleanly (0.125793ms)
  ✔ Document Chunker (3.034492ms)
  ▶ Embedding Service & Vector Math
    ✔ should create deterministic normalized 768-dimensional mock embeddings (2.016546ms)
    ✔ should generate embeddings via EmbeddingService.Mock layer (2.034308ms)
  ✔ Embedding Service & Vector Math (4.280472ms)
  ▶ Entity & Relation Extraction
    ✔ should extract acronyms as entities and aliases (2.227869ms)
    ✔ should extract known technologies and documents (0.630601ms)
    ✔ should extract relational triples based on linguistic patterns (0.527591ms)
  ✔ Entity & Relation Extraction (3.653235ms)
  ▶ Entity Resolution & Confidence Fusion
    ✔ should compute Bayesian confidence updates correctly (0.278305ms)
  ✔ Entity Resolution & Confidence Fusion (0.417718ms)
✔ Phase 2 Processing Pipeline & Semantic Services (16.035007ms)
ℹ tests 25
ℹ suites 14
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1019.186739
```

### 4.5 Golem WebAssembly Component Build

```bash
npm run build
```

**Output**:
```text
> build
> golem build --yes

Selecting components
  Found components: golem-kgs-effect:effect-main
  Selected components and layers:
    golem-kgs-effect:effect-main: effect, effect[optimized], golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
./src/main.ts → golem-temp/ts-dist/golem-kgs-effect-effect-main/main.js...
created golem-temp/ts-dist/golem-kgs-effect-effect-main/main.js in 2.9s
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
Writing pre-initialized component to golem-temp/agents/golem_kgs_effect_effect_main.preinitialized.wasm...
Done! Input: 12386.8 KB, Output: 32484.6 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

---

## 5. How to Run & Verify

To run the complete verification suite locally:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

To run only the pipeline test suite:
```bash
npx tsx --test test/pipeline.test.ts
```

---

## 6. Sign-off / Next Steps

- **Status**: Ready for Review and Approval.
- **Next Phase**: Phase 3 ("Connectors & Ingestion Pipeline") from `plan.md` (S3/RustFS bucket reader, durable ingestion checkpoints, batch crawler).
