# Feature Implementation Walkthrough: Modular Agent Pipeline Layers

- **Feature ID / Slug**: `modular-agent-pipeline-layers`
- **Date**: 2026-09-11
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

We refactored the monolithic `makeAgentPipelineLayer` in [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts) into modular, dedicated Effect layer factories tailored to each agent's specific operational needs.

Previously, all worker and access agents initialized the exact same mega-layer containing every service across the entire system. Consequently:
- `KnowledgeAccessAgent` was parsing S3 and Web target credentials and constructing unneeded HTTP connector services, extraction rules, and entity resolvers.
- `S3IngestorTaskAgent` was instantiating the Web connector and GraphRAG service.
- `WebIngestorTaskAgent` was instantiating the S3 connector and GraphRAG service.

With this refactoring:
- Each agent now receives a tailored layer factory containing only its required dependencies:
  - `makeAccessAgentLayer(config)`: `KnowledgeAccessAgent` (SqlClient, Repositories, EmbeddingService, GraphRAGService).
  - `makeS3TaskAgentLayer(config)`: `S3IngestorTaskAgent` (SqlClient, Repositories, EmbeddingService, S3ConnectorService, ExtractionService, EntityResolverService).
  - `makeWebTaskAgentLayer(config)`: `WebIngestorTaskAgent` (SqlClient, Repositories, EmbeddingService, WebConnectorService, ExtractionService, EntityResolverService).
  - `makeAgentPipelineLayer(config)`: Retained as a composite layer union for backwards compatibility and integration tests.
- All 127 automated tests pass (including new layer isolation and minimal dependency tests in `test/agents.test.ts`), with 0 type errors, 0 lint errors, clean formatting, and successful Golem WASM build.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                   | Summary of Changes                                                                                                                                                   |
| :--------- | :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                         | Decoupled `S3ResourcesConfig` and `WebResourcesConfig` service tags; preserved composite `ResourcesConfigValues`.                                                   |
| `[MODIFY]` | [`src/config/resources-config.ts`](../../src/config/resources-config.ts)     | Added `ToS3Values` and `ToWebValues` layers, and removed untyped `any` casts.                                                                                       |
| `[MODIFY]` | [`src/connectors/s3-connector.ts`](../../src/connectors/s3-connector.ts)     | Refactored `S3ConnectorService.Live` to depend exclusively on `S3ResourcesConfig`.                                                                                   |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts)   | Refactored `WebConnectorService.Live` to depend exclusively on `WebResourcesConfig`.                                                                                 |
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts) | Decomposed into modular builders (`makeStorageAndRepositoriesLayer`, `makeEmbeddingLayer`, `makeIngestionSemanticLayer`, `makeS3ConnectorLayer`, `makeWebConnectorLayer`, `makeGraphRAGLayer`) and exported dedicated agent layer factories. |
| `[MODIFY]` | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)             | Updated `KnowledgeAccessAgent` to instantiate `makeAccessAgentLayer(config)` instead of the monolithic layer.                                                       |
| `[MODIFY]` | [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts)           | Updated `S3IngestorTaskAgent` to instantiate `makeS3TaskAgentLayer(config)`.                                                                                         |
| `[MODIFY]` | [`src/agents/web-task-agent.ts`](../../src/agents/web-task-agent.ts)         | Updated `WebIngestorTaskAgent` to instantiate `makeWebTaskAgentLayer(config)`.                                                                                       |
| `[MODIFY]` | [`src/agents/index.ts`](../../src/agents/index.ts)                           | Exported `agent-pipeline-layer.js` and `web-task-agent.js`.                                                                                                          |
| `[MODIFY]` | [`test/agents.test.ts`](../../test/agents.test.ts)                           | Added unit tests verifying layer isolation and minimal dependency satisfaction for both access and ingestion agents.                                                  |

### Key Architecture & Logic Highlights

1. **Dedicated Agent Layer Factories**:
   - **`makeAccessAgentLayer(config)`**:
     ```typescript
     export const makeAccessAgentLayer = (config: AppAgentConfigService) =>
       Effect.gen(function* () {
         const { sqlLayer, reposLayer } = yield* makeStorageAndRepositoriesLayer(config);
         const embeddingLayer = yield* makeEmbeddingLayer(config);
         const graphRagLayer = makeGraphRAGLayer(reposLayer, embeddingLayer);
         return Layer.mergeAll(sqlLayer, reposLayer, embeddingLayer, graphRagLayer);
       });
     ```
   - **`makeS3TaskAgentLayer(config)`**:
     ```typescript
     export const makeS3TaskAgentLayer = (config: AppAgentConfigService) =>
       Effect.gen(function* () {
         const { sqlLayer, reposLayer } = yield* makeStorageAndRepositoriesLayer(config);
         const embeddingLayer = yield* makeEmbeddingLayer(config);
         const { extractionLayer, resolverLayer } = yield* makeIngestionSemanticLayer(config, reposLayer);
         const s3Layer = yield* makeS3ConnectorLayer(config);
         return Layer.mergeAll(sqlLayer, reposLayer, resolverLayer, embeddingLayer, s3Layer, extractionLayer);
       });
     ```
   - **`makeWebTaskAgentLayer(config)`**:
     ```typescript
     export const makeWebTaskAgentLayer = (config: AppAgentConfigService) =>
       Effect.gen(function* () {
         const { sqlLayer, reposLayer } = yield* makeStorageAndRepositoriesLayer(config);
         const embeddingLayer = yield* makeEmbeddingLayer(config);
         const { extractionLayer, resolverLayer } = yield* makeIngestionSemanticLayer(config, reposLayer);
         const webLayer = yield* makeWebConnectorLayer(config);
         return Layer.mergeAll(sqlLayer, reposLayer, resolverLayer, embeddingLayer, webLayer, extractionLayer);
       });
     ```

2. **Scoped Resource Extraction**:
   - `makeS3ConnectorLayer` parses only S3 resource targets.
   - `makeWebConnectorLayer` parses only Web resource targets.
   - `makeAccessAgentLayer` does not inspect or validate resource connector credentials at all.

---

## 3. Verification & Validation Results

### 3.1 Code Formatting

Command executed:
```bash
npm run format:check
```

**Result**:
```text
> format:check
> prettier --check src/ test/

Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking

Command executed:
```bash
npm run typecheck
```

**Result**:
```text
> typecheck
> tsc --noEmit

(Clean exit with code 0)
```

### 3.3 Linter Verification

Command executed:
```bash
npm run lint
```

**Result**:
```text
> lint
> eslint src/ test/

✖ 3 problems (0 errors, 3 warnings)
(Clean exit with code 0; zero errors across src/ and test/)
```

### 3.4 Golem Component Build

Command executed:
```bash
golem build --yes
```

**Result**:
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
  Selected components and layers:
    golem-kgs-effect:effect-main: effect, effect[optimized], golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
    Injecting JS module into QuickJS WASM ...
    Pre-initializing JS component into ...golem_kgs_effect_effect_main.preinitialized.wasm
Done! Input: 13137.8 KB, Output: 40108.8 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

### 3.5 Automated Test Suite Execution

Command executed:
```bash
npm test
```

**Result**:
```text
ℹ tests 127
ℹ suites 48
ℹ pass 127
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1525.043152
```

---

## 4. How to Run & Verify

1. **Run Unit Tests**:
   ```bash
   npm test
   ```
2. **Type Check**:
   ```bash
   npm run typecheck
   ```
3. **Build WASM Components**:
   ```bash
   npm run build
   ```

---

## 5. Sign-off / Next Steps

The modularization satisfies all requirements of the feature plan:
- Clean separation of agent layers according to the Principle of Least Privilege and Interface Segregation.
- Elimination of cross-service coupling during agent initialization.
- Full verification through test suites, type checking, and Golem WASM build.
