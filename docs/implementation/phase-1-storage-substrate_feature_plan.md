# Feature Plan: Phase 1 - Foundations & Storage Substrate

- **Feature ID / Slug**: `phase-1-storage-substrate`
- **Date**: 2026-09-06
- **Status**: Completed

---

## 1. Overview & Goals

Phase 1 establishes the foundational data layer and storage substrate for the **Knowledge Graph System (KGS)** as defined in [plan.md](../../plan.md#L500-L507) and [spec.md](../../spec.md).

The goal of Phase 1 is to provide:

1. **Database Schema & Migrations:** Complete relational and vector storage schemas in PostgreSQL with `pgvector` for entities, aliases, edges (relationships), text chunks with 768-dimensional embeddings, entity-chunk mentions, and sync checkpoints.
2. **Core Domain Models:** Strongly typed Effect schemas (`Schema.Struct`, etc.) modeling entities, relationships, document chunks, provenance records, search/traversal queries, and connector configuration/state.
3. **Golem Database Client Layer:** A host-backed PostgreSQL client layer utilizing `@golemcloud/effect-golem/postgres` and Effect's canonical `SqlClient.SqlClient` service, with typed connection configuration and transaction helpers.
4. **Storage Repository Layer:** Idiomatic Effect repositories encapsulating queries, upserts, topological graph traversal queries, vector similarity search (`<=>`), full-text search, and checkpoint management.

### Goals

- Fully define and script PostgreSQL migrations compatible with Dockerized `pgvector/pgvector:pg18-trixie` (mounted in `./migrations`).
- Define portable domain schemas in `src/domain/` with comprehensive validation using `effect/Schema`.
- Implement `src/config/` for database and app configuration using Golem's `defineConfig` and redacted secrets.
- Implement repositories in `src/storage/` consuming `SqlClient.SqlClient` for:
  - `EntityRepository`: CRUD, batch upsert, lookup by alias, and lexical search.
  - `GraphRepository`: Directed edge upsert, neighborhood queries, and adjacency traversal.
  - `ChunkRepository`: Chunk persistence, cosine vector similarity search, and full-text search.
  - `CheckpointRepository`: Connector cursor and sync state management.
- Ensure all code compiles cleanly with `npx tsc --noEmit` and bundles via `golem build --yes`.

### Non-Goals

- Phase 2 chunking/embedding pipeline logic (deferred to Phase 2).
- S3 connector implementation (deferred to Phase 3).
- Golem agent implementations (`IngestorTaskAgent`, `IngestionCoordinatorAgent`, `KnowledgeAccessAgent`) (deferred to Phase 4 & 6).

---

## 2. Architecture & Technical Design

### 2.1 Database Architecture & Complete DDL Schema

The database substrate uses PostgreSQL with `pgvector` and `pg_trgm` (migrated in `migrations/`):

#### 1. `documents` (Raw documents from connectors)

```sql
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    tags TEXT[] DEFAULT '{}',
    source VARCHAR(100) NOT NULL,
    namespace VARCHAR(100) NOT NULL DEFAULT 'default',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_namespace ON documents(namespace);
```

#### 2. `entities` (Canonical graph nodes)

```sql
CREATE TABLE IF NOT EXISTS entities (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    description TEXT,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_properties ON entities USING gin(properties);
CREATE INDEX IF NOT EXISTS idx_entities_fts ON entities USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));
```

#### 3. `entity_aliases` (Alternative labels & acronyms mapped to canonical entities)

```sql
CREATE TABLE IF NOT EXISTS entity_aliases (
    alias VARCHAR(255) NOT NULL,
    entity_id VARCHAR(255) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    source VARCHAR(100) NOT NULL DEFAULT 'extracted',
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (alias, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias ON entity_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity_id ON entity_aliases(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_trgm ON entity_aliases USING gin(alias gin_trgm_ops);
```

#### 4. `edges` (Directed graph relationships & triples)

```sql
CREATE TABLE IF NOT EXISTS edges (
    id VARCHAR(255) PRIMARY KEY,
    source_id VARCHAR(255) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id VARCHAR(255) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation_type VARCHAR(100) NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    confidence REAL NOT NULL DEFAULT 1.0,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edge_source_target_relation UNIQUE (source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_edges_properties ON edges USING gin(properties);
```

#### 5. `chunks` (Document chunks & 768-dim dense embeddings)

```sql
CREATE TABLE IF NOT EXISTS chunks (
    id VARCHAR(255) PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding vector(768),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunks_document_chunk_index UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING gin(to_tsvector('english', content));
```

#### 6. `entity_chunks` (Provenance mapping between entities and grounding chunks)

```sql
CREATE TABLE IF NOT EXISTS entity_chunks (
    entity_id VARCHAR(255) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    chunk_id VARCHAR(255) NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    mention_text VARCHAR(255),
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_chunks_chunk ON entity_chunks(chunk_id);
```

#### 7. `sync_checkpoints` (Connector cursor & ingestion checkpoint state)

```sql
CREATE TABLE IF NOT EXISTS sync_checkpoints (
    connector_id VARCHAR(255) PRIMARY KEY,
    cursor_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_sync_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(50) NOT NULL DEFAULT 'IDLE',
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.2 Effect Service Architecture & Decoupled Configuration

Following `@golemcloud/effect-golem/postgres` best practices:

- **Decoupled Configuration & Secrets in `golem.yaml`**:
  - Non-sensitive parameters under `config.db` using template interpolation:
    ```yaml
    config:
      db:
        host: "{{ POSTGRES_HOST }}"
        db: "{{ POSTGRES_DB }}"
        port: "{{ POSTGRES_PORT }}"
    ```
  - Sensitive credentials under `secretDefaults.local.db` using template interpolation:
    ```yaml
    secretDefaults:
      local:
        db:
          user: "{{ POSTGRES_USER }}"
          password: "{{ POSTGRES_PASSWORD }}"
    ```
  - Allows seamless environment substitution from `.env` or CI, while separating public network coordinates from credentials.
- **Typed `DatabaseConfig`**:
  Declared via Golem SDK `defineConfig` with structured fields:
  ```typescript
  export class DatabaseConfig extends defineConfig("Database.Config", {
    db: Schema.Struct({
      host: Schema.String,
      db: Schema.String,
      port: Schema.Union(Schema.String, Schema.Number),
      user: Schema.Redacted(Schema.String),
      password: Schema.Redacted(Schema.String),
    }),
  }) {}
  ```
  Host, database, and port are evaluated as regular config Effects; user and password are evaluated via `.get` yielding `Redacted.Redacted<string>`.
- **`DatabaseClient` / `PostgresLive`**:
  Constructs the PostgreSQL URI securely from `DatabaseConfig` and provides the canonical `SqlClient.SqlClient` using `PgClient.layer({ connectionAddress })`.
- **Repositories**: Modeled as Effect services (`Context.Tag`) consuming `SqlClient.SqlClient`, enabling straightforward dependency injection, unit testing, and mockability.
- **Transactions**: Encapsulated using `sql.withTransaction` for atomic multi-table commits.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                                    | Description                                                                              |
| :--------- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`migrations/001_initial_schema.sql`](../../migrations/001_initial_schema.sql)               | Ensure base extensions (`vector`, `pg_trgm`) are enabled                                 |
| `[NEW]`    | [`migrations/002_graph_tables.sql`](../../migrations/002_graph_tables.sql)                   | DDL for `entities`, `entity_aliases`, and `edges` with indexes                           |
| `[NEW]`    | [`migrations/003_chunks_and_embeddings.sql`](../../migrations/003_chunks_and_embeddings.sql) | DDL for `chunks`, `entity_chunks`, HNSW index, full-text indexes                         |
| `[NEW]`    | [`migrations/004_sync_checkpoints.sql`](../../migrations/004_sync_checkpoints.sql)           | DDL for connector cursor tracking & sync checkpoints                                     |
| `[NEW]`    | [`src/domain/entity.ts`](../../src/domain/entity.ts)                                         | Effect Schemas for `Entity`, `EntityAlias`, `EntityType`, `EntityProperty`               |
| `[NEW]`    | [`src/domain/relationship.ts`](../../src/domain/relationship.ts)                             | Effect Schemas for `Edge`, `RelationType`, `EdgeDirection`                               |
| `[NEW]`    | [`src/domain/chunk.ts`](../../src/domain/chunk.ts)                                           | Effect Schemas for `DocumentChunk`, `ChunkMetadata`, `VectorEmbedding`                   |
| `[NEW]`    | [`src/domain/provenance.ts`](../../src/domain/provenance.ts)                                 | Effect Schemas for `ProvenanceRecord`, `SourceType`, `AuditLineage`                      |
| `[NEW]`    | [`src/domain/query.ts`](../../src/domain/query.ts)                                           | Effect Schemas for Graph Traversal, Vector Search, Hybrid Search parameters              |
| `[NEW]`    | [`src/domain/connector.ts`](../../src/domain/connector.ts)                                   | Effect Schemas for `ConnectorConfig`, `ConnectorState`, `SyncCheckpoint`                 |
| `[NEW]`    | [`src/config/app-config.ts`](../../src/config/app-config.ts)                                 | General application configuration schema                                                 |
| `[NEW]`    | [`src/config/database-config.ts`](../../src/config/database-config.ts)                       | Typed Golem `defineConfig` for PostgreSQL connection string                              |
| `[NEW]`    | [`src/storage/database-client.ts`](../../src/storage/database-client.ts)                     | PostgreSQL client layer using `PgClient` providing `SqlClient.SqlClient`                 |
| `[NEW]`    | [`src/storage/entity-repository.ts`](../../src/storage/entity-repository.ts)                 | `EntityRepository` service for entity & alias queries and upserts                        |
| `[NEW]`    | [`src/storage/graph-repository.ts`](../../src/storage/graph-repository.ts)                   | `GraphRepository` service for edge management and neighborhood traversal                 |
| `[NEW]`    | [`src/storage/chunk-repository.ts`](../../src/storage/chunk-repository.ts)                   | `ChunkRepository` service for text chunks, pgvector search, and full-text search         |
| `[NEW]`    | [`src/storage/checkpoint-repository.ts`](../../src/storage/checkpoint-repository.ts)         | `CheckpointRepository` service for connector sync checkpoints                            |
| `[MODIFY]` | [`package.json`](../../package.json)                                                         | Add test / typecheck scripts (e.g., `"build"`, `"typecheck"`, `"test"`)                  |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                             | Add decoupled `config.db` and `secretDefaults.local.db` with host template interpolation |
| `[NEW]`    | [`test/domain-schemas.test.ts`](../../test/domain-schemas.test.ts)                           | Unit tests verifying domain schema encode/decode and validation                          |

---

## 4. Verification Plan

### Automated Checks

1. **Code Formatting**:
   ```bash
   npm run format:check   # npx prettier --check src/ test/
   ```
   Verify all source and test files conform to repository formatting standards.
2. **Type Checking**:
   ```bash
   npm run typecheck      # npx tsc --noEmit
   ```
   Must pass with 0 errors in strict mode.
3. **Linter Verification**:
   ```bash
   npm run lint           # npx eslint src/ test/
   ```
   Zero errors and zero warnings across source and test files.
4. **Golem Component Build**:
   ```bash
   npm run build          # golem build --yes
   ```
   Must build all WASM components cleanly into `golem-temp/agents/`.
5. **Automated Unit Tests**:
   ```bash
   npm test               # npx tsx --test
   ```
   Execute automated tests verifying Effect Schema decoding, validation of entities, edges, chunks, and query objects.

### Manual / Sanity Verification

- Verify SQL migrations syntax and ensure tables/indexes match the schemas required for Phase 2-5 pipelines.
- Verify `PgClient` layer wiring and that all repository layers compile against `SqlClient.SqlClient`.

---

## 5. Risks & Open Questions

- **Dependencies**: `package.json` does not currently have `node_modules` installed. Running `npm install` will be part of the implementation.
- **WASM Constraints**: All database operations must strictly utilize `@golemcloud/effect-golem/postgres` and `SqlClient.SqlClient` rather than native Node drivers (`pg`, `mysql2`), preserving full compatibility with the QuickJS WASM environment.
