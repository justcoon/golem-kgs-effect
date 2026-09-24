# Implementation Walkthrough: Scoped Connector Configuration Rework

- **Feature ID / Slug**: `scoped-connector-config-rework`
- **Date**: 2026-09-24
- **Status**: Completed

---

## 1. Executive Summary

This feature eliminated artificial dictionary shims and factory getter boilerplate across the connector subsystem.

Previously, when creating scoped connector layers for single-source task agents (`S3IngestorTaskAgent({ resourceName })` and `WebIngestorTaskAgent({ resourceName })`), layer factories constructed synthetic 1-element maps (`{ [resourceName]: target }`) and dummy `getS3Resource`/`getWebResource` closures to satisfy legacy multi-tenant registries. Connector services then redundantly called `resourcesConfig.getS3Resource(targetOrName)` at runtime.

With this rework:

1. **Direct Scoped Injection**: `S3ResourceConfig` and `WebResourceConfig` service tags were added to [`src/config/schema.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts) representing a single, specific resource target.
2. **Connectors as Direct Services**:
   - `S3ConnectorService` extends `Context.Service<S3ConnectorService, S3ConnectorInstance>()`.
   - `WebConnectorService` extends `Context.Service<WebConnectorService, WebPageConnector>()`.
   - Ingestion pipelines directly yield the connector instance (`const connector = yield* S3ConnectorService;` / `const connector = yield* WebConnectorService;`).
3. **Clean Layer Factories**:
   - `makeS3ConnectorLayer` provides `Layer.succeed(S3ResourceConfig, target)` directly.
   - `makeWebConnectorLayer` provides `Layer.succeed(WebResourceConfig, target)` directly.
   - All synthetic dictionary mocks and redundant runtime getter lookups are eliminated.
4. **Documentation Alignment**:
   - [`blogpost.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/blogpost.md) was updated with the full technical deep-dive and updated code snippet.
   - [`README.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/README.md) is kept focused as an operational guide, with agent isolation covered at a clean, high level.

---

## 2. Changes Implemented

| File | Changes |
| :--- | :--- |
| [`src/config/schema.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts) | Exported `S3ResourceConfig` and `WebResourceConfig` service tags for single-target injection. |
| [`src/connectors/s3-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/s3-connector.ts) | Redefined `S3ConnectorService` as `S3ConnectorInstance`; `Live` layer yields `S3ResourceConfig` + `HttpClient` and returns `new S3Connector(...)`; updated `Mock` and `makeMock` helpers. |
| [`src/connectors/web-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/web-connector.ts) | Redefined `WebConnectorService` as `WebPageConnector`; `Live` layer yields `WebResourceConfig` + `HttpClient` and returns `yield* WebPageConnector.make(target, httpClient)`. |
| [`src/agents/connector-layers.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/connector-layers.ts) | Simplified `makeS3ConnectorLayer` and `makeWebConnectorLayer` to provide `S3ResourceConfig` and `WebResourceConfig` directly to `Live` layers with zero dummy dictionaries. |
| [`src/pipeline/s3-ingestion-pipeline.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/s3-ingestion-pipeline.ts) | Replaced `const s3Service = yield* S3ConnectorService; const connector = yield* s3Service.createConnector(...)` with `const connector = yield* S3ConnectorService;`. |
| [`src/pipeline/web-ingestion-pipeline.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/web-ingestion-pipeline.ts) | Replaced `const webService = yield* WebConnectorService; const connector = yield* webService.createConnector(...)` with `const connector = yield* WebConnectorService;`. |
| [`test/connectors.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/connectors.test.ts) | Updated unit tests to resolve `S3ConnectorService` directly as the connector instance. |
| [`test/agents.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/agents.test.ts) | Updated layer tests to assert connector instances directly from `S3ConnectorService` and `WebConnectorService`. |
| [`blogpost.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/blogpost.md) | Updated Section 3.1 and Code Snippet 2 to showcase clean `S3ResourceConfig` layer injection and direct 1-line pipeline consumption. |

---

## 3. Validation Results

### 1. Code Formatting (`npm run format:check`)

```bash
> format:check
> prettier --check src/ test/

Checking formatting...
All matched files use Prettier code style!
```

### 2. Type Checking (`npm run typecheck`)

```bash
> typecheck
> tsc --noEmit
# Exit code 0 - Zero TypeScript compiler errors
```

### 3. Linter (`npm run lint`)

```bash
> lint
> eslint src/ test/
# Exit code 0 - Zero lint warnings or errors
```

### 4. Automated Unit & Integration Tests (`npm test`)

```bash
ℹ tests 143
ℹ suites 49
ℹ pass 143
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2877.970677
```

All 143 automated tests across 49 test suites passed with 0 failures.

### 5. Golem WASM Component Build (`npm run build`)

```bash
> build
> golem build --yes

Selecting components
  Found components: golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    created golem-temp/ts-dist/golem-kgs-effect-effect-main/main.js in 7.3s
    Injecting JS module into QuickJS WASM
    Pre-initializing JS component into WASM
Writing pre-initialized component to golem-temp/agents/golem_kgs_effect_effect_main.preinitialized.wasm...
Done! Input: 13663.0 KB, Output: 48308.7 KB
Finished building [OK]
```

### 6. End-to-End Test Suite (`./run_e2e_test.sh`)

```bash
▶ Golem KGS Full End-to-End (E2E) Test Suite
  ✔ Suite 1: Gateway Connectivity & Agent Initialization
  ✔ Suite 2: S3 Ingestion, Storage Persistence & Checkpointing
  ✔ Suite 3: Task Agent Ingestion & Document Retrieval
  ✔ Suite 4: Multi-Modal Search (Hybrid, Vector & Keyword)
  ✔ Suite 5: Knowledge Graph Traversal & Entity Exploration
  ✔ Suite 6: GraphRAG Context Retrieval & Answer Synthesis
  ✔ Suite 7: Model Context Protocol (MCP) Streamable HTTP Invocations
✔ Golem KGS Full End-to-End (E2E) Test Suite (27574.243017ms)
ℹ tests 21
ℹ suites 8
ℹ pass 21
ℹ fail 0
[SUCCESS] All E2E test suites passed!
```

### 7. Deployment to Local Golem Server (`./deploy.sh`)

```bash
Applying changes to the staging area
  Updating component golem-kgs-effect:effect-main
    Created component revision: golem-kgs-effect:effect-main 1
Deploying staged changes to the environment
Deployed all changes
[SUCCESS] Deployment completed successfully!
Your KGS API is now available at: http://localhost:9006
```

---

## 4. Verification & Usage Guide

To verify the updated connectors in action:

1. **Run Unit Tests**:
   ```bash
   npm test
   ```
2. **Inspect S3 Connector Resolution**:
   In `src/pipeline/s3-ingestion-pipeline.ts`:
   ```typescript
   const connector = yield * S3ConnectorService;
   // connector is directly S3ConnectorInstance with target credentials scoped to this resource
   ```
3. **Trigger Ingestion via HTTP Gateway**:
   ```bash
   curl -X POST http://localhost:9006/api/ingestion/s3/main/sync
   ```
4. **Inspect Sync Status**:
   ```bash
   curl -s http://localhost:9006/api/ingestion/s3/main/status
   ```
