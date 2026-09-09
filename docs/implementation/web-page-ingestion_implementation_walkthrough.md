# Feature Implementation Walkthrough: Web / Documentation Page Ingestion Connector & Agent

- **Feature ID / Slug**: `web-page-ingestion`
- **Date**: 2026-09-09
- **Status**: Ready for Review

---

## 1. Executive Summary

We have successfully implemented the **Web / Documentation Page Ingestion Connector and Durable Agent** (`WebIngestorTaskAgent`) for `golem-kgs-effect`. This satisfies the requirements outlined in [`docs/implementation/web-page-ingestion_feature_plan.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/docs/implementation/web-page-ingestion_feature_plan.md) and Section 8.1 of [`plan.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/plan.md).

The subsystem allows ingesting public websites and documentation sites (such as `learn.golem.cloud`) using Golem's native outbound HTTP without requiring cloud or AWS credentials. Key highlights:
- Pure TypeScript HTML cleaning, entity decoding, metadata extraction, and sitemap XML parsing without native binary or C dependencies (compatible with QuickJS WASM).
- Reuses battle-tested primitives from [`golem-web-crawler-effect/src/fetcher-agent.ts`](https://github.com/justcoon/golem-web-crawler-effect/blob/main/src/fetcher-agent.ts) (including 5-hop redirect following and header forwarding).
- Zero new database migrations: leverages existing `documents.metadata` (`JSONB`) and `sync_checkpoints.cursor_data` (`JSONB`).
- Fully integrated with `IngestionCoordinatorAgent` (`sourceType === "web"`) and exposed via Golem Native HTTP Gateway at `/api/ingestion/web/{resourceName}`.

---

## 2. Changes Implemented

### File Modifications

| Action | File Path | Summary of Changes |
| :--- | :--- | :--- |
| `[NEW]` | [`src/connectors/web-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/web-connector.ts) | Pure-TS HTML text extraction, sitemap XML parsing, redirect following (max 5 hops), URL filtering (`includePatterns`/`excludePatterns`), and `WebPageConnector` implementing `SourceConnector`. |
| `[NEW]` | [`src/pipeline/web-ingestion-pipeline.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/web-ingestion-pipeline.ts) | Pipeline orchestrator coordinating chunking, embeddings, entity/relationship extraction, document persistence, and checkpoint updates. |
| `[NEW]` | [`src/agents/web-task-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/web-task-agent.ts) | Durable Golem agent mounted at `/api/ingestion/web/{resourceName}` with `sync`, `getStatus`, and `resetCursor` methods. |
| `[NEW]` | [`test/web-connector.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/web-connector.test.ts) | Unit tests verifying XML sitemap parsing, HTML tag stripping, URL filtering, SHA-256 digests, and Schema decoding. |
| `[MODIFY]` | [`src/config/schema.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts) | Added `WebResourceTargetSchema` and added `web` to `ResourcesSecretSchema` and `ResourcesConfigShape`. |
| `[MODIFY]` | [`src/config/resources-config.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/resources-config.ts) | Added `webTargets` parsing and `getWebResource` helper method. |
| `[MODIFY]` | [`src/domain/provenance.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/provenance.ts) | Added `"web"` literal to domain `SourceType`. |
| `[MODIFY]` | [`src/connectors/connector-base.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/connector-base.ts) | Added `WebProcessedUrlEntry` and `WebCursorData` interfaces. |
| `[MODIFY]` | [`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts) | Added `WebTaskMetricsSchema`, `WebTaskStatusSchema`, `WebProcessedUrlEntrySchema`, `WebTaskStateSchema`, `WebTaskStatusResponseSchema`, and added `"web"` to `SourceTypeSchema`. |
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/agent-pipeline-layer.ts) | Wired `WebConnectorService.Live` and `webTargets` into the composite agent runtime layer. |
| `[MODIFY]` | [`src/agents/coordinator-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/coordinator-agent.ts) | Added `sourceType === "web"` routing to invoke `WebIngestorTaskAgent`. |
| `[MODIFY]` | [`src/main.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/main.ts) | Registered `./agents/web-task-agent.js` for runtime side-effects. |
| `[MODIFY]` | [`golem.yaml`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml) | Added sample `web` target in `secretDefaults.local.resources.web` and added `WebIngestorTaskAgent: {}` to HTTP deployments. |
| `[MODIFY]` | [`openapi.yaml`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/openapi.yaml) | Documented OpenAPI endpoints for `/api/ingestion/web/{resource-name}/sync`, `/status`, and `/reset`. |
| `[MODIFY]` | [`README.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/README.md) | Documented `WebIngestorTaskAgent` in agent architecture and endpoint overview table. |
| `[MODIFY]` | [`test/http-gateway.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/http-gateway.test.ts) | Added route matching tests for `/api/ingestion/web/{resourceName}/sync` and `/status`. |

---

## 3. Verification & Validation Results

### 3.1 Code Formatting

Command executed:
```bash
npm run format:check # prettier --check src/ test/
```

**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking

Command executed:
```bash
npm run typecheck # tsc --noEmit
```

**Result**:
```text
> typecheck
> tsc --noEmit
(Exit code 0, 0 type errors)
```

### 3.3 Linter Verification

Command executed:
```bash
npm run lint # eslint src/ test/
```

**Result**:
```text
> lint
> eslint src/ test/

✖ 0 errors, 4 warnings (existing any casts in secret config layer)
```

### 3.4 Golem Build

Command executed:
```bash
npm run build # golem build --yes
```

**Result**:
```text
> build
> golem build --yes

Selecting components
  Found components: golem-kgs-effect:effect-main
  Selected components and layers:
    golem-kgs-effect:effect-main: effect, effect[optimized], golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
    Writing pre-initialized component ...
Done! Input: 12644.4 KB, Output: 36906.9 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

### 3.5 Test Suite Execution

Command executed:
```bash
npm test # tsx --test
```

**Result**:
```text
ℹ tests 115
ℹ suites 46
ℹ pass 115
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1597.605667
```

All 115 tests passed across 46 suites, including comprehensive tests for:
- Standard XML sitemaps and nested sitemap index parsing.
- HTML tag stripping, navigation/script/style removal, and entity decoding.
- Relative URL resolution, anchor filtering, and pattern matching.
- SHA-256 content hashing.
- Effect schema decoding for Web configuration and task status responses.
- HTTP Gateway routing and manifest deployment configuration.

---

## 4. How to Run & Verify

### 4.1 Configuration Sample in `golem.yaml`

The local secret defaults now include a sample web target:

```yaml
secretDefaults:
  local:
    resources:
      web:
        - name: "golem-docs"
          baseUrl: "https://learn.golem.cloud"
          sitemapUrl: "https://learn.golem.cloud/sitemap.xml"
          includePatterns:
            - "^https://learn\\.golem\\.cloud/.*"
          excludePatterns:
            - "^https://learn\\.golem\\.cloud/api/.*"
```

### 4.2 CLI Verification

To test via Golem CLI once deployed to local server:

1. **Deploy component**:
   ```bash
   golem deploy
   ```

2. **Trigger Web Ingestion Sync directly**:
   ```bash
   golem agent invoke \
     --component golem-kgs-effect:effect-main \
     --agent 'WebIngestorTaskAgent("golem-docs")' \
     sync '{"force": false}'
   ```

3. **Query Ingestion Status**:
   ```bash
   golem agent invoke \
     --component golem-kgs-effect:effect-main \
     --agent 'WebIngestorTaskAgent("golem-docs")' \
     getStatus
   ```

4. **Trigger via Coordinator Agent**:
   ```bash
   golem agent invoke \
     --component golem-kgs-effect:effect-main \
     --agent 'IngestionCoordinatorAgent("primary")' \
     triggerSync '{"sourceType": "web", "resourceName": "golem-docs", "force": false}'
   ```

5. **Trigger via HTTP Endpoint**:
   ```bash
   curl -X POST http://localhost:9005/api/ingestion/web/golem-docs/sync \
     -H "Content-Type: application/json" \
     -d '{"force": false}'
   ```

---

## 5. Sign-off / Next Steps

- All validation checks (Prettier, ESLint, TypeScript, Golem WASM build, and test suite) are passing with 100% success.
- Ready for user sign-off and approval.
