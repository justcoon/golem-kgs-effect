# Knowledge Graph System (KGS) High-Level Specification

**Version:** 1.0.0  
**Target Platform:** Golem Cloud Durable Execution Engine  
**Implementation Technology:** TypeScript with Effect (`@golemcloud/effect-golem`, `effect`)  
**Primary Database:** PostgreSQL  
**Reference Document:** [`research.md`](./research.md)

---

## 1. Executive Summary & Goals

The **Knowledge Graph System (KGS)** is an enterprise semantic knowledge platform designed to run natively within Golem's durable computing runtime using Effect TypeScript. 

The system continuously acquires, harmonizes, and indexes interconnected unstructured and semi-structured data from disparate enterprise sources (cloud file storage, chat systems, and collaboration wikis). It organizes this knowledge into a unified graph structure enriched with semantic types, relationships, metadata, and vector embeddings.

The system delivers three core capabilities:
1. **Durable, Extensible Ingestion:** Pluggable connectors that ingest data incrementally or via events from external systems, resilient to system restarts and network disruptions.
2. **Knowledge Fusion & Representation:** Automated extraction, resolution, and linking of entities and relationships into an integrated graph model with verifiable provenance.
3. **Comprehensive Data Access & Query Services:** Flexible retrieval capabilities supporting topological traversals, semantic and keyword search, and context assembly for Graph-Augmented Generation (GraphRAG) in AI applications.

---

## 2. External Systems Architecture & Integration

The system leverages several external systems to source raw information, persist the consolidated graph, and perform semantic processing.

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │                          EXTERNAL SYSTEMS                             │
 │                                                                       │
 │   ┌──────────────────────┐    ┌───────────────────────────────────┐   │
 │   │  PostgreSQL Database │    │  AI & Embedding Providers         │   │
 │   │  (Primary Storage)   │    │  (LLM Inference, Vectorization)   │   │
 │   └──────────▲───────────┘    └─────────────────▲─────────────────┘   │
 └──────────────┼──────────────────────────────────┼─────────────────────┘
                │ Golem Host RDBMS                 │ Outbound HTTPS
                ▼                                  ▼
 ┌───────────────────────────────────────────────────────────────────────┐
 │                   GOLEM DURABLE EXECUTION RUNTIME                     │
 │                     (Effect TypeScript Agents)                        │
 └──────────────▲──────────────────▲──────────────────▲──────────────────┘
                │ Outbound HTTPS   │ Webhooks / HTTPS │ Outbound HTTPS
 ┌──────────────┼──────────────────┼──────────────────┼──────────────────┐
 │              ▼                  ▼                  ▼                  │
 │   ┌──────────────────────┐ ┌───────────────┐ ┌────────────────────┐   │
 │   │  S3 / Object Storage │ │  Slack Feeds  │ │ Confluence / Wikis │   │
 │   │  (Files & Docs)      │ │  (Messaging)  │ │ (Structured Docs)  │   │
 │   └──────────────────────┘ └───────────────┘ └────────────────────┘   │
 │                                                                       │
 │                       EXTERNAL INGESTION SOURCES                      │
 └───────────────────────────────────────────────────────────────────────┘
```

### 2.1 External Systems Inventory

#### 1. PostgreSQL Database
- **Role:** Primary persistent storage and graph index substrate.
- **Why It Is Needed:** Provides ACID guarantees, structured relational storage for graph topology (entities and relations), document chunk storage, full-text search, and vector similarity indexing (via vector extensions).
- **How It Is Used:** Golem agents connect to PostgreSQL using Golem's host-provided RDBMS interface. All graph entities, relationship edges, metadata attributes, provenance records, and sync checkpoints are persisted here.

#### 2. S3-Compatible Object Storage (AWS S3, MinIO, Ceph, etc.)
- **Role:** Raw file and document repository.
- **Why It Is Needed:** Stores unstructured and semi-structured assets such as PDF reports, Markdown notes, text documentation, and data exports.
- **How It Is Used:** Agents connect over outbound HTTPS to discover new and modified objects, stream document contents, and track object versions via ETags and modification timestamps.

#### 3. Communication Platforms (Slack and Messaging Systems)
- **Role:** Dynamic communication and organizational conversation source.
- **Why It Is Needed:** Captures real-time organizational decisions, expert interactions, and informal documentation often absent from static wiki pages.
- **How It Is Used:** 
  - *Scheduled polling:* Ingests channel histories and threaded discussions.
  - *Event-driven webhooks:* Receives real-time push events from external messaging platforms.

#### 4. Enterprise Wikis & Collaboration Platforms (Confluence, Notion, etc.)
- **Role:** Curated internal knowledge and documentation source.
- **Why It Is Needed:** Contains authoritative articles, team spaces, specifications, architecture decision records, and structural hierarchies.
- **How It Is Used:** Communicates over outbound REST APIs to traverse space hierarchies, extract rich page content, and capture page versioning and author metadata.

#### 5. External AI & Embedding Providers (OpenAI, Anthropic, Ollama, etc.)
- **Role:** Semantic extraction, entity resolution assistance, and vector embedding generation.
- **Why It Is Needed:** Converts unstructured text into candidate entities, attributes, and relationships (Named Entity Recognition and Relation Extraction), and generates high-dimensional embeddings for semantic search.
- **How It Is Used:** Invoked over outbound HTTPS during document ingestion and at query time for semantic search translation.

---

## 3. Data Ingestion Architecture & Extensibility

The ingestion subsystem transforms raw data from heterogeneous external sources into structured graph representations.

```
 [External Source] ──► [Ingestor Connector] ──► [Document Chunking] ──► [Entity & Relation Extraction]
                                                                                   │
 [PostgreSQL Graph] ◄── [Atomic Persistence] ◄── [Entity Resolution & Fusion] ◄────┘
```

### 3.1 Extensible Connector Model

The ingestion engine is modular and extensible. Adding a new external source (such as Jira, GitHub, Google Drive, or custom internal systems) follows a standardized connector lifecycle without altering the core graph storage or query logic:

1. **Connector Configuration & Registration:**
   - Each connector defines its configuration requirements (endpoint URLs, authentication credentials, filters, and sync cadence).
   - Connectors register with a central coordinator agent that tracks their lifecycle and sync state.

2. **Item Discovery:**
   - Connectors query the external system to identify documents, messages, or files that were created or updated since the last recorded checkpoint.
   - Supports both incremental polling (via timestamps, change tokens, or version keys) and webhook reception for real-time sources.

3. **Content Extraction & Normalization:**
   - Fetches raw content and transforms source-specific schemas into a standardized intermediate document format containing text, origin metadata, author, and temporal stamps.

4. **Checkpoint Management:**
   - Connectors durably record their progress (e.g., cursor tokens, page offsets, last modification timestamps) so ingestion can safely resume after failures.

### 3.2 Built-In Ingestion Sources

- **File & Object Storage Connector:** Scans S3/bucket prefixes, detects additions/modifications using object metadata, reads text/markdown/PDF files, and extracts content streams.
- **Messaging Connector (Slack):** Synchronizes targeted channels, reconstructs conversation threads, tracks participants, and extracts conversational facts and topical discussions.
- **Wiki / Collaboration Connector (Confluence):** Recursively traverses spaces and page trees, extracts page content and comments, and preserves hierarchical structural relationships (`CHILD_OF`, `PART_OF`).

### 3.3 Ingestion Processing Stages

1. **Windowing & Chunking:** Segments large documents into overlapping semantic blocks while preserving source lineage and structural heading context.
2. **Knowledge Extraction:** Analyzes document chunks using language models or heuristic rule extractors to identify candidate entities (people, teams, technologies, concepts) and candidate relationships between them.
3. **Knowledge Fusion & Entity Resolution:**
   - Matches candidate entities against existing graph entities using alias matching, lexical similarity, and semantic similarity.
   - Merges duplicate mentions into canonical entities while retaining alternative names as aliases.
   - Consolidates relationship confidence and updates temporal validity windows.
4. **Graph Persistence:** Writes canonical entities, edges, text chunks, embeddings, and provenance links into PostgreSQL within transactional boundaries.

---

## 4. Knowledge Graph Data & Access Model

The system organizes knowledge into a **Labeled Property Graph** combined with vector embeddings and provenance records.

### 4.1 Data Modeling Principles

- **Entities (Nodes):** Represent discrete concepts, systems, persons, organizations, or documents. Each entity has a canonical identifier, primary type, canonical name, rich properties, and created/updated timestamps.
- **Entity Aliases:** Map alternative names, acronyms, handles, and source-specific identifiers back to a single canonical entity.
- **Relationships (Edges):** Directed semantic connections between two entities (e.g., `AUTHORED_BY`, `DEPENDS_ON`, `DISCUSSES`, `OWNS`). Edges carry semantic types, weights, confidence scores, and temporal validity intervals.
- **Text Chunks & Embeddings:** Retain the original textual excerpts from which entities and relationships were extracted, linked directly to entities for explainability and vector search.
- **Provenance & Lineage:** Every node, edge, and property maintains references to its source system, document URI, and extraction timestamp to guarantee auditability.

### 4.2 Query & Access Capabilities

The system provides high-level query and access capabilities to serve search interfaces, analytical tools, and autonomous AI agents:

1. **Entity Access & Search:**
   - Lookup entities by identifier, exact name, or alias.
   - Filter entities by semantic type and property criteria.
   - Autocomplete and fuzzy text matching on entity labels.

2. **Graph Traversal & Subgraph Exploration:**
   - Multi-hop neighborhood expansion starting from one or more seed entities.
   - Filtering traversals by relationship types, direction (inbound, outbound, bidirectional), minimum confidence, or property conditions.
   - Path-finding between entities (shortest path, weighted connections, common neighbors).

3. **Semantic & Hybrid Search:**
   - Vector similarity search over knowledge chunks using dense embeddings.
   - Lexical keyword search over entity names and document content using full-text search.
   - Hybrid retrieval combining vector and lexical rankings with reciprocal rank fusion.

4. **Graph-Augmented Generation (GraphRAG) Context Assembly:**
   - Given a natural language query, retrieves relevant entities, expands their immediate topological neighborhood, gathers grounding document chunks, and formats the combined context for consumption by LLM prompts.

5. **Ingestion & Connector Administration:**
   - Register, reconfigure, pause, or remove external source connectors.
   - Trigger on-demand synchronization runs for specific sources.
   - Inspect connector health, synchronization history, item counts, and error logs.
   - Webhook ingress to receive asynchronous push notifications from external services.

---

## 5. Agent Topology & Durable Orchestration

In Golem, long-running processes are expressed as stateful, durable agents that automatically recover their execution state across infrastructure restarts.

```
                   ┌──────────────────────────────────────┐
                   │     IngestionCoordinatorAgent        │
                   │  • Connector configuration registry  │
                   │  • Sync scheduling & status tracking │
                   └──────────────────┬───────────────────┘
                                      │ Dispatches / Monitors
                ┌─────────────────────┴─────────────────────┐
                ▼                                           ▼
 ┌─────────────────────────────┐             ┌─────────────────────────────┐
 │    IngestorTaskAgent        │             │    IngestorTaskAgent        │
 │  (e.g., S3 Sync Worker)     │             │  (e.g., Slack Sync Worker)  │
 │  • Incremental scan         │             │  • Webhook / Poll events    │
 │  • Resilient to rate limits │             │  • Resilient to rate limits │
 └─────────────────────────────┘             └─────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────────┐
 │                       KnowledgeAccessAgent                              │
 │  • Exposes high-level query and retrieval endpoints                     │
 │  • Executes graph traversals and search queries against PostgreSQL      │
 │  • Formats GraphRAG retrieval packages for AI agents                    │
 └─────────────────────────────────────────────────────────────────────────┘
```

1. **Ingestion Coordinator Agent:**
   - Functions as the central supervisor for all external ingestion activities.
   - Manages schedules for recurring sync jobs and maintains a registry of active connectors.
   - Spawns and supervises dedicated task agents for individual synchronization workloads.

2. **Ingestor Task Agents:**
   - Created for specific sync targets (e.g., a specific S3 bucket or Slack workspace).
   - Manages durable cursors and handles source-specific rate limits, pagination, and backoff.
   - Streams documents through the chunking, extraction, and resolution pipelines, persisting outcomes to PostgreSQL.

3. **Knowledge Access Agent:**
   - Exposes public query and management interfaces to clients and external callers.
   - Executes read-optimized graph traversals, hybrid search, and context assembly operations against PostgreSQL.

---

## 6. System Qualities & Operational Guarantees

- **Durable & Resilient Execution:** Long-running sync processes survive node failures, network timeouts, and platform restarts, resuming from their last recorded progress without re-ingesting entire repositories.
- **Idempotency:** All ingestion and entity resolution operations are replay-safe; re-running an ingestion job updates existing facts without introducing duplicate entities or relationships.
- **Traceability & Provenance:** Every fact in the graph can be traced directly back to its source document, author, and timestamp.
- **Extensibility:** New external data sources can be integrated by implementing the standard connector lifecycle without changing the graph storage or query layers.
- **Safe Secrets Handling:** External credentials (database connection strings, cloud storage keys, API tokens) are strictly encapsulated using redacted configurations and platform secret stores.
