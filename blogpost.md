# Building a Serverless, Durable Knowledge Graph & GraphRAG Platform with Golem Cloud and Effect

Modern AI applications increasingly rely on **Retrieval-Augmented Generation (RAG)** to ground Large Language Models (LLMs) in proprietary facts. However, conventional vector-only RAG has critical blind spots: it struggles with **multi-hop relational reasoning**, fails to capture **hierarchical structures**, and lacks the explicit connectivity needed to answer questions like *"Which components depend on service X through transitive dependencies?"* or *"What are all the entities related to topic Y across disparate documents?"*

To solve this, **GraphRAG** unites the semantic similarity of dense vector embeddings with the structural precision of a typed knowledge graph. 

Yet, building an enterprise-grade GraphRAG system traditionally demands complex infrastructure: background worker pools, cron schedulers (Airflow, Celery), distributed queue managers (RabbitMQ, Redis), state orchestrators (Temporal), API gateways, and specialized vector/graph databases.

In this post, we explore how we built **[golem-kgs-effect](https://github.com/justcoon/golem-kgs-effect)**: an open-source, durable, serverless Knowledge Graph and GraphRAG service running on **[Golem Cloud](https://learn.golem.cloud)** with **TypeScript** and **[Effect](https://effect.website)**.

---

## 1. System Architecture: The Dual-Representation Engine

At the core of the service is a **dual-representation paradigm**: every ingested document is decomposed simultaneously into:
1. **Dense Vector Embeddings** (768-dimensional `nomic-embed-text`) stored in PostgreSQL with `pgvector` HNSW indexing for semantic similarity search.
2. **Typed Knowledge Graph Elements** (canonical entities, aliases, properties, and directed relationships with Bayesian confidence scores) stored in relational graph tables for multi-hop topological traversal.

```mermaid
flowchart TD
    subgraph External["External Systems"]
        S3["AWS S3 / RustFS<br/>(Document Storage)"]
        Web["Public Web / Sitemaps<br/>(Documentation Sites)"]
        PG[("PostgreSQL + pgvector<br/>(Metadata, Vectors, Graph)")]
        LLM["Ollama / Embedding APIs<br/>(nomic-embed-text, Qwen / Llama)"]
        Client["Frontend & Client Apps<br/>(Vue 3 / REST)"]
        MCPClient["AI & MCP Clients<br/>(Claude Desktop / Cursor / Inspector)"]
    end

    subgraph Golem["Golem Cloud Runtime (WASM Component)"]
        GW["Golem HTTP Gateway<br/>(Domain & Route Mounts on :9006)"]
        MCPGW["Golem MCP Gateway<br/>(Streamable HTTP on :9007)"]

        subgraph Agents["Autonomous Agents"]
            S3Worker["S3IngestorTaskAgent<br/>(Durable Worker Partitioned by S3 Resource)"]
            WebWorker["WebIngestorTaskAgent<br/>(Durable Worker Partitioned by Web Resource)"]
            Access["KnowledgeAccessAgent<br/>(Ephemeral Query & GraphRAG Gateway)"]
        end
    end

    Client -->|HTTP REST| GW
    MCPClient -->|Streamable HTTP /mcp| MCPGW
    MCPGW --> Access
    GW --> Access
    GW --> S3Worker
    GW --> WebWorker

    S3Worker -->|"Self-Scheduling via Host Timers"| S3Worker
    S3Worker -->|"Read Objects (SigV4)"| S3
    S3Worker -->|"Embeddings"| LLM
    S3Worker -->|"Chunks, Vectors, Entities, Edges"| PG

    WebWorker -->|"Self-Scheduling via Host Timers"| WebWorker
    WebWorker -->|"Fetch HTML & Sitemaps"| Web
    WebWorker -->|"Embeddings"| LLM
    WebWorker -->|"Chunks, Vectors, Entities, Edges"| PG

    Access -->|"Hybrid RRF, BFS Traversal, Path Finding"| PG
    Access -->|"Context Synthesis"| LLM
```

### Core Architecture Components

- **Golem Cloud WebAssembly Host**: Runs QuickJS-compiled WebAssembly components providing **durable execution**. If a worker crashes or pauses mid-computation, Golem automatically replays its operation log and resumes execution seamlessly without data loss or duplicate external side effects.
- **PostgreSQL + pgvector**: A unified persistence layer configured via [`@golemcloud/effect-golem/postgres`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/storage/postgres-client.ts). It enforces foreign-key relational integrity, maintains HNSW vector indices, powers full-text GIN search, and tracks durable sync checkpoints.
- **Dual Ingress Connectors**:
  - **S3 / RustFS Connector**: Scans S3 buckets using AWS SigV4 authorization, tracking ETags and timestamp checkpoints to execute incremental synchronization.
  - **Web / Sitemap Connector**: Recursively crawls documentation sites via `sitemap.xml` or seed URLs, stripping HTML boilerplate and transforming web pages into semantic Markdown via `node-html-markdown` while streaming with $O(1)$ memory consumption.
- **LLM & Embedding Services**: Integrates with local Ollama instances or OpenAI-compatible cloud endpoints (`nomic-embed-text` for 768-dim embeddings, and `qwen2.5:1.5b` or `llama3.2:3b` for natural language answer synthesis with deterministic fallbacks).
- **Dual Gateways**:
  - **HTTP Gateway (`:9006`)**: Direct REST API consumption for frontend apps and microservices.
  - **MCP Gateway (`:9007`)**: Streamable HTTP Model Context Protocol endpoint for direct connection to tools like Claude Desktop and Cursor.

---

## 2. Ingestion & Pipeline Flow

The ingestion pipeline converts unstructured Markdown files and web pages into an interconnected, queryable knowledge base through a 5-stage ETL process:

```mermaid
flowchart TD
    subgraph Ingress["1. Ingress & Identity"]
        S3["S3 Object Storage"] -->|"Fetch Markdown"| RawDoc["Raw Document<br/>(RFC 4122 UUID v5 Identity)"]
        Web["Web / Sitemaps"] -->|"Fetch HTML & Convert"| RawDoc
        RawDoc -->|"Save Record"| DocDB[("PostgreSQL: documents table<br/>(FK Anchor for Chunks)")]
    end

    subgraph Chunking["2. Semantic Chunking"]
        RawDoc -->|"Hierarchical Markdown Splitter"| Chunker["Document Chunker<br/>(Preserves Breadcrumb Hierarchy)"]
        Chunker -->|"Generates Array"| Chunks["DocumentChunk[]"]
    end

    subgraph Processing["3. Parallel Processing"]
        Chunks -->|"Batch Texts"| EmbService["Embedding Model<br/>(nomic-embed-text)"]
        EmbService -->|"768-dim Vectors"| Vectors["Vector Embeddings"]

        Chunks -->|"Rule & Linguistic Parsing"| Extractor["Entity & Relation Extractor<br/>(Tech Dictionary & Patterns)"]
        Extractor -->|"Candidate Triples"| Triples["Candidate Entities & Relations"]
    end

    subgraph Resolution["4. Resolution & Fusion"]
        Triples --> Fusion["Entity Resolution & Fusion<br/>(Alias Normalization & Bayesian Confidence)"]
        Fusion --> CanonicalGraph["Canonical Entities & Directed Edges"]
    end

    subgraph Persistence["5. Storage Persistence"]
        Chunks --> ChunkDB[("PostgreSQL: chunks table<br/>(pgvector HNSW + GIN Index)")]
        Vectors --> ChunkDB
        CanonicalGraph --> GraphDB[("PostgreSQL: entities, aliases & edges tables<br/>(Strict Foreign Keys)")]
    end
```

### Deep Dive into the 5 Pipeline Stages

1. **Ingress & Deterministic Identity**:
   Every incoming document is assigned an **RFC 4122 UUID v5** deterministically generated from `(source, resourceName, sourceKey)`. Before chunking or embedding, the raw document is stored in the [`documents`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/storage/schema.ts) table. This guarantees idempotent re-ingestion, multi-tenant isolation (`uq_documents_source_resource_key`), and satisfies foreign-key constraints for downstream chunks.
2. **Semantic Hierarchical Chunking**:
   The [`DocumentChunker`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/pipeline/chunker.ts) splits Markdown documents while tracking the section hierarchy. Each chunk preserves breadcrumbs (e.g., `Architecture > Ingestion > Pipeline Flow`), token count bounds, and overlap. This context is embedded directly into the chunk text, ensuring embeddings retain contextual meaning even when detached from the parent document.
3. **Parallel Vector & Extraction Pipeline**:
   The chunk stream branches into two concurrent tasks:
   - **Vector Embeddings**: Normalized 768-dimensional dense vectors generated via [`EmbeddingService`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/pipeline/embedding-service.ts).
   - **Entity & Relation Extraction**: The [`EntityExtractor`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/pipeline/entity-extractor.ts) applies linguistic rules, regex patterns, a curated technology dictionary, and stopword filters to identify candidate domain concepts (e.g., `Golem Cloud`, `PostgreSQL`, `pgvector`) and relations (e.g., `DEPENDS_ON`, `PART_OF`, `RELATES_TO`).
4. **Entity Resolution & Bayesian Fusion**:
   Extracted terms often contain aliases (e.g., `postgres` vs. `PostgreSQL`). The [`EntityResolver`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/pipeline/entity-resolver.ts) resolves synonyms to a canonical slug (`postgresql`), merges properties, and uses Bayesian confidence updating:
   $$\text{Confidence}_{\text{new}} = 1 - (1 - \text{Confidence}_{\text{old}}) \times (1 - \text{Confidence}_{\text{match}})$$
   Repeated mentions across documents strengthen confidence without unbounded growth.
5. **Atomic Relational Persistence**:
   - Chunks and embeddings are stored in `chunks` with HNSW cosine indexing.
   - Entities and their aliases are stored in `entities` and `entity_aliases` (with trigram GIN indices for fuzzy lookup).
   - Directed relations are stored in `edges` with compound primary key `(source_id, target_id, relation_type)`.
   - The provenance table `entity_chunks` links graph nodes back to their source chunks, allowing full traceability from graph traversal back to source citations.

---

## 3. Dynamic Sources & Secret-Driven Configuration

A key strength of the architecture is that **new data sources (S3 buckets, prefixes, or documentation sites) are added purely through configuration and secrets—zero code changes or redeployments required**.

Backed by [Golem Cloud's native Config & Secrets management](https://learn.golem.cloud/v1.5/develop/config-and-secrets), targets are defined in [`src/config/schema.ts`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/config/schema.ts) and protected with Effect's `Schema.Redacted`:

```typescript
export const ResourcesConfigFields = {
  // S3 & Web targets (endpoints, credentials, sitemaps, headers) encrypted at rest
  resources: Schema.Redacted(ResourcesSecretSchema),
};
```

To add a new target (e.g. a `legal` bucket or `effect-docs` crawler), simply define it in [`golem.yaml`](https://github.com/justcoon/golem-kgs-effect/blob/main/golem.yaml):

```yaml
secretDefaults:
  local:
    resources:
      s3:
        - name: "legal" # <-- Onboard a new S3 bucket
          endpoint: "{{ S3_ENDPOINT_URL }}"
          bucket: "corporate-legal-vault"
          prefixes: ["agreements/"]
          accessKeyId: "{{ LEGAL_S3_KEY }}"
          secretAccessKey: "{{ LEGAL_S3_SECRET }}"
      web:
        - name: "effect-docs" # <-- Onboard a new web documentation site
          baseUrl: "https://effect.website"
          seedUrls: ["https://effect.website/docs"]
```

### On-Demand Workers & Failure Isolation

Because ingestor agents are keyed by `resourceName` (`S3IngestorTaskAgent({ resourceName })`), invoking `/api/ingestion/s3/legal/sync` dynamically spins up an isolated, durable worker instance for that target. Each source maintains its own independent cursor, checkpoint table, and host-scheduled timer—ensuring complete **per-source failure isolation**.

---

## 4. The Agent Architecture: Durable Workers & Ephemeral Gateways

In Golem Cloud, agents are stateful WebAssembly actors that can be either **Durable** (state is persisted, invocations are sequential, and failures trigger replay) or **Ephemeral** (stateless, concurrent, high-throughput).

Our platform implements three specialized agents defined with `@golemcloud/effect-golem`:

```
┌─────────────────────────────────────────────────────────────┐
│                     Golem Cloud Runtime                     │
│                                                             │
│   DURABLE AGENTS (1:1 per Target)     EPHEMERAL GATEWAY     │
│  ┌──────────────────────────────┐    ┌──────────────────┐   │
│  │   S3IngestorTaskAgent        │    │ KnowledgeAccess  │   │
│  │   • Autonomous Host Timers   │    │ Agent            │   │
│  │   • State Snapshots (Oplog)  │    │ • Hybrid Search  │   │
│  │   • Status & Sync Metrics    │    │ • GraphRAG Q&A   │   │
│  └──────────────────────────────┘    │ • BFS Traversal  │   │
│  ┌──────────────────────────────┐    │ • MCP Server     │   │
│  │   WebIngestorTaskAgent       │    └──────────────────┘   │
│  │   • Autonomous Host Timers   │                           │
│  │   • Sitemap & Web Crawling   │                           │
│  │   • Streaming HTML Parser    │                           │
│  └──────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Agent 1: `S3IngestorTaskAgent` (Durable ETL Worker)

The [`S3IngestorTaskAgent`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/agents/s3-task-agent.ts) is partitioned 1:1 by S3 resource name (e.g., `main`, `legal`, `technical`). Each agent instance maintains a lightweight durable state (lifecycle status, sync metrics, error logs, and scheduling status) and takes periodic snapshots using Golem's `Snapshot.define`. Incremental synchronization state (ETags and file timestamps) is persisted in the PostgreSQL `sync_checkpoints` table via [`CheckpointRepository`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/storage/checkpoint-repository.ts), keeping the agent's durable snapshot footprint minimal (`< 1 KB`).

#### Agent Interface Definition

```typescript
export const S3IngestorTaskAgentDefinition = defineAgent({
  name: "S3IngestorTaskAgent",
  description: "Durable S3 ingestion task worker bound 1:1 to an S3 resource target",
  mode: "durable",
  config: AppAgentConfig,
  constructorParams: {
    resourceName: Schema.String,
  },
  http: Http.mount("/api/ingestion/s3/{resourceName}", { cors: ["*"] }),
  snapshot: Snapshot.define({
    schema: S3TaskStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    sync: method({
      params: { force: Schema.optional(Schema.Boolean) },
      success: S3TaskStatusResponseSchema,
      description: "Executes full or incremental synchronization of the bound S3 resource",
      http: [Http.post("/sync")],
    }),
    getStatus: method({
      params: {},
      success: S3TaskStatusResponseSchema,
      description: "Returns the current synchronization state and metrics",
      http: [Http.get("/status")],
    }),
    resetCursor: method({
      params: {},
      success: S3TaskStatusResponseSchema,
      description: "Resets the sync cursor to force a full rescan on the next sync",
      http: [Http.post("/reset")],
    }),
    startSchedule: method({
      params: { intervalSeconds: Schema.Number },
      success: S3TaskStatusResponseSchema,
      description: "Starts recurring synchronization for this S3 resource",
      http: [Http.post("/schedule/start")],
    }),
    stopSchedule: method({
      params: {},
      success: S3TaskStatusResponseSchema,
      description: "Stops recurring synchronization for this S3 resource",
      http: [Http.post("/schedule/stop")],
    }),
    scheduledTick: method({
      params: {},
      success: Schema.Boolean,
      description: "Called by Golem host timer to execute scheduled sync and schedule next cycle",
    }),
    ingestWebhook: method({
      params: { payload: WebhookIngestPayloadSchema },
      success: S3TaskStatusResponseSchema,
      description: "Push webhook ingress for external change events",
      http: [Http.post("/webhook")],
    }),
  },
});
```

#### Self-Scheduling via Golem Host Timers
Instead of requiring an external cron service, the agent self-schedules its next execution using Golem's native timer runtime:
```typescript
const scheduleNextTick = (agent: S3TaskAgentHandle, intervalSeconds: number) =>
  Effect.gen(function* () {
    const fireAt = new Date(Date.now() + intervalSeconds * 1000);
    yield* agent.schedule(fireAt).scheduledTick();
  });
```
If the host server reboots or migrates, Golem preserves the durable timer and executes the invocation when due.

---

### Agent 2: `WebIngestorTaskAgent` (Durable Web Worker)

The [`WebIngestorTaskAgent`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/agents/web-task-agent.ts) is partitioned 1:1 by web resource (e.g., `golem-docs`, `effect-specs`). It discovers web pages using `sitemap.xml` parsing or URL frontier traversal, converts HTML to clean Markdown, and streams processing with $O(1)$ body memory. Like the S3 agent, it persists URL ETags and content hashes directly to the PostgreSQL `sync_checkpoints` table, keeping its durable snapshot lightweight.

#### Agent Interface Definition

```typescript
export const WebIngestorTaskAgentDefinition = defineAgent({
  name: "WebIngestorTaskAgent",
  description: "Durable Web Page / Documentation ingestion task worker bound 1:1 to a web resource target",
  mode: "durable",
  config: AppAgentConfig,
  constructorParams: {
    resourceName: Schema.String,
  },
  http: Http.mount("/api/ingestion/web/{resourceName}", { cors: ["*"] }),
  snapshot: Snapshot.define({
    schema: WebTaskStateSchema,
    policy: Snapshot.policy.everyN(5),
  }),
  methods: {
    sync: method({
      params: { force: Schema.optional(Schema.Boolean) },
      success: WebTaskStatusResponseSchema,
      description: "Executes full or incremental synchronization of the bound Web resource",
      http: [Http.post("/sync")],
    }),
    getStatus: method({
      params: {},
      success: WebTaskStatusResponseSchema,
      description: "Returns the current synchronization state and metrics",
      http: [Http.get("/status")],
    }),
    resetCursor: method({
      params: {},
      success: WebTaskStatusResponseSchema,
      description: "Resets the sync cursor to force a full rescan on the next sync",
      http: [Http.post("/reset")],
    }),
    startSchedule: method({
      params: { intervalSeconds: Schema.Number },
      success: WebTaskStatusResponseSchema,
      description: "Starts recurring synchronization for this Web resource",
      http: [Http.post("/schedule/start")],
    }),
    stopSchedule: method({
      params: {},
      success: WebTaskStatusResponseSchema,
      description: "Stops recurring synchronization for this Web resource",
      http: [Http.post("/schedule/stop")],
    }),
    scheduledTick: method({
      params: {},
      success: Schema.Boolean,
      description: "Called by Golem host timer to execute scheduled sync and schedule next cycle",
    }),
    ingestWebhook: method({
      params: { payload: WebhookIngestPayloadSchema },
      success: WebTaskStatusResponseSchema,
      description: "Push webhook ingress for external change events",
      http: [Http.post("/webhook")],
    }),
  },
});
```

---

### Agent 3: `KnowledgeAccessAgent` (Ephemeral Query Gateway & MCP Server)

Configured with `mode: "ephemeral"`, the [`KnowledgeAccessAgent`](https://github.com/justcoon/golem-kgs-effect/blob/main/src/agents/access-agent.ts) handles concurrent search, graph traversal, and answer generation without persistent actor state overhead.

#### Agent Interface Definition

```typescript
export const KnowledgeAccessAgent = defineAgent({
  name: "KnowledgeAccessAgent",
  description: "Stateless ephemeral gateway for high-throughput concurrent search, graph traversal, GraphRAG, and question-answering",
  promptHint: "Query and explore the knowledge graph, retrieve documents, execute GraphRAG, and answer questions",
  mode: "ephemeral",
  config: AppAgentConfig,
  constructorParams: {},
  http: Http.mount("/api/knowledge", { cors: ["*"] }),
  methods: {
    // 1. Hybrid Vector + Full-Text Search
    search: method({
      params: {
        query: Schema.String,
        limit: Schema.optional(Schema.Number),
        searchType: Schema.optional(Schema.Literals(["hybrid", "vector", "keyword"])),
      },
      success: SearchResponseSchema,
      http: [Http.post("/search")],
    }),

    // 2. Entity Discovery & Graph Hubs
    searchEntities: method({
      params: { query: Schema.optional(Schema.String), limit: Schema.optional(Schema.Number) },
      success: EntitySearchResponseSchema,
      http: [Http.post("/entities/search")],
    }),
    getTopEntities: method({
      params: { limit: Schema.optional(Schema.Number) },
      success: EntitySearchResponseSchema,
      http: [Http.post("/entities/top")],
    }),

    // 3. Multi-Hop Neighborhood Exploration
    getNeighborhood: method({
      params: {
        entityId: Schema.String,
        maxDepth: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
        minConfidence: Schema.optional(Schema.Number),
      },
      success: NeighborhoodResponseSchema,
      http: [Http.post("/neighborhood")],
    }),

    // 4. Shortest Relational Path Finding
    findPaths: method({
      params: {
        sourceEntityId: Schema.String,
        targetEntityId: Schema.String,
        maxDepth: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
        direction: Schema.optional(Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"])),
      },
      success: PathFindingResultSchema,
      http: [Http.post("/paths")],
    }),

    // 5. GraphRAG Context Retrieval
    graphRag: method({
      params: {
        query: Schema.String,
        topK: Schema.optional(Schema.Number),
        maxHops: Schema.optional(Schema.Number),
        minConfidence: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
      },
      success: GraphRAGContextBundleSchema,
      http: [Http.post("/graphrag")],
    }),

    // 6. Natural Language Question Answering
    ask: method({
      params: {
        query: Schema.String,
        topK: Schema.optional(Schema.Number),
        maxHops: Schema.optional(Schema.Number),
        generateAnswer: Schema.optional(Schema.Boolean),
      },
      success: AnswerResponseSchema,
      http: [Http.post("/ask")],
    }),

    // 7. Inspections & Metadata
    getEntity: method({
      params: { id: Schema.String },
      success: Schema.NullOr(EntityResultSchema),
      http: [Http.get("/entities/{id}")],
    }),
    getEntityDocuments: method({
      params: { id: Schema.String },
      success: Schema.Array(DocumentSummarySchema),
      http: [Http.get("/entities/{id}/documents")],
    }),
    getDocument: method({
      params: { id: Schema.String },
      success: Schema.NullOr(DocumentResultSchema),
      http: [Http.get("/documents/{id}")],
    }),
    getOverview: method({
      params: {},
      success: KnowledgeBaseOverviewSchema,
      http: [Http.get("/overview")],
    }),
  },
});
```

#### Key Capabilities in Action

- **Hybrid Search via Reciprocal Rank Fusion (RRF)**: Combines vector cosine similarity with PostgreSQL full-text search rankings using $RRF(d) = \sum \frac{1}{60 + \text{rank}(d)}$, delivering high recall for exact keywords alongside conceptual relevance.
- **Topological Graph Traversal**: Breadth-First Search (BFS) neighborhood traversal up to $N$ hops with dynamic edge filtering and Bayesian confidence pruning.
- **Relational Shortest Path Search**: Finds structural connections between disparate entities (e.g. `golem-cloud` $\xrightarrow{\text{DEPENDS_ON}}$ `wasm` $\xleftarrow{\text{COMPILES_TO}}$ `typescript`).
- **GraphRAG Question Answering (`/ask`)**: Fetches grounding chunks, discovers related entities and directed edges, structures the combined context, and invokes LLM synthesis with automatic citation generation.

---

## 5. Native Model Context Protocol (MCP) Integration

Rather than building a separate MCP adapter, `KnowledgeAccessAgent` is exposed directly as an **MCP Server** via Golem's Streamable HTTP transport:

In [`golem.yaml`](https://github.com/justcoon/golem-kgs-effect/blob/main/golem.yaml):
```yaml
mcp:
  deployments:
    local:
      - domain: localhost:9007
        agents:
          KnowledgeAccessAgent: {}
```

Any MCP client (such as Claude Desktop or Cursor) connects directly to `http://localhost:9007/mcp`. All agent methods are automatically exposed as structured MCP tools (`KnowledgeAccessAgent-search`, `KnowledgeAccessAgent-graphRag`, `KnowledgeAccessAgent-ask`, etc.) complete with typed JSON schemas and prompt hints.

---

## 6. Interactive Frontend Explorer

To make the knowledge graph and GraphRAG capabilities accessible, we built an interactive visual web explorer with **Vue 3** and **Vite** (available in [`frontend/`](https://github.com/justcoon/golem-kgs-effect/tree/main/frontend)).

### Visual Feature Breakdown

1. **Force-Directed Graph Canvas**:
   A custom, high-performance HTML5 Canvas physics simulation that visualizes canonical entities as nodes and relationships as directed edges. Users can search entities with autocomplete, explore top connected hubs, expand node neighborhoods, and filter by edge type or confidence.
2. **Multi-Hop Relational Path Finder**:
   Users select a source and target entity to calculate and render the shortest relational path between them, highlighting intermediate nodes, edge weights, and relation types.
3. **Entity Detail & Provenance Drawer**:
   Clicking any entity slides out an inspector displaying its canonical attributes, alternative aliases, connected inbound/outbound relationships, and direct links to grounding document chunks.
4. **Hybrid Search Interface**:
   Provides immediate search over ingested documentation, allowing users to toggle between **Hybrid (RRF)**, **Vector**, and **Keyword** modes while displaying cosine similarity and rank scores.
5. **GraphRAG Question Answering**:
   An AI assistant view where natural language questions produce answers formatted in GitHub-Flavored Markdown with clickable source citations, expandable context bundles, and the traversed subgraph triples that justified the response.
6. **Raw Document & Section Modal**:
   Allows users to inspect original source Markdown documents, view section breadcrumbs, and inspect chunk token stats.

---

## 7. What Makes This Stack Unique?

### 1. Zero Infrastructure Baggage
In a standard architecture, achieving self-scheduling, fault-tolerant background ETL and high-throughput query handling requires maintaining Celery/Temporal workers, Redis message brokers, Cron jobs, and external API gateways. With **Golem Cloud**, each agent is a self-contained, durable WebAssembly actor with built-in timers, durable execution, and native HTTP/MCP routing.

### 2. Bulletproof Reliability with Effect-TS
Writing distributed ETL pipelines in TypeScript is often plagued by silent errors, untracked async promises, and unhandled runtime exceptions. By leveraging **Effect**:
- Every error is typed and tracked in the function signature (no unexpected crashes).
- Resources (database connection pools, HTTP connections) are managed via `Scope` and `Layer`.
- Retries, timeouts, and fallbacks are declarative and composable.

### 3. Explainable, Grounded AI
Pure vector search is a black box that often returns fragmented chunks lacking structural context. By merging vector embeddings with an explicit knowledge graph, **golem-kgs-effect** gives users and AI agents the best of both worlds: semantic discovery and verifiable, structured relational grounding.

---

## Summary & Getting Started

The complete project is open-source and available on GitHub at **[https://github.com/justcoon/golem-kgs-effect](https://github.com/justcoon/golem-kgs-effect)**.

To explore the code, deploy the agents, or run the frontend explorer locally:

```bash
# 1. Clone the repository
git clone https://github.com/justcoon/golem-kgs-effect.git
cd golem-kgs-effect

# 2. Start PostgreSQL, S3 (RustFS), and Ollama
docker compose up -d

# 3. Build and deploy Golem agents
npm install
golem build
golem deploy

# 4. Launch the frontend explorer
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` to explore your knowledge graph visually!
