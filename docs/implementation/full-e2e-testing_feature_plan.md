# Feature Implementation Plan: Full End-to-End (E2E) Testing with Clean Containerized Environment

Comprehensive end-to-end testing suite and automated orchestration harness for Golem KGS (Knowledge Graph System). This plan creates a **dedicated, isolated, and completely containerized environment** including PostgreSQL, RustFS S3, seed fixtures, and a **containerized Golem server** via `Dockerfile.golem-server` and `docker-compose.e2e.yml`, configured through `.env.e2e`.

## 1. Overview & Goals

The user requested:
- A clean, isolated environment for E2E tests
- Dedicated `docker-compose.e2e.yml`
- Dedicated `.env.e2e` environment configuration
- **`GOLEM_VERSION` parameterized in `.env.e2e`**: Default `1.5.10`, passed to `Dockerfile.golem-server` as a build argument
- **Containerized Golem server**: Run Golem server inside Docker alongside PostgreSQL and RustFS, eliminating background process management on the host
- **`LLM_USE_FOR_ASK=false` for initial performance**: Fast deterministic GraphRAG synthesis without heavy CPU inference delays

### Key Design Principles:
1. **100% Containerized Infrastructure**:
   - `postgres-e2e`: Port `5433:5432`, `golem_kg_e2e` database, applies `./migrations`
   - `rustfs-e2e`: Port `9010:9000`, fresh S3 storage
   - `rustfs-setup-e2e`: Initializes bucket `golem-documents` and seeds fixture files from `tests/fixtures/s3/`
   - `golem-server-e2e`: Multi-arch (`aarch64`/`x86_64`) container built with `GOLEM_VERSION` from `.env.e2e`, exposing Router on `9882`, HTTP on `9016`, and MCP on `9017`
   - Connects to Ollama on port `11434` for embeddings via `host.docker.internal`
2. **Zero Contamination**: Dev database (port 5432), dev S3 (port 9000), and dev Golem server (port 9881/9006) are never touched.
3. **Explicit E2E Configuration (`.env.e2e`)**:
   - Centralizes all E2E connection strings, test ports, credentials, `GOLEM_VERSION`, and settings.
   - Sourced by `docker-compose.e2e.yml`, `run_e2e_test.sh`, and the TypeScript test runner.
4. **Clean Slate & Zero-Leak Teardown**:
   - `docker compose -f docker-compose.e2e.yml --env-file .env.e2e up -d --wait` brings up all services with healthchecks.
   - `docker compose -f docker-compose.e2e.yml --env-file .env.e2e down -v` cleanly wipes all test containers and ephemeral volumes.
5. **Full Verification Across All 5 Core Capabilities**:
   - Ingestion: S3 streaming + Checkpointing + Event-driven Webhook + Web crawl status
   - PostgreSQL persistence: Documents, Chunks, Embeddings, Entities, and Edges
   - Multi-Modal Search: Hybrid (RRF), Vector, and Keyword search
   - Graph Exploration: Degree hubs, entity lookup, multi-hop neighborhood traversal, entity-document back-references
   - GraphRAG Synthesis: Context retrieval, citations, grounded entities/relationships, and answer response

---

## 2. Architecture & Design

### Fully Containerized E2E Topology

```
                  ┌──────────────────────────────────────────────────┐
                  │                 .env.e2e                         │
                  │   GOLEM_VERSION=1.5.10                           │
                  │   LLM_USE_FOR_ASK=false                          │
                  │   Central test configuration & port assignments  │
                  └─────────────────────────┬────────────────────────┘
                                            │
                  ┌─────────────────────────▼────────────────────────┐
                  │              run_e2e_test.sh                     │
                  │   1. docker compose -f docker-compose.e2e.yml    │
                  │      --env-file .env.e2e up -d --wait            │
                  │   2. golem build --yes                           │
                  │   3. golem -E test deploy                        │
                  │   4. tsx --test test/e2e/full-pipeline.e2e.test.ts│
                  │   5. TRAP EXIT: down -v                          │
                  └─────────────────────────┬────────────────────────┘
                                            │
         ┌──────────────────────────────────┴──────────────────────────────────┐
         │              Docker Network: golem-kg-e2e-network                   │
         │                                                                     │
         │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
         │  │ Postgres (E2E)   │  │  RustFS S3 (E2E) │  │  Golem Server    │  │
         │  │ Port 5433->5432  │  │  Port 9010->9000 │  │  (Container)     │  │
         │  │ Fresh Migrations │  │  Clean Fixtures  │  │  (v1.5.10 build) │  │
         │  │ golem_kg_e2e     │  │  golem-documents │  │  9882->9881 (R)  │  │
         │  └──────────────────┘  └──────────────────┘  │  9016->9006 (H)  │  │
         │                                              └─────────┬────────┘  │
         └────────────────────────────────────────────────────────┼────────────┘
                                                                  │
                                            ┌─────────────────────┴────────────┐
                                            ▼ host.docker.internal:11434       │
                                     ┌──────────────┐                          │
                                     │    Ollama    │                          │
                                     │ (Embeddings) │                          │
                                     └──────────────┘                          │
                                                                               │
                                     ┌─────────────────────────────────────────▼┐
                                     │          E2E Test Runner Client          │
                                     │          (test/e2e/e2e-client.ts)        │
                                     │          Targeting http://localhost:9016 │
                                     └──────────────────────────────────────────┘
```

---

## 3. File-by-File Changes

### Infrastructure & Manifest

#### [NEW] [Dockerfile.golem-server](file:///Users/coon/workspace-zv/git/golem-kgs-effect/Dockerfile.golem-server)
- Debian Bookworm-based lightweight container.
- `ARG GOLEM_VERSION=1.5.10`.
- Multi-arch support: automatically downloads the official release binary for `aarch64-unknown-linux-gnu` (Apple Silicon) or `x86_64-unknown-linux-gnu` (Linux/Intel).
- Exposes ports `9881` (Router), `9006` (HTTP API), `9007` (MCP).
- Healthcheck via `curl -f http://127.0.0.1:9881/healthcheck`.

#### [NEW] [.env.e2e](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.e2e)
Dedicated environment file for E2E testing containing:
- `GOLEM_VERSION=1.5.10`
- `POSTGRES_PORT=5433`
- `POSTGRES_DB=golem_kg_e2e`
- `POSTGRES_USER=golem_user`
- `POSTGRES_PASSWORD=golem_password`
- `DB_URL=postgresql://golem_user:golem_password@127.0.0.1:5433/golem_kg_e2e`
- `S3_PORT=9010`
- `S3_ENDPOINT_URL=http://127.0.0.1:9010`
- `AWS_ACCESS_KEY_ID=rustfsadmin`
- `AWS_SECRET_ACCESS_KEY=rustfsadmin123`
- `AWS_DEFAULT_REGION=us-east-1`
- `AWS_S3_BUCKET=golem-documents`
- `OLLAMA_PORT=11434`
- `EMBEDDING_MODEL=nomic-embed-text`
- `LLM_MODEL=qwen2.5:1.5b`
- `LLM_USE_FOR_ASK=false`
- `GOLEM_TEST_ROUTER_PORT=9882`
- `GOLEM_TEST_CUSTOM_PORT=9016`
- `GOLEM_TEST_MCP_PORT=9017`

#### [NEW] [.env.e2e.example](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.e2e.example)
- Tracked example template matching `.env.e2e`.

#### [NEW] [docker-compose.e2e.yml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/docker-compose.e2e.yml)
- Clean Docker Compose file defining:
  - `postgres-e2e`: Port `${POSTGRES_PORT:-5433}:5432`, `${POSTGRES_DB:-golem_kg_e2e}` database, fresh volume, runs `./migrations`.
  - `rustfs-e2e`: Port `${S3_PORT:-9010}:9000`, fresh volume for S3 storage.
  - `rustfs-setup-e2e`: CLI container that creates bucket `${AWS_S3_BUCKET:-golem-documents}` and seeds it with controlled test documents from `tests/fixtures/s3/`.
  - `golem-server-e2e`: Container built from `Dockerfile.golem-server` with `args: { GOLEM_VERSION: ${GOLEM_VERSION:-1.5.10} }`, mapped ports `9882:9881`, `9016:9006`, `9017:9007`, healthy check on `http://127.0.0.1:9881/healthcheck`.
  - `extra_hosts`: maps `host.docker.internal:host-gateway` to connect to host Ollama.

#### [NEW] [tests/fixtures/s3/](file:///Users/coon/workspace-zv/git/golem-kgs-effect/tests/fixtures/s3/)
- Curated fixture markdown/text documents for reproducible E2E tests:
  - `golem_cloud_architecture.md`: Text about Golem Cloud, durable execution, WebAssembly, and Effect.
  - `graph_database_principles.md`: Text about knowledge graphs, entities, and relationships.

#### [MODIFY] [golem.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml)
- Add `test` environment targeting `server.url: "http://localhost:{{ GOLEM_TEST_ROUTER_PORT:-9882 }}"`.
- Configure `componentPresets.test` pointing to:
  - DB host `{{ POSTGRES_HOST:-postgres-e2e }}`, port `{{ POSTGRES_PORT:-5432 }}`, db `{{ POSTGRES_DB:-golem_kg_e2e }}`.
  - S3 endpoint `{{ S3_ENDPOINT_URL:-http://rustfs-e2e:9000 }}`.
  - Ollama on `{{ EMBEDDING_API_BASE:-http://host.docker.internal:11434/v1 }}`.
- Configure `secretDefaults.test` setting `llm.useForAsk: "{{ LLM_USE_FOR_ASK:-false }}"`.
- Add `httpApi.deployments.test` binding to domain `localhost:{{ GOLEM_TEST_CUSTOM_PORT:-9016 }}`.

#### [MODIFY] [package.json](file:///Users/coon/workspace-zv/git/golem-kgs-effect/package.json)
- Add `"test:e2e": "tsx --test test/e2e/full-pipeline.e2e.test.ts"` script.

### E2E Test Suite
#### [NEW] [test/e2e/e2e-client.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/e2e/e2e-client.ts)
- Type-safe HTTP client targeting the Golem test gateway (`http://localhost:9016`), supporting all agent endpoints:
  - S3/Web sync triggers, status polling, and webhook ingestion.
  - Hybrid/vector/keyword search.
  - Entity search, top hubs, neighborhood graph exploration, document lookup.
  - GraphRAG bundle retrieval and `/ask` question answering.

#### [NEW] [test/e2e/full-pipeline.e2e.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/e2e/full-pipeline.e2e.test.ts)
- Comprehensive test scenarios executing on the clean environment:
  - **Suite 1: Clean Environment & Pre-Flight**:
    - Asserts DB tables are freshly migrated and empty initially.
    - Asserts S3 test bucket contains fixture documents.
    - Asserts Golem agent gateway is responsive on port 9016.
  - **Suite 2: S3 Ingestion & Checkpointing**:
    - Triggers S3 sync, polls status until `status === "IDLE"`.
    - Verifies documents, chunks, entities, and edges are populated in PostgreSQL.
    - Triggers second sync, verifies incremental checkpoint skips unchanged files.
  - **Suite 3: Event-Driven Webhook Ingestion**:
    - Sends `POST /api/coordinator/webhook/s3/main` with dynamic new content.
    - Verifies immediate indexing and availability for search.
  - **Suite 4: Search Modes**:
    - Hybrid search (RRF score ranking).
    - Vector search (semantic similarity).
    - Keyword search (full-text search).
  - **Suite 5: Knowledge Graph Traversal**:
    - Top hubs by degree.
    - Fuzzy/alias entity search.
    - Multi-hop neighborhood traversal (verifying nodes and edges with confidence scores).
    - Document back-references.
  - **Suite 6: GraphRAG Synthesis (`LLM_USE_FOR_ASK=false`)**:
    - Multi-hop context retrieval.
    - Deterministic fast synthesis via `synthesizeAnswerText`.
    - Validates grounded citations, grounded entities, grounded relationships, and confidence score.

### Execution Script
#### [NEW] [run_e2e_test.sh](file:///Users/coon/workspace-zv/git/golem-kgs-effect/run_e2e_test.sh)
- Executable bash script managing the full lifecycle:
  1. Loads `.env.e2e`.
  2. Starts all E2E services (Postgres, RustFS, Fixtures, Golem Server): `docker compose -f docker-compose.e2e.yml --env-file .env.e2e up -d --wait`.
  3. Builds WASM: `golem build --yes`.
  4. Deploys to containerized test server: `golem -E test deploy`.
  5. Executes `npm run test:e2e`.
  6. Traps `EXIT/INT/TERM` to run `docker compose -f docker-compose.e2e.yml --env-file .env.e2e down -v`.

---

## 4. Verification Plan

```bash
# 1. Typecheck and linting
npm run typecheck
npm run lint

# 2. Existing unit/integration tests
npm test

# 3. WASM Build
npm run build

# 4. Clean E2E Test Execution
./run_e2e_test.sh
```
