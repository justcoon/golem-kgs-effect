# Knowledge Graph System (KGS) Implementation Plan & Roadmap

## 1. Executive Summary & Purpose

The purpose of this document is to establish an architectural blueprint, code organization strategy, testing taxonomy, and phased implementation roadmap for the **Knowledge Graph System (KGS)**. 

KGS is an enterprise semantic knowledge platform hosted natively on the Golem Cloud Durable Execution Engine. Built with TypeScript and Effect, the platform ingests semi-structured and unstructured data, harmonizes facts into a unified Labeled Property Graph (LPG) backed by PostgreSQL and pgvector, and exposes hybrid retrieval and GraphRAG context assembly services for autonomous AI agents and client applications.

### Initial Implementation Scope vs. Future Extensions
To deliver a robust, end-to-end verified foundation with minimal initial operational surface, the implementation is phased as follows:
- **Active Initial Scope:** 
  - **Storage Substrate:** PostgreSQL with pgvector for entities, edges, chunks, and embeddings.
  - **Primary Ingestion Source:** S3-compatible Object Storage (RustFS in local development / AWS S3 in cloud), processing technical documents, Markdown, text, and PDF assets.
  - **Semantic AI Services:** Ollama (local) / Cloud LLMs for text embedding and entity/relation extraction.
  - **Orchestration & Serving:** Full Golem durable agent topology and Golem-native HTTP API Gateway for search, traversal, and GraphRAG retrieval.
- **Future Pluggable Extensions:** 
  - Ingestion from **Messaging Platforms (Slack)** and **Enterprise Wikis (Confluence/Notion)** is fully accommodated in the architecture, domain models, and connector framework contracts (`connector-base.ts`), but deferred to a subsequent milestone to keep the initial delivery focused and streamlined.

Unlike traditional Node.js/web applications that require external web frameworks (like Express or Fastify), KGS leverages Golem's built-in API Gateway and native HTTP engine. Durable agents declare their own HTTP mount paths and method endpoints directly using the Effect Golem SDK, and the Golem host handles URL routing, parameter decoding, security, and response serialization automatically.

Concrete test scenarios will be elaborated in a dedicated document (`test-scenarios.md`). This plan establishes the overarching architectural foundation, file layout, agent design, external system contracts, and testing domains required to execute the project successfully.

---

## 2. System Architecture

The system is structured as a multi-tier, event-aware, and durable processing architecture that guarantees at-least-once ingestion, exactly-once state updates, and deterministic crash recovery.

### 2.1 Layered Architecture Overview

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │            1. GOLEM NATIVE API GATEWAY & SERVING LAYER                 │
 │  • Golem Host Gateway (httpApi deployment in golem.yaml)               │
 │  • Direct Agent HTTP Mounts (Http.mount & method routes)               │
 │  • GraphRAG Context Packaging & Subgraph Extraction                    │
 │  • Hybrid Search Engine (Vector + Lexical via Reciprocal Rank Fusion)   │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │                   2. DURABLE AGENT ORCHESTRATION LAYER                 │
 │  • IngestionCoordinatorAgent (Supervision, Registry, Webhook Ingress)  │
 │  • IngestorTaskAgent (Target-Specific Workers, Durable Checkpoints)    │
 │  • KnowledgeAccessAgent (Query Interface, Traversal Coordinator)       │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │                   3. PROCESSING & EXTRACTION PIPELINE                  │
 │  • Windowing & Semantic Chunking Engine                                │
 │  • Entity & Relation Extraction Engine (NER / Rule-based / LLM)        │
 │  • Entity Resolution, Alias Merging & Knowledge Fusion Engine          │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │                      4. INGESTION CONNECTOR LAYER                      │
 │  • Base Connector Framework & Lifecycle (connector-base.ts)            │
 │  • S3 / Object Storage Connector (RustFS / AWS S3) [ACTIVE]            │
 │  • [Future Extension] Messaging Connector (Slack)                      │
 │  • [Future Extension] Wiki Connector (Confluence / Notion)             │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │                     5. HYBRID GRAPH STORAGE LAYER                      │
 │  • PostgreSQL Relational Tables (Entities, Edges, Aliases, Metadata)   │
 │  • pgvector Semantic Storage (Dense Chunk Embeddings)                  │
 │  • Full-Text Search Indexes & Provenance Audit Records                 │
 └────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Ingestion & Processing Dataflow

1. **Source Discovery:** Connectors query external systems for new or modified artifacts using durable cursor tokens, timestamps, or incoming webhooks.
2. **Standardization:** Raw payload streams are converted into a canonical intermediate document representation containing text, source URI, author metadata, and temporal anchors.
3. **Chunking:** Documents are segmented into overlapping semantic windows with preserved heading and structural context.
4. **Knowledge Extraction:** Text segments are analyzed via AI embedding and inference services to extract candidate entities, properties, and relationship triples.
5. **Entity Resolution & Fusion:** Candidate entities are matched against existing nodes using string similarity, alias directories, and vector proximity. Canonical identities are updated, aliases recorded, and confidence scores merged.
6. **Atomic Persistence:** Graph nodes, directed edges, text chunks, vector embeddings, and provenance records are committed to PostgreSQL within transactional boundaries.

### 2.3 Durable Execution & Fault Tolerance Model

- **State Continuity:** Long-running sync loops run inside durable Golem agents. If a worker is interrupted by network failure or host maintenance, the agent resumes execution from its last durable step without re-scanning completed documents.
- **Durable Checkpoints:** Connectors maintain cursor state in agent memory backed by periodic snapshots, ensuring exactly-once processing semantics at the graph level.
- **Idempotent Ingestion:** Every write operation is upsert-safe. Re-processing a document updates timestamps and relationship weights without creating orphan nodes or duplicate edges.

---

## 3. Agent Topology & Durable Orchestration

The system partitions responsibilities among three primary durable agent types operating under supervision.

```
                   ┌───────────────────────────────┐
                   │   IngestionCoordinatorAgent   │
                   │ • Connectors Registry         │
                   │ • Cron Sync Scheduler         │
                   │ • Worker Supervision & Health │
                   │ • Admin & Webhook HTTP Mounts │
                   └───────────────┬───────────────┘
                                   │
                   ┌───────────────┴───────────────┐
                   │ Dispatches & Monitors         │
                   ▼                               ▼
     ┌───────────────────────────┐   ┌───────────────────────────┐
     │    S3IngestorTaskAgent    │   │  [Future] Ingestor Agent  │
     │ (Target: Bucket & Prefix) │   │ (e.g. Slack, Confluence)  │
     │ • S3-Typed Identity       │   │ • Dedicated Constructor   │
     │ • ETag / Timestamp Cursor │   │ • Specialized Snapshot    │
     │ • Streaming Extraction    │   │ • Source-Specific Schema  │
     └───────────────────────────┘   └───────────────────────────┘

     ┌───────────────────────────────────────────────────────────┐
     │          KnowledgeAccessAgent (Stateless Ephemeral)       │
     │ • Query & Traversal HTTP Mounts (/api/knowledge/...)      │
     │ • Topological Multi-Hop Graph Traversals                  │
     │ • Vector, Lexical & Hybrid Search Execution               │
     │ • GraphRAG Context Bundle Assembly                        │
     └───────────────────────────────────────────────────────────┘
```

### 3.1 Ingestion Coordinator Agent

- **Role:** Central supervisor managing the registry of configured connectors, driving synchronization cadences, and managing worker lifecycle.
- **Responsibilities:**
  - Maintains persistent configuration records for all registered external sources (initially S3 buckets; extensible to additional sources).
  - Exposes administrative HTTP endpoints via Golem native mounts for registering, triggering, pausing, and inspecting connectors.
  - Exposes webhook ingress HTTP routes for real-time push event handling.
  - Drives recurring synchronization cadences using **Golem native durable scheduling** (`.schedule(scheduledAt, ...)`):
    - Replaces external cron daemons, Kubernetes cron jobs, or sleeping process loops with Golem's built-in host scheduler.
    - An agent calculates the next sync timestamp and invokes `.schedule()` on its own or worker client handles.
    - Between scheduled runs, the agent **durably suspends with zero CPU/memory consumption**.
    - Scheduled invocations persist across host restarts and node maintenance, firing deterministically at the exact scheduled epoch time.
    - Returns cancelable handles, allowing ad-hoc pausing, resuming, or interval modifications.
  - Spawns and tracks the lifecycle of dedicated, resource-specific task agents (such as `S3IngestorTaskAgent`).
  - Aggregates system-wide ingestion metrics, status records, error counts, and operational health states.
- **Durability Strategy:**
  - Uses durable schema-backed state snapshots to persist active connector definitions, next scheduled invocation timestamps, and historical synchronization summaries.
  - Restores the sync schedule deterministically following agent reactivation or node failover.

### 3.2 S3 Ingestor Task Agent (Resource-Specific Worker)

- **Role:** Dedicated, resource-specific worker agent instantiated per S3 sync target (e.g. a specific S3 bucket name and key prefix).
- **Why Resource-Specific Agents are Idiomatic in Golem:**
  - **Durable Identity via Constructor Parameters:** Golem defines an agent's durable identity by its constructor parameters. An `S3IngestorTaskAgent` has strongly typed constructor parameters (such as `bucket` and `prefix`), creating deterministically addressable agent instances like `S3IngestorTaskAgent(bucket: "golem-documents", prefix: "technical-docs")`.
  - **Specialized Snapshot Schemas:** Each external source possesses fundamentally different checkpoint structures. S3 synchronization requires tracking object keys, ETags, and last-modified timestamps, whereas future chat or wiki sources require message thread cursors or page tree versions. Modeling dedicated agents allows each agent's durable snapshot schema to be strictly typed to its specific resource without complex polymorphic state unions.
  - **Isolated Fault Domains & Retries:** An S3 rate limit or network partition only halts the specific `S3IngestorTaskAgent` instance responsible for that bucket prefix, without impacting other workers or the coordinator.
- **Responsibilities:**
  - Connects to S3/RustFS storage using credentials injected through configuration.
  - Tracks durable sync cursors, modification timestamps, and continuation tokens.
  - Executes document extraction, windowing, semantic vectorization, and knowledge fusion.
  - Commits transformed graph facts to PostgreSQL within transactional boundaries.
  - Handles S3 rate limits, pagination backoff, and transient connection drops.
- **Durability Strategy:**
  - Saves durable checkpoints after each batch of processed documents into an S3-specific snapshot schema.
  - In the event of an infrastructure restart, resumes execution precisely from the last uncommitted object cursor.

### 3.3 Knowledge Access Agent (Stateless Ephemeral Gateway)

- **Role:** Client-facing gateway agent exposing search, graph traversal, and GraphRAG retrieval capabilities via native HTTP endpoints.
- **Execution Mode:** `mode: "ephemeral"` (Stateless Agent)
- **Why Ephemeral Mode is the Optimal Architectural Choice:**
  - **High-Throughput Concurrency (No Request Queuing):** In Golem, durable agent instances process invocations strictly sequentially. If `KnowledgeAccessAgent` were durable, concurrent client queries would queue behind one another. Under `mode: "ephemeral"`, Golem handles every incoming HTTP request concurrently with an independent handler instance.
  - **Zero Oplog Replay Overhead:** Replaying historical search queries during crash recovery is unnecessary and wasteful. Ephemeral mode skips oplog recording for read traffic, avoiding write overhead and disk bloat.
  - **Canonical State in PostgreSQL:** The agent is purely functional and stateless; all ground truth resides in PostgreSQL and pgvector.
  - **Instant Memory Reclamation:** In-memory vector and graph traversal buffers are discarded immediately once the HTTP response is returned to the client.
- **Responsibilities:**
  - Mounts HTTP routes directly on the agent definition using Golem SDK HTTP primitives (`Http.mount("/api/knowledge", { phantomAgent: true })`).
  - Translates natural-language search queries into vector embeddings (via Ollama) and SQL full-text queries.
  - Executes multi-hop graph neighborhood queries, shortest-path algorithms, and path traversals in PostgreSQL.
  - Combines vector similarity results with keyword search scores using Reciprocal Rank Fusion (RRF).
  - Formats grounded retrieval bundles (nodes, edges, textual chunks, and provenance links) for LLM consumption.

### 3.4 Agent-Level Webhook Architecture

Golem supports native webhook primitives at the agent level through two complementary integration mechanisms:

1. **Stable Push Webhook Endpoints (`Http.mount` with `Http.post`):**
   - **Use Case:** Long-lived push integrations from external platforms that require a static, pre-registered callback URL (such as future Slack Event Subscriptions or wiki update feeds).
   - **Mechanics:** The agent registers a static route under its mount (such as `/webhooks/events`). The Golem API Gateway routes incoming HTTP POST payloads directly to the agent instance, decodes the body against an Effect Schema, and triggers the ingestion pipeline.

2. **Durable One-Shot Webhooks (`Webhook.create` and `handle.await`):**
   - **Use Case:** Asynchronous external workflows where an agent requests external work and must await a completion notification without wasting compute resources (e.g., triggering an asynchronous S3 document batch export, third-party OCR conversion, or cloud AI batch extraction).
   - **Mechanics:** 
     - The agent calls Golem's native `Webhook.create`, which allocates an underlying durable promise and mints a cryptographically signed public URL (`handle.url`).
     - The agent communicates `handle.url` to the external system (e.g. via an outbound HTTP request).
     - The agent calls `handle.await`, which **durably suspends the agent execution without consuming compute**. The agent remains paused until the external provider POSTs its result payload to the signed URL.
     - Upon receiving the external POST, the Golem runtime resolves the underlying promise, reawakens the agent, and delivers the payload for schema validation and processing.
     - Configured with `webhookSuffix` on the agent's `Http.mount(...)` and `webhookUrl` in the `golem.yaml` deployment.

---

## 4. External Systems & Integration Patterns

### 4.1 Active External Systems (Initial Scope)

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    ACTIVE EXTERNAL SYSTEMS (INITIAL)                   │
 └───────────────┬───────────────────┬───────────────────┬────────────────┘
                 │                   │                   │
                 ▼                   ▼                   ▼
          ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
          │ PostgreSQL  │     │ Object Store│     │ AI & Vector │
          │ (pgvector)  │     │  (RustFS)   │     │  Providers  │
          └─────────────┘     └─────────────┘     └─────────────┘
          • Graph nodes       • PDF, MD, TXT      • Embeddings
          • Graph edges       • ETags / Mod-Time  • NER & Relation
          • Text chunks       • Bucket scans        Extraction
          • RRF search        • Streaming read    • Semantic match
```

#### 1. PostgreSQL Database with pgvector
- **Primary Role:** Canonical storage engine for the Labeled Property Graph, text chunks, vector embeddings, and ingestion metadata.
- **Integration Pattern:**
  - Agents interact with PostgreSQL using Golem's host-provided RDBMS interface via the Effect database layer.
  - Connection credentials and pool boundaries are configured via environment parameters.
- **Key Schemas & Responsibilities:**
  - Relational tables maintain entity identities, entity aliases, directed edges, properties, and provenance metadata.
  - The vector extension stores 768-dimensional dense vector embeddings generated from document chunks.
  - Full-text search indexes provide lexical keyword retrieval over entity names, aliases, and document chunks.
  - Structural relational constraints enforce foreign keys, unique entity identifiers, and referential integrity across graph edges.

#### 2. S3-Compatible Object Storage (RustFS / AWS S3)
- **Primary Role:** Primary document repository holding technical documentation, legal files, architecture records, and reports.
- **Integration Pattern:**
  - Accessed over outbound HTTPS using standard S3 protocol semantics.
  - Development and testing environments leverage a local RustFS container initialized with designated buckets (`golem-documents`, `legal-docs`, `technical-docs`, `archive-docs`).
- **Usage Mechanics:**
  - Scans bucket prefixes to discover object additions and modifications.
  - Uses object metadata, ETags, and modification timestamps as synchronization cursors.
  - Streams file contents into the chunking pipeline without reading unbounded files entirely into memory.

#### 3. External AI & Embedding Providers (Ollama / Cloud LLMs)
- **Primary Role:** Semantic processing engine for text embeddings and entity/relation extraction.
- **Integration Pattern:**
  - Interacts over outbound HTTPS APIs.
  - Local development and testing environments use an Ollama container running the designated embedding model (`nomic-embed-text`, 768 dimensions).
  - Production environments support external cloud-hosted inference providers (such as OpenAI or Anthropic).
- **Usage Mechanics:**
  - Generates high-dimensional vector representations for document chunks during ingestion.
  - Vectorizes natural language search queries at runtime for vector similarity retrieval.
  - Performs structured extraction of candidate entities, types, and relationships from text chunks.

---

### 4.2 Future Ingestion Systems (Extensible Architecture)

The system architecture and connector contracts are deliberately designed so that additional organizational sources can be added cleanly as modular plugins without restructuring the core graph database, extraction pipeline, or query APIs:

#### 1. Communication Platforms (Slack & Messaging Systems)
- **Role in Expanded Scope:** Dynamic organizational knowledge source capturing conversations, technical discussions, and decisions.
- **Integration Path:** Implemented as a connector adhering to the base connector contract. Leverages scheduled polling against channel histories or Golem agent webhook ingress to reconstruct conversation threads into discussion blocks.

#### 2. Enterprise Wikis & Collaboration Platforms (Confluence / Notion)
- **Role in Expanded Scope:** Authoritative documentation source containing structured guides, policies, specifications, and architecture decision records.
- **Integration Path:** Implemented as a connector adhering to the base connector contract. Traverses wiki space hierarchies and page parent-child trees to capture structural containment relationships alongside page content.

---

## 5. Code Organization

The repository is structured as a clean, modular Effect application adhering to Golem's component model and separation of concerns. HTTP endpoints are declared directly on agents using Golem SDK primitives. Connectors follow a modular pattern anchored by a shared base lifecycle contract.

```
golem-kgs-effect/
├── .agents/                                # Agent skills and IDE instructions
├── migrations/                             # Database schema migrations
│   ├── 001_initial_schema.sql             # Base pgvector extension setup
│   ├── 002_graph_tables.sql               # Entities, edges, aliases, properties
│   └── 003_chunks_and_embeddings.sql      # Chunks, vectors, full-text indexes
├── src/
│   ├── main.ts                            # Application entry point & agent registration
│   ├── config/                            # Environment & runtime configuration
│   │   ├── app-config.ts                  # Typed application settings
│   │   └── database-config.ts             # Connection strings & pool settings
│   ├── domain/                            # Core domain models, schemas & types
│   │   ├── entity.ts                      # Entity, alias & property definitions
│   │   ├── relationship.ts                # Edge & relation definitions
│   │   ├── chunk.ts                       # Document chunk & embedding models
│   │   ├── provenance.ts                  # Lineage, source & timestamp models
│   │   ├── query.ts                       # Traversal, search & GraphRAG schemas
│   │   └── connector.ts                   # Connector configuration & state models
│   ├── storage/                           # Database access & repositories
│   │   ├── database-client.ts             # Golem PostgreSQL client setup
│   │   ├── entity-repository.ts           # Entity & alias CRUD and upsert logic
│   │   ├── graph-repository.ts            # Edge management & traversal queries
│   │   ├── chunk-repository.ts            # Text chunk & vector similarity operations
│   │   └── checkpoint-repository.ts       # Ingestion cursor & sync state persistence
│   ├── pipeline/                          # Content processing & transformation
│   │   ├── chunker.ts                     # Semantic windowing & text chunking
│   │   ├── extractor.ts                   # Entity & relationship extraction
│   │   ├── entity-resolver.ts             # Duplicate resolution, alias mapping & fusion
│   │   └── embedding-service.ts           # Embedding generation client
│   ├── connectors/                        # External data source integrations
│   │   ├── connector-base.ts              # Common connector contract & lifecycle
│   │   └── s3-connector.ts                # S3/RustFS bucket reader & cursor tracker [ACTIVE]
│   └── agents/                            # Golem durable agents (HTTP mounts included)
│       ├── coordinator-agent.ts           # Ingestion coordinator & admin HTTP mounts
│       ├── s3-task-agent.ts               # Dedicated S3 bucket ingestion worker
│       └── access-agent.ts                # Search, traversal & GraphRAG HTTP mounts
├── docker-compose.yml                     # Local PostgreSQL, RustFS, Ollama services
├── golem.yaml                             # Golem manifest: httpApi gateway & deployments
├── package.json                           # Dependencies & build scripts
├── plan.md                                # This implementation plan & roadmap
├── test-scenarios.md                      # Detailed test scenario specifications
└── tsconfig.json                          # TypeScript configuration
```

---

## 6. Major Files & Module Inventory

The following table summarizes the primary files across the project and their specific functional responsibilities, free of code snippets or method signatures.

| Major File | Responsibility & Purpose |
| :--- | :--- |
| `src/main.ts` | Application bootstrap file that imports all agent implementation modules and registers durable agents with the Golem runtime. |
| `golem.yaml` | Application manifest defining Golem components, durable agent templates, and the native httpApi gateway deployments routing to agent mounts. |
| `docker-compose.yml` | Infrastructure definition spinning up local PostgreSQL with pgvector, RustFS S3 storage, and Ollama for embeddings. |
| `migrations/002_graph_tables.sql` | SQL migration creating tables for entities, entity aliases, directed graph edges, and provenance records with foreign key constraints. |
| `migrations/003_chunks_and_embeddings.sql` | SQL migration creating document chunk tables, vector columns, cosine similarity indexes, and full-text search indexes. |
| `src/config/app-config.ts` | Typed configuration layer defining application settings, external service endpoints, and operational thresholds. |
| `src/domain/entity.ts` | Schema definitions for canonical entities, semantic entity types, alias mappings, and dynamic key-value properties. |
| `src/domain/relationship.ts` | Schema definitions for directed graph edges, relationship types, confidence weights, and temporal validity intervals. |
| `src/domain/chunk.ts` | Schema definitions for document excerpts, token counts, chunk sequence orders, and dense vector embedding vectors. |
| `src/domain/provenance.ts` | Schema definitions tracking source systems, document URIs, extraction timestamps, and version hashes. |
| `src/domain/query.ts` | Schema definitions for graph traversal queries, hybrid search criteria, ranking parameters, and GraphRAG context bundles. |
| `src/domain/connector.ts` | Schema definitions for connector configuration, sync status records, and cursor tracking. |
| `src/storage/database-client.ts` | Database connection management configuring Golem host-provided PostgreSQL access and transactional boundaries. |
| `src/storage/entity-repository.ts` | Repository managing entity persistence, upsert logic, alias deduplication, and entity lookup by identifier or name. |
| `src/storage/graph-repository.ts` | Repository executing graph edge management, multi-hop neighborhood traversals, shortest path analysis, and subgraph extraction. |
| `src/storage/chunk-repository.ts` | Repository handling text chunk storage, pgvector similarity lookups, and lexical full-text search queries. |
| `src/storage/checkpoint-repository.ts` | Repository persisting synchronization cursors, last-modified timestamps, and connector execution history. |
| `src/pipeline/chunker.ts` | Processing module splitting document streams into overlapping semantic windows while maintaining parent structural context. |
| `src/pipeline/embedding-service.ts` | Service interfacing with embedding providers (such as Ollama or OpenAI) to convert text chunks into vector embeddings. |
| `src/pipeline/extractor.ts` | Semantic extraction module identifying candidate entities and relationship triples from unstructured text. |
| `src/pipeline/entity-resolver.ts` | Fusion module performing entity matching, alias reconciliation, confidence score merging, and deduplication. |
| `src/connectors/connector-base.ts` | Abstract base definitions and lifecycle contracts that all ingestion source connectors must adhere to. |
| `src/connectors/s3-connector.ts` | Active object storage connector scanning buckets, reading files, tracking ETag cursors, and emitting document streams. |
| `src/agents/coordinator-agent.ts` | Durable agent supervising connector registrations, executing recurring sync timers, and exposing administrative & webhook HTTP mounts. |
| `src/agents/s3-task-agent.ts` | Durable agent driving S3 bucket scanning, file streaming, ETag cursor persistence, and transactional graph writes. |
| `src/agents/access-agent.ts` | Stateless ephemeral agent (`mode: "ephemeral"`) declaring native HTTP mounts for entity search, graph traversals, hybrid search fusion, and GraphRAG context retrieval. |

---

## 7. Testing Hierarchy & Testing Domains

A robust testing architecture ensures functional correctness, data integrity, and system resilience across normal operations and unexpected failures. 

Concrete test scenarios will be elaborated in a dedicated document (`test-scenarios.md`). The sections below establish the testing hierarchy and distinct functional testing domains.

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                          TESTING HIERARCHY                             │
 └────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                   / \
                                  /   \
                                 / E2E \       Level 5: Full End-to-End & GraphRAG
                                /───────\
                               / Durable \     Level 4: Crash Recovery & Oplog Replay
                              /───────────\
                             / Integration \   Level 3: Multi-Agent & DB Operations
                            /───────────────\
                           / Connector Cont. \ Level 2: External Protocol Contracts
                          /───────────────────\
                         /  Pure Domain Logic  \ Level 1: Chunking, Matching & Parsing
                        /───────────────────────\
```

### 7.1 Testing Hierarchy Levels

1. **Level 1: Pure Domain Logic Testing**
   - Focuses on deterministic, side-effect-free algorithms executed completely in memory.
   - Covers document chunking boundaries, text normalization, heuristic entity extractors, string distance matching, and score fusion mathematics.
2. **Level 2: Connector Contract & Protocol Testing**
   - Validates that connectors correctly interpret S3 protocol envelopes, bucket listings, pagination, and error responses.
   - Uses simulated S3 mock servers or local RustFS endpoints to verify protocol parsing and retry behaviors.
3. **Level 3: Stateful Integration & Storage Testing**
   - Tests repository layers against live PostgreSQL instances provisioned with pgvector.
   - Verifies referential integrity, relational constraints, vector similarity queries, and transaction rollback behavior.
4. **Level 4: Durability & Crash Recovery Testing**
   - Evaluates agent durability under interrupted execution conditions using Golem's simulation tools.
   - Verifies that agents resume correctly from operation logs, that durable promises resolve across restarts, and that checkpoints prevent duplicate graph writes.
5. **Level 5: End-to-End System & GraphRAG Verification**
   - Exercises the full lifecycle: document ingestion from S3/RustFS buckets, graph construction, hybrid search, neighborhood expansion, and final context assembly through Golem's HTTP API Gateway.

### 7.2 Testing Domains

Testing is structured into distinct functional and regression domains, ensuring all system capabilities are rigorously validated:

#### Domain A: S3 Ingestion & Connector Resilience
- **Scope:** Validates continuous data acquisition from S3-compatible object storage (RustFS / AWS S3).
- **Focus Areas:**
  - Incremental sync accuracy using object modification timestamps and ETag cursors.
  - Streaming ingestion of large documents without unbounded memory growth.
  - Handling empty buckets, non-existent prefixes, and permission errors gracefully.
  - Recovery from transient network disconnections and S3 rate throttling.

#### Domain B: Document Processing & Chunking Boundaries
- **Scope:** Verifies the transformation of unstructured documents into structured text chunks.
- **Focus Areas:**
  - Preservation of document structure, section headers, and metadata across chunk splits.
  - Chunk overlap consistency to prevent loss of semantic context at boundary edges.
  - Filtering of empty or invalid text blocks.

#### Domain C: Semantic Extraction & Entity Resolution Fusion
- **Scope:** Evaluates candidate entity extraction and deduplication logic.
- **Focus Areas:**
  - Accurate extraction of named entities, semantic types, and relational triples.
  - Deterministic resolution of synonyms, acronyms, and aliases to canonical entities.
  - Preservation of entity provenance and updating of relationship confidence scores upon repeated observation.
  - Prevention of duplicate entity creation during concurrent or replayed ingestion runs.

#### Domain D: Graph Topology & Relational Storage Integrity
- **Scope:** Verifies graph data structures, topological constraints, and relational persistence.
- **Focus Areas:**
  - Strict enforcement of foreign key constraints between edges and participating entities.
  - Correct recording of directional relationships and relationship properties.
  - Performance and correctness of multi-hop neighborhood traversals and path-finding queries.
  - Transactional isolation ensuring partial extraction failures never leave incomplete subgraphs in the database.

#### Domain E: Vector & Hybrid Retrieval Precision
- **Scope:** Measures the accuracy and recall of the search and GraphRAG assembly subsystem.
- **Focus Areas:**
  - Vector similarity retrieval precision using cosine distance in pgvector.
  - Lexical keyword search matching across entity names and document contents.
  - Reciprocal Rank Fusion (RRF) balance between vector and lexical ranking results.
  - Subgraph context bundle assembly containing relevant seed entities, connected neighbors, and supporting text excerpts.

#### Domain F: Agent Durability, Snapshotting & Failover
- **Scope:** Assesses durable computing guarantees under simulated infrastructure failure.
- **Focus Areas:**
  - Verification that interrupted ingestion workflows resume from the exact last saved checkpoint without re-scanning completed items.
  - State snapshot serialization and deserialization integrity across agent revisions.
  - Proper execution of self-scheduled timers for periodic sync triggers after runtime pauses.

#### Domain G: Secrets Protection & Configuration Boundaries
- **Scope:** Ensures safe handling of sensitive external credentials and operational settings.
- **Focus Areas:**
  - Verification that database passwords, S3 secret keys, and API tokens are never emitted into logs or client-facing responses.
  - Proper inheritance of configuration defaults across deployment environments.

#### Domain H: Performance, Concurrency & Rate Throttling
- **Scope:** Validates system stability under heavy data volumes and concurrent workloads.
- **Focus Areas:**
  - Concurrent execution of multiple ingestion workers without database lock contention.
  - Query latency characteristics during multi-hop graph traversals over large graphs.
  - Memory stability during high-throughput vector embedding generation.

---

## 8. Implementation Roadmap

The implementation is organized into sequential phases, building from foundational storage and models up to complete durable agent orchestration and Golem native gateway serving.

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                         IMPLEMENTATION PHASES                          │
 └────────────────────────────────────────────────────────────────────────┘
   Phase 1: Foundations & Storage Substrate
   ├── Database schema migrations (pgvector, entities, edges, chunks)
   └── Core domain models & schemas (entities, edges, queries, config)
         │
         ▼
   Phase 2: Processing Pipeline & Semantic Services
   ├── Chunking engine & windowing logic
   ├── Embedding client & vectorization
   └── Entity extraction & resolution/fusion engine
         │
         ▼
   Phase 3: Base Connector Framework & S3 Ingestion
   ├── Base connector lifecycle contract (connector-base.ts)
   └── S3 / RustFS document connector implementation (s3-connector.ts)
         │
         ▼
   Phase 4: Durable Agent Implementation
   ├── IngestorTaskAgent (cursor tracking, pipeline streaming)
   ├── IngestionCoordinatorAgent (scheduler, worker supervisor)
   └── KnowledgeAccessAgent (query execution, context assembly)
         │
         ▼
   Phase 5: Search Engine & GraphRAG Retrieval
   ├── Multi-hop topological graph traversals
   ├── Vector search & full-text search integration
   ├── Reciprocal Rank Fusion (RRF) engine
   └── GraphRAG context packaging for AI prompts
         │
         ▼
   Phase 6: Golem Native HTTP Gateway & Agent Mounts
   ├── HTTP route declarations on KnowledgeAccessAgent
   ├── Admin & webhook route declarations on IngestionCoordinatorAgent
   └── Deployment mapping in golem.yaml httpApi configuration
         │
         ▼
   Phase 7: System Verification & Hardening
   ├── Validation across all testing domains (A through H)
   └── Execution of test scenarios (detailed in test-scenarios.md)
```

### Phase 1: Foundations & Storage Substrate
- **Deliverables:**
  - Configure database migrations creating all required tables: entities, entity aliases, directed edges, text chunks with pgvector columns, and sync checkpoints.
  - Define core domain schemas using Effect Schema for entities, edges, text chunks, provenance records, query parameters, and connector configurations.
  - Implement the database client layer using Golem host-provided PostgreSQL interfaces with connection pooling and transaction helpers.
  - Implement repository layers for entities, graph edges, document chunks, and sync checkpoints.
- **Dependencies:** Dockerized PostgreSQL with pgvector running locally.

### Phase 2: Processing Pipeline & Semantic Services
- **Deliverables:**
  - Build the document chunker module supporting semantic windowing and structural metadata preservation.
  - Implement the embedding service client communicating with Ollama for vector generation.
  - Implement the entity and relationship extraction module for candidate identification.
  - Build the entity resolution and knowledge fusion engine responsible for alias matching, canonical deduplication, and score consolidation.
- **Dependencies:** Phase 1 domain models and local Ollama instance with the embedding model downloaded.

### Phase 3: Base Connector Framework & S3 Ingestion
- **Deliverables:**
  - Establish the abstract connector lifecycle contract (`connector-base.ts`), defining configuration parsing, discovery, content extraction, and cursor checkpoints.
  - Implement the S3-compatible connector (`s3-connector.ts`) for scanning buckets, streaming files, and tracking ETag/timestamp cursors.
  - Validate against local RustFS buckets (`golem-documents`, `legal-docs`, `technical-docs`).
- **Dependencies:** Phase 2 processing pipeline and local RustFS storage.

### Phase 4: Durable Agent Implementation
- **Deliverables:**
  - Implement the `S3IngestorTaskAgent` to execute S3 source synchronization with durable cursor persistence, rate-limiting backoff, and transactional graph writes.
  - Implement the `IngestionCoordinatorAgent` to maintain connector registries, execute recurring sync timers, and supervise worker tasks.
  - Implement the `KnowledgeAccessAgent` providing query coordination and stateful retrieval operations.
  - Register all agents in the application entry point and configure durability policies and state snapshots.
- **Dependencies:** Phase 1 through Phase 3 components.

### Phase 5: Search Engine & GraphRAG Retrieval
- **Deliverables:**
  - Implement multi-hop neighborhood traversal algorithms and path-finding queries in the graph repository.
  - Implement vector similarity search and SQL full-text search queries.
  - Build the Reciprocal Rank Fusion (RRF) module to combine vector and lexical search rankings.
  - Implement GraphRAG context assembly, packaging seed entities, connected subgraphs, supporting text chunks, and provenance citations into structured prompts.
- **Dependencies:** Phase 1 storage repositories and Phase 2 embedding service.

### Phase 6: Golem Native HTTP Gateway & Agent Mounts
- **Deliverables:**
  - Configure the Golem native API Gateway (`httpApi.deployments`) in `golem.yaml` mapping domains to agent types.
  - Declare HTTP mounts and routes on `KnowledgeAccessAgent` for entity lookup, graph traversals, hybrid search, and GraphRAG context retrieval.
  - Declare HTTP mounts and routes on `IngestionCoordinatorAgent` for connector administration, manual sync triggers, and stable webhook ingress.
  - Implement durable one-shot callback mechanisms (`Webhook.create` / `handle.await`) on task agents for asynchronous external batch jobs.
  - Configure CORS policies, parameter decoding, and Effect Schema response serialization.
- **Dependencies:** Phase 4 durable agents and Phase 5 query capabilities.

### Phase 7: System Verification & Hardening
- **Deliverables:**
  - Execute automated and simulated test suites across all testing domains (Domains A through H).
  - Validate crash recovery and state continuity during active ingestion using Golem fault injection.
  - Benchmark traversal and hybrid search performance under populated graph datasets.
  - Validate scenario-specific acceptance criteria detailed in `test-scenarios.md`.
- **Dependencies:** All prior implementation phases.

---

### 8.1 Future Roadmap Extensions (Post-MVP)

Once the core system is verified and operational with S3 document storage, the following connectors can be added as pluggable modules without altering the underlying storage, agent topology, or query engine:

1. **Web / Documentation Page Connector (`web`):**
   - **Purpose:** Ingests public web documentation, sitemaps (`sitemap.xml`), and raw Markdown/HTML pages directly via Golem's native WASI outbound HTTP (`FetchHttpClient`) without requiring AWS credentials or external storage buckets.
   - **Configuration (`golem.yaml`):** Configured under `secretDefaults.<env>.resources.web`:
     ```yaml
     resources:
       web:
         - name: "golem-docs"
           baseUrl: "https://learn.golem.cloud"
           sitemapUrl: "https://learn.golem.cloud/sitemap.xml"
           includePatterns:
             - "/docs/"
           excludePatterns:
             - "/assets/"
             - "/tags/"
         - name: "effect-specs"
           baseUrl: "https://raw.githubusercontent.com"
           seedUrls:
             - "https://raw.githubusercontent.com/golemcloud/effect-golem/main/README.md"
             - "https://raw.githubusercontent.com/golemcloud/golem/main/README.md"
     ```
   - **Discovery & Extraction:**
     - `discover(cursor)`: Fetches `sitemap.xml` or scans `seedUrls`, tracking change state using HTTP `ETag` and `Last-Modified` headers.
     - `fetch(item)`: Fetches HTML, applies lightweight pure-TS HTML-to-Markdown extraction (preserving titles and headings while stripping scripts/styles), and emits `RawDocument` and `ProvenanceRecord`.
    - **Agent & Routing:**
      - Exposes a durable `WebIngestorTaskAgent` bound 1:1 to `resourceName`, mounted at `/api/ingestion/web/{resourceName}`.
      - Managed and scheduled by `IngestionCoordinatorAgent` under `sourceType: "web"`.
    - **Reference Implementation:**
      - Reuses battle-tested HTML cleaning, redirect resolution, and metadata parsing from [`golem-web-crawler-effect/fetcher-agent.ts`](https://github.com/justcoon/golem-web-crawler-effect/blob/main/src/fetcher-agent.ts). No new database migrations are required; all web metadata is persisted in `documents.metadata` and `sync_checkpoints.cursor_data`.

2. **Messaging Connector (Slack):**
   - Implements `connector-base.ts` to poll channel discussion histories and process incoming webhooks.
   - Reconstructs message threads, links participant entities, and extracts conversational facts into the knowledge graph.
3. **Collaboration Connector (Confluence / Notion):**
   - Implements `connector-base.ts` to traverse wiki spaces and hierarchical page trees.
   - Extracts page revisions, inline comments, and structural containment edges (`CHILD_OF`, `PART_OF`).

---

## 9. Next Steps & Artifact Linkages

Following the approval of this implementation plan:
1. Create `test-scenarios.md` to define concrete operational test scenarios, failure injection workflows, and validation criteria corresponding to the testing domains outlined in Section 7.
2. Initialize database migration scripts (`002_graph_tables.sql` and `003_chunks_and_embeddings.sql`) to establish the graph storage foundation.
3. Begin implementation of Phase 1 domain schemas and storage repositories.
