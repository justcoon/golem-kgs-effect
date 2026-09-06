# Feature Plan: Phase 2 - Processing Pipeline & Semantic Services

- **Feature ID / Slug**: `phase-2-processing-pipeline`
- **Date**: 2026-09-06
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Following the completion and approval of Phase 1 (Foundations & Storage Substrate), **Phase 2** establishes the core **transformation and semantic processing pipeline**. The processing pipeline bridges raw ingested documents and the structured Knowledge Graph substrate by:

1. Configuring decoupled connection parameters and secrets for embedding generation in [`golem.yaml`](../../golem.yaml) and [`src/config/`](../../src/config/).
2. Persisting ingested raw documents into the PostgreSQL `documents` table via a dedicated `DocumentRepository`, satisfying the database foreign key requirement before chunk creation (`chunks.document_id REFERENCES documents(id)`).
3. Deconstructing raw textual documents into semantically coherent, windowed text chunks while preserving document structure and section hierarchies.
4. Generating 768-dimensional dense vector embeddings for text chunks and queries via an Effect-native HTTP client communicating with Ollama (`nomic-embed-text`) or OpenAI-compatible embedding APIs.
5. Extracting candidate entities, semantic types, and relational triples from text chunks using rule-based heuristics and structured extraction patterns.
6. Resolving and fusing extracted knowledge into canonical entities and deduplicated edges, consolidating confidence scores, recording provenance lineages, and persisting aliases.

### Goals

- **Decoupled Embedding Configuration (`golem.yaml`, `src/config/`)**:
  - Configure `api_base` and `model` under `config.embedding`.
  - Configure `apiKey` under `secretDefaults.local.embedding`.
  - Define typed Effect schemas with `Schema.Redacted(Schema.String)` and Golem `defineConfig`.
- **Raw Document Persistence (`src/storage/document-repository.ts`)**:
  - Implement `DocumentRepository` service for raw document CRUD and listing in PostgreSQL `documents` table.
  - Ensure chunks referencing `document_id` satisfy PostgreSQL foreign key constraints on insert.
- **Document Chunker (`src/pipeline/chunker.ts`)**: Implement recursive/windowed text chunking with configurable chunk sizes (500–1000 characters), sliding window overlap (100–200 characters), and markdown section/header preservation.
- **Embedding Service (`src/pipeline/embedding-service.ts`)**: Implement an Effect service utilizing `effect/unstable/http` (`HttpClient` / `FetchHttpClient.layer`) reading `EmbeddingConfig` to generate vector embeddings (768 dimensions) with batching and retry capabilities.
- **Entity & Relation Extractor (`src/pipeline/extractor.ts`)**: Implement extraction logic capable of parsing entities (people, technologies, organizations, concepts) and directed relationships from text chunks.
- **Entity Resolution & Knowledge Fusion (`src/pipeline/entity-resolver.ts`)**: Implement entity deduplication and graph fusion against `EntityRepository` and `GraphRepository`, updating confidence scores, creating aliases, and recording provenance.
- **Service Integration & Barrel Exports (`src/pipeline/index.ts`, `src/storage/index.ts`)**: Export all pipeline and storage services and layer constructors for seamless composition in Golem durable agents.
- **Comprehensive Unit Testing (`test/pipeline.test.ts`)**: Validate raw document operations, chunking boundary conditions, embedding configuration decoding, request encoding, extraction heuristics, and resolution/fusion algorithms.

### Non-Goals

- Durable agent orchestration, cron triggers, and worker supervision (covered in Phase 4).
- S3 / RustFS bucket file discovery and streaming connector (covered in Phase 3).
- Direct HTTP gateway routing and public REST mounts (covered in Phase 6).

---

## 2. Architecture & Technical Design

### 2.1 Ingestion & Pipeline Flow Overview

```
 ┌────────────────┐
 │  Raw Document  │ (Document content, source URI, MIME type)
 └───────┬────────┘
         │
         ▼
 ┌────────────────────────────────┐
 │ Document Storage (PostgreSQL)  │ DocumentRepository.saveDocument
 │                                │ (Satisfies chunks.document_id FK constraint)
 └───────┬────────────────────────┘
         │
         ▼
 ┌────────────────────────┐
 │ Document Chunker       │ Splits into overlapping chunks with header hierarchy
 └───────┬────────────────┘
         │
         ├───▶ DocumentChunk[]
         │
 ┌───────┴────────────────────────┐
 │ Parallel Pipeline Steps        │
 │  1. Embedding Generation       │───▶ 768-dim Vector Embeddings (via EmbeddingConfig)
 │  2. Entity/Relation Extraction │───▶ Candidate Entities & Triples
 └───────┬────────────────────────┘
         │
         ▼
 ┌────────────────────────────────┐
 │ Entity Resolution & Fusion     │ Matches aliases, canonical deduplication,
 │                                │ merges properties, updates confidence scores
 └───────┬────────────────────────┘
         │
         ▼
 ┌────────────────────────────────┐
 │ Storage Persistence via Repos  │ ChunkRepository, EntityRepository, GraphRepository
 └────────────────────────────────┘
```

### 2.2 Decoupled Embedding Configuration & Secrets

Following the pattern established in Phase 1 for database configuration, embedding settings are decoupled into non-sensitive configuration values and sensitive secret credentials:

#### In [`golem.yaml`](../../golem.yaml):
```yaml
config:
  db:
    host: "{{ POSTGRES_HOST }}"
    db: "{{ POSTGRES_DB }}"
    port: "{{ POSTGRES_PORT }}"
  embedding:
    api_base: "{{ EMBEDDING_API_BASE }}"
    model: "{{ EMBEDDING_MODEL }}"

secretDefaults:
  local:
    db:
      user: "{{ POSTGRES_USER }}"
      password: "{{ POSTGRES_PASSWORD }}"
    embedding:
      apiKey: "{{ EMBEDDING_API_KEY }}"
```

#### In [`src/config/schema.ts`](../../src/config/schema.ts):
```typescript
export const EmbeddingConfigFields = {
  embedding: Schema.Struct({
    api_base: Schema.String,
    model: Schema.String,
    apiKey: Schema.Redacted(Schema.String),
  }),
};

export const EmbeddingConfigSchema = Schema.Struct(EmbeddingConfigFields);
export type EmbeddingConfigSchema = typeof EmbeddingConfigSchema.Type;
```

#### In [`src/config/embedding-config.ts`](../../src/config/embedding-config.ts):
```typescript
import { defineConfig } from "@golemcloud/effect-golem";
import { EmbeddingConfigFields } from "./schema.js";

export class EmbeddingConfig extends defineConfig(
  "Embedding.Config",
  EmbeddingConfigFields,
) {}
```

---

### 2.3 Component Architecture

#### 1. Document Storage (`src/storage/document-repository.ts`)
- **Service Interface**:
  ```typescript
  export interface DocumentRepository {
    readonly saveDocument: (
      doc: RawDocument,
    ) => Effect.Effect<RawDocument, SqlError>;
    readonly findDocumentById: (
      id: string,
    ) => Effect.Effect<Option.Option<RawDocument>, SqlError>;
    readonly listDocuments: (
      options?: { source?: string; namespace?: string; limit?: number },
    ) => Effect.Effect<RawDocument[], SqlError>;
    readonly deleteDocument: (
      id: string,
    ) => Effect.Effect<void, SqlError>;
  }
  ```
- **Integrity**: Persists `id`, `title`, `content`, `metadata`, `tags`, `source`, `namespace`, `size_bytes`, and timestamps. Ensures foreign keys for downstream `chunks` are guaranteed to exist.

#### 2. Document Chunker (`src/pipeline/chunker.ts`)
- **Sliding Window Chunking**: Breaks text down by paragraph boundaries (`\n\n`), sentences (`. `), and character limits.
- **Context Preservation**: Prepends active Markdown heading breadcrumbs (e.g., `# Architecture > ## Storage Substrate`) to chunks to maintain semantic locality.
- **Metadata Propagation**: Attaches document ID, chunk index, byte offsets, character counts, and hashes to each generated `CreateChunkInput`.

#### 3. Embedding Service (`src/pipeline/embedding-service.ts`)
- **Interface**:
  - `generateEmbedding(text: string): Effect<VectorEmbedding, EmbeddingError>`
  - `generateEmbeddings(texts: string[]): Effect<VectorEmbedding[], EmbeddingError>`
- **Transport**: Outgoing HTTP POST calls using Effect v4 `HttpClient.HttpClient` (compatible with WASI `globalThis.fetch` via `FetchHttpClient.layer`).
- **Endpoint Structure**:
  - Targets OpenAI-compatible `${api_base}/embeddings` (native to Ollama and OpenAI).
  - Supplies `Authorization: Bearer <apiKey>` using `Redacted.value(config.apiKey)`.
  - Sends `{ model: config.model, input: texts }`.
- **Dimension Validation**: Validates that returned vectors strictly match 768 dimensions.
- **Resilience**: Configurable request timeouts, batch chunking, and typed error handling via `EmbeddingError`.

#### 4. Entity & Relation Extractor (`src/pipeline/extractor.ts`)
- **Extraction Strategy**:
  - **Deterministic / Rule-based**: Regex-based detection for acronyms, capitalized proper nouns, technical terms, URLs, emails, dates, and version identifiers.
  - **Relational Triple Patterns**: Pattern matching for grammatical relationships (`X is a Y`, `X authored by Y`, `X depends on Y`, `X part of Y`).
  - **Structured Extraction Contracts**: Predefined candidate schemas for structured entity and relation tuples.
- **Outputs**: Collections of candidate entities (`CreateEntityInput`), aliases (`EntityAlias`), and directed edges (`CreateEdgeInput`).

#### 5. Entity Resolver & Knowledge Fusion (`src/pipeline/entity-resolver.ts`)
- **Resolution Strategy**:
  1. Exact ID / Canonical name match.
  2. Alias lookup (via `EntityRepository.findEntityByAlias`).
  3. Trigram similarity / fuzzy match thresholding.
- **Knowledge Fusion Rules**:
  - If match found: Update existing entity, merge properties (preserving existing properties unless updated with higher confidence), create/link new alias, recalculate overall confidence score using Bayesian weighted fusion:
    $$C_{new} = 1 - (1 - C_{old}) \times (1 - C_{observed})$$
  - If no match found: Persist as new canonical entity with initial confidence score.
  - Edge Fusion: Check if edge with `(sourceId, targetId, relationType)` already exists in `GraphRepository`. If so, increment weight and boost confidence; if not, create new edge.
  - Provenance: Link chunk ID and document ID to all resolved entities and relations.

---

## 3. Proposed Changes & File Impact

| Action | File Path | Description |
| :--- | :--- | :--- |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml) | Add `config.embedding` (`api_base`, `model`) and `secretDefaults.local.embedding` (`apiKey`) |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts) | Add `EmbeddingConfigFields` and `EmbeddingConfigSchema` |
| `[NEW]` | [`src/config/embedding-config.ts`](../../src/config/embedding-config.ts) | Typed `EmbeddingConfig` using Golem SDK `defineConfig` |
| `[MODIFY]` | [`src/config/index.ts`](../../src/config/index.ts) | Export `embedding-config.ts` |
| `[NEW]` | [`src/storage/document-repository.ts`](../../src/storage/document-repository.ts) | `DocumentRepository` service for raw document CRUD in PostgreSQL |
| `[MODIFY]` | [`src/storage/index.ts`](../../src/storage/index.ts) | Export `document-repository.ts` |
| `[NEW]` | [`src/pipeline/chunker.ts`](../../src/pipeline/chunker.ts) | Document chunking with semantic windowing, overlap, and header tracking |
| `[NEW]` | [`src/pipeline/embedding-service.ts`](../../src/pipeline/embedding-service.ts) | Embedding client service using `HttpClient` reading `EmbeddingConfig` |
| `[NEW]` | [`src/pipeline/extractor.ts`](../../src/pipeline/extractor.ts) | Entity and relationship extraction service with heuristic & rule engines |
| `[NEW]` | [`src/pipeline/entity-resolver.ts`](../../src/pipeline/entity-resolver.ts) | Entity resolution, alias matching, and graph knowledge fusion engine |
| `[NEW]` | [`src/pipeline/index.ts`](../../src/pipeline/index.ts) | Barrel export for all pipeline services and contracts |
| `[NEW]` | [`test/pipeline.test.ts`](../../test/pipeline.test.ts) | Comprehensive unit tests for chunking, extraction, embeddings, and fusion |

---

## 4. Verification Plan

### Automated Checks

1. **Code Formatting**:
   ```bash
   npm run format:check   # npx prettier --check src/ test/
   ```
   Verify all source and test files strictly match Prettier formatting.
2. **Type Checking**:
   ```bash
   npm run typecheck      # tsc --noEmit
   ```
   Zero TypeScript compiler errors across `src/` and `test/`.
3. **Linter Verification**:
   ```bash
   npm run lint           # eslint src/ test/
   ```
   Zero ESLint errors or unused symbols.
4. **Automated Unit Tests**:
   ```bash
   npm test               # tsx --test
   ```
   Execute both `test/domain-schemas.test.ts` and `test/pipeline.test.ts`.
5. **Golem WASM Build**:
   ```bash
   npm run build          # golem build --yes
   ```
   Verify that Rollup and the Golem WebAssembly toolchain compile the component without errors.

---

## 5. Risks & Open Questions

- **HTTP Outbound Requests in Golem WASM**: Golem components run inside QuickJS with WASI HTTP support provided via `globalThis.fetch`. Outbound HTTP requests must strictly use Effect's `FetchHttpClient.layer` and never Node native `http`/`https` modules.
- **Foreign Key Constraints**: PostgreSQL enforces `chunks.document_id REFERENCES documents(id)`. Raw documents must always be saved via `DocumentRepository.saveDocument` prior to inserting their chunks into `ChunkRepository`.
- **Embedding Dimensions**: Must match the PostgreSQL `vector(768)` column configured in `migrations/003_chunks_and_embeddings.sql`. The embedding service will validate that returned vector dimensions match 768.
- **Offline / Mock Testing**: In CI and unit tests where a live Ollama daemon may not be reachable, `EmbeddingService` will support a test layer with mock embeddings to ensure deterministic unit testing without external dependencies.
- **Decoupled Configuration**: Golem merges `config.embedding` and `secretDefaults.local.embedding` when constructing the guest environment. The guest code accesses all fields through `EmbeddingConfig`.
