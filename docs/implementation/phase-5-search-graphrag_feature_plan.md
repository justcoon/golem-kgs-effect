# Feature Plan: Phase 5 - Search Engine & GraphRAG Retrieval

- **Feature ID / Slug**: `phase-5-search-graphrag`
- **Date**: 2026-09-06
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Following the successful completion of Phase 1 (Storage Substrate), Phase 2 (Processing Pipeline), Phase 3 (S3 Connector Framework), and Phase 4 (Durable Agents & Orchestration), **Phase 5** implements the **Search Engine & GraphRAG Retrieval Subsystem**.

Graph-Augmented Generation (GraphRAG) bridges unstructured vector similarity search with structured topological knowledge graphs. Instead of retrieving isolated text chunks that lack relational context, GraphRAG extracts entities from top search results, traverses multi-hop graph neighborhoods to discover hidden connections and related entities, and compiles a comprehensive, grounded context bundle ready for direct Large Language Model (LLM) prompt injection.

### Core Objectives
1. **Multi-Hop Topological Graph Traversal**:
   - Upgrade [`src/storage/graph-repository.ts`](../../src/storage/graph-repository.ts) to support configurable multi-hop breadth-first traversal (`depth >= 1`, e.g., 1 to 5 hops) with visited-set cycle prevention, directional filtering (`OUTBOUND`, `INBOUND`, `BOTH`), relationship type filters, and minimum confidence cutoffs.
   - Implement path-finding queries (`findPaths`) to discover relationship chains between two arbitrary entities up to `maxDepth` hops.
2. **Centralized Reciprocal Rank Fusion (RRF) Engine**:
   - Implement a pure, robust RRF engine in [`src/pipeline/fusion-utils.ts`](../../src/pipeline/fusion-utils.ts) with standard formula $RRF(d) = \sum_{r \in R} \frac{1}{k + rank(r, d)}$ with configurable smoothing constant $k$ (default 60) and normalized scores.
   - Refactor hybrid search in [`src/storage/chunk-repository.ts`](../../src/storage/chunk-repository.ts) to utilize this centralized fusion utility.
3. **GraphRAG Subgraph & Context Assembly Engine**:
   - Implement `GraphRAGService` in [`src/pipeline/graphrag-service.ts`](../../src/pipeline/graphrag-service.ts) to coordinate the complete GraphRAG pipeline:
     1. Vectorize natural language query via `EmbeddingService`.
     2. Execute hybrid search (`searchHybrid`) combining dense cosine distance with lexical full-text search (`ts_rank`).
     3. Identify seed entities referenced in the top chunks or extracted from the query.
     4. Perform multi-hop graph expansion around seed entities via `GraphRepository`.
     5. Retrieve full canonical entity details and relationship metadata.
     6. Assemble a structured `GraphRAGContextBundle` containing seed entities, expanded graph triples, supporting chunk texts, source provenance, and an LLM-ready synthesized Markdown context prompt (`formattedContextPrompt`).
4. **Agent Gateway Exposure (`KnowledgeAccessAgent`)**:
   - Expose `graphRag` and `findPaths` methods on [`KnowledgeAccessAgent`](../../src/agents/access-agent.ts) (`mode: "ephemeral"`).
5. **Decoupled Architecture for Fast Node Testing**:
   - Extend repository tags in [`src/storage/repository-tags.ts`](../../src/storage/repository-tags.ts) so 100% of graph traversal algorithms, RRF calculations, and GraphRAG assembly logic can be tested in Node.js (`npm test`) without requiring host WIT WASM bindings.
6. **Comprehensive Automated Test Suite**:
   - Implement `test/graphrag.test.ts` covering RRF mathematics, multi-hop graph expansion, path-finding queries, and GraphRAG bundle prompt assembly.

### Non-Goals
- Public HTTP gateway routes and domain bindings (`httpApi.deployments` in `golem.yaml`) — scheduled for Phase 6.
- Host-level LLM generation (`effect/unstable/ai` or Ollama chat response generation) — Phase 5 produces the grounded context bundle prompt ready for LLM consumption.

---

## 2. Architecture & Data Flow

```
                                Natural Language Query
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │      KnowledgeAccessAgent       │
                         │       (mode: "ephemeral")       │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │         GraphRAGService         │
                         └───────┬─────────────────┬───────┘
                                 │                 │
                1. Vectorize     │                 │ 2. Hybrid Search
                                 ▼                 ▼
                       ┌──────────────────┐ ┌──────────────────┐
                       │ EmbeddingService │ │ ChunkRepository  │
                       │  (Ollama/Mock)   │ │  (Vector + BM25) │
                       └──────────────────┘ └────────┬─────────┘
                                                     │
                                            Top Chunks & Mentions
                                                     │
                                                     ▼
                                            Seed Entity Discovery
                                                     │
                                                     ▼
                                            3. Multi-Hop Traversal
                                            ┌──────────────────┐
                                            │ GraphRepository  │
                                            │ (Multi-Hop BFS)  │
                                            └────────┬─────────┘
                                                     │
                                             Expanded Subgraph
                                            (Nodes + Triples)
                                                     │
                                                     ▼
                                            4. Context Synthesis
                                            ┌──────────────────┐
                                            │ Context Builder  │
                                            │ • Deduplication  │
                                            │ • Markdown Prompt│
                                            │ • Citations      │
                                            └────────┬─────────┘
                                                     │
                                                     ▼
                                          GraphRAGContextBundle
```

---

## 3. Schemas & Contracts

### 3.1 Domain Schemas (`src/domain/query.ts` & `src/agents/types.ts`)

```typescript
export const PathFindingQuery = Schema.Struct({
  sourceEntityId: Schema.String,
  targetEntityId: Schema.String,
  maxDepth: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
});

export const GraphPath = Schema.Struct({
  entityIds: Schema.Array(Schema.String),
  edges: Schema.Array(EdgeSchema),
  totalWeight: Schema.Number,
});

export const PathFindingResult = Schema.Struct({
  paths: Schema.Array(GraphPath),
  shortestPathLength: Schema.NullOr(Schema.Number),
});

export const GraphRAGQuerySchema = Schema.Struct({
  query: Schema.String,
  topK: Schema.optional(Schema.Number),
  maxHops: Schema.optional(Schema.Number),
  minConfidence: Schema.optional(Schema.Number),
  relationTypes: Schema.optional(Schema.Array(Schema.String)),
});

export const GraphRAGContextBundleSchema = Schema.Struct({
  query: Schema.String,
  entities: Schema.Array(EntityResultSchema),
  relationships: Schema.Array(EdgeResultSchema),
  relevantChunks: Schema.Array(SearchResultItemSchema),
  formattedContextPrompt: Schema.String,
  metadata: Schema.Struct({
    totalEntities: Schema.Number,
    totalRelationships: Schema.Number,
    totalChunks: Schema.Number,
    retrievalDurationMs: Schema.Number,
  }),
});
```

### 3.2 New Methods & Interface Additions for Knowledge Agents

[`KnowledgeAccessAgent`](../../src/agents/access-agent.ts) already implements:
- `search` (hybrid, vector, keyword search)
- `getNeighborhood` (graph neighborhood traversal)
- `getEntity` (exact ID lookup)

In Phase 5, the following **new capabilities and interface methods** will be added:

#### Unified `KnowledgeAccessAgent` API Surface

To avoid unnecessary agent fragmentation and keep architecture aligned with the primary design, all search, graph traversal, GraphRAG context assembly, grounded question-answering, and overview methods are consolidated directly into [`KnowledgeAccessAgent`](../../src/agents/access-agent.ts):

```typescript
// Complete method set of KnowledgeAccessAgent (mode: "ephemeral"):

export const KnowledgeAccessAgent = defineAgent({
  name: "KnowledgeAccessAgent",
  description:
    "Stateless ephemeral gateway for high-throughput concurrent search, graph traversal, GraphRAG, and question-answering",
  mode: "ephemeral",
  config: AppAgentConfig,
  constructorParams: {},
  methods: {
    /** 1. Hybrid, vector, or keyword search across document chunks */
    search: method({ ... }),

    /** 2. Exact entity lookup by ID */
    getEntity: method({ ... }),

    /** 3. Graph neighborhood traversal up to maxDepth hops */
    getNeighborhood: method({ ... }),

    /** 4. Relationship chain and path discovery between concepts */
    findPaths: method({
      params: {
        sourceEntityId: Schema.String,
        targetEntityId: Schema.String,
        maxDepth: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
        direction: Schema.optional(
          Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"]),
        ),
      },
      success: PathFindingResultSchema,
      description:
        "Discovers multi-hop relational paths between source and target entities",
    }),

    /** 5. Structured GraphRAG context retrieval with LLM-ready prompt */
    graphRag: method({
      params: {
        query: Schema.String,
        topK: Schema.optional(Schema.Number),
        maxHops: Schema.optional(Schema.Number),
        minConfidence: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
      },
      success: GraphRAGContextBundleSchema,
      description:
        "Executes GraphRAG retrieval pipeline returning structured context and formatted prompt",
    }),

    /** 6. Grounded natural language Q&A with source citations */
    ask: method({
      params: {
        query: Schema.String,
        topK: Schema.optional(Schema.Number),
        maxHops: Schema.optional(Schema.Number),
        generateAnswer: Schema.optional(Schema.Boolean),
      },
      success: AnswerResponseSchema,
      description:
        "Answers natural language questions with GraphRAG context retrieval, synthesis, and source citations",
    }),

    /** 7. Knowledge base summary statistics and sync status */
    getOverview: method({
      params: {},
      success: KnowledgeBaseOverviewSchema,
      description:
        "Returns statistical overview of the knowledge base (document count, chunk count, entity count, relationship count)",
    }),
  },
});
```

### 3.3 Database Connection Resolution Unification & Config Cleanup

In Phase 4, agent configurations were consolidated into [`AppAgentConfig`](../../src/config/agent-config.ts) (`db`, `embedding`, `resources`). However, [`src/storage/database-client.ts`](../../src/storage/database-client.ts) still referenced the obsolete Phase 1 `DatabaseConfig` service tag, resulting in duplicate inline connection string formatting across [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts) and [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts).

Phase 5 unifies connection resolution:
1. Refactor `resolveConnectionAddress` in [`src/storage/database-client.ts`](../../src/storage/database-client.ts) to resolve directly from `AppAgentConfig` (or an optional config argument).
2. Remove obsolete [`src/config/database-config.ts`](../../src/config/database-config.ts) and remove its export from [`src/config/index.ts`](../../src/config/index.ts).
3. Update both `KnowledgeAccessAgent` and `S3IngestorTaskAgent` to use `yield* resolveConnectionAddress` cleanly.

---

## 4. File-by-File Changes

| Component | File | Action | Description |
|---|---|---|---|
| Domain | [`src/domain/query.ts`](../../src/domain/query.ts) | `[MODIFY]` | Add `PathFindingQuery`, `GraphPath`, `PathFindingResult`, `GraphRAGQuery`, and `GraphRAGContextBundle`. |
| Pipeline | [`src/pipeline/fusion-utils.ts`](../../src/pipeline/fusion-utils.ts) | `[MODIFY]` | Add pure, generic `reciprocalRankFusion` implementation with configurable `k` and normalization. |
| Storage | [`src/storage/repository-tags.ts`](../../src/storage/repository-tags.ts) | `[MODIFY]` | Add `findPaths` and multi-hop `getNeighborhood` signatures to `GraphRepositoryShape`. |
| Storage | [`src/storage/graph-repository.ts`](../../src/storage/graph-repository.ts) | `[MODIFY]` | Implement iterative BFS multi-hop expansion up to `query.depth` and bidirectional `findPaths`. |
| Storage | [`src/storage/chunk-repository.ts`](../../src/storage/chunk-repository.ts) | `[MODIFY]` | Utilize centralized `reciprocalRankFusion` in `searchHybrid`. |
| Storage | [`src/storage/database-client.ts`](../../src/storage/database-client.ts) | `[MODIFY]` | Update `resolveConnectionAddress` to resolve from `AppAgentConfig`. |
| Config | [`src/config/database-config.ts`](../../src/config/database-config.ts) | `[DELETE]` | Remove obsolete standalone `DatabaseConfig` class. |
| Config | [`src/config/index.ts`](../../src/config/index.ts) | `[MODIFY]` | Remove export of deleted `database-config.js`. |
| Pipeline | [`src/pipeline/graphrag-service.ts`](../../src/pipeline/graphrag-service.ts) | `[NEW]` | Implement `GraphRAGService` orchestrating hybrid search, seed entity discovery, multi-hop expansion, and Markdown context generation. |
| Pipeline | [`src/pipeline/index.ts`](../../src/pipeline/index.ts) | `[MODIFY]` | Export `GraphRAGService` and related types. |
| Agents | [`src/agents/types.ts`](../../src/agents/types.ts) | `[MODIFY]` | Add `GraphRAGQuerySchema`, `GraphRAGContextBundleSchema`, `PathFindingQuerySchema`, `PathFindingResultSchema`, `CitationSchema`, `AnswerResponseSchema`, `KnowledgeBaseOverviewSchema`. |
| Agents | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts) | `[MODIFY]` | Wire `GraphRAGService.Default` into the live agent pipeline layer. |
| Agents | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts) | `[MODIFY]` | Use `resolveConnectionAddress`, expose `graphRag` and `findPaths` methods. |
| Agents | [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts) | `[MODIFY]` | Use `resolveConnectionAddress` instead of inlined connection string formatting. |
| Agents | [`src/agents/knowledgebase-agent.ts`](../../src/agents/knowledgebase-agent.ts) | `[NEW]` | Interface declaration for `KnowledgeBaseAgent` (contract only). |
| Tests | [`test/graphrag.test.ts`](../../test/graphrag.test.ts) | `[NEW]` | Comprehensive unit test suite for RRF, multi-hop graph expansion, path-finding, and GraphRAG context packaging. |

---

## 5. Verification & Validation Plan

### 1. Code Formatting
```bash
npm run format && npm run format:check
```
Ensure all files in `src/` and `test/` comply with Prettier formatting.

### 2. Linting
```bash
npm run lint
```
Zero lint errors and zero unused symbols/imports.

### 3. TypeScript Type Checking
```bash
npm run typecheck
```
Zero TypeScript compiler errors (`tsc --noEmit`).

### 4. Unit & Integration Testing
```bash
npm test
```
Run `tsx --test` across all 5 test suites (`domain-schemas`, `pipeline`, `connectors`, `agents`, `graphrag`), ensuring 100% pass rate.

### 5. Golem WebAssembly Build
```bash
npm run build
```
Ensure `golem build --yes` bundles the updated `KnowledgeAccessAgent` with QuickJS Wizer WASM pre-initialization.
