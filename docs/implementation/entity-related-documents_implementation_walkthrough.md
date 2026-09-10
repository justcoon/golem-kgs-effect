# Feature Implementation Walkthrough: Entity Related Documents

- **Feature ID / Slug**: `entity-related-documents`
- **Date**: 2026-09-10
- **Status**: Ready for Review

---

## 1. Executive Summary

We have implemented end-to-end support for listing, exploring, and navigating all related documents for any entity in the Knowledge Graph. Previously, `EntityDrawer.vue` displayed only a single initial document (`extractedFromDoc`) loaded from the first chunk extraction.

With this feature:
1. Canonical entities now link to **every** document they are mentioned in across both S3 and Web ingestion sources via the `entity_chunks` relational junction table.
2. `EntityRepository` executes a single optimized PostgreSQL query selecting lightweight `DocumentSummary` records (excluding heavy `content` and `metadata` blobs).
3. `KnowledgeAccessAgent` exposes `GET /api/knowledge/entities/{id}/documents` (`getEntityDocuments`).
4. `EntityDrawer.vue` renders an interactive **Related Documents** list (`📚 Related Documents (N)`) with origin tags, source badges, direct `DocumentModal` previewing, and live web page navigation (`🌐 Visit Page ↗`).

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                    | Summary of Changes                                                                                                                   |
| :--------- | :--------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/domain/provenance.ts`](../../src/domain/provenance.ts)                 | Added `DocumentSummary` domain interface and schema.                                                                                 |
| `[MODIFY]` | [`src/agents/types.ts`](../../src/agents/types.ts)                           | Added `DocumentSummarySchema` for typed agent and HTTP gateway contracts.                                                            |
| `[MODIFY]` | [`src/storage/repository-tags.ts`](../../src/storage/repository-tags.ts)     | Added `getRelatedDocuments` method signature to `EntityRepositoryShape`.                                                             |
| `[MODIFY]` | [`src/storage/entity-repository.ts`](../../src/storage/entity-repository.ts) | Implemented `getRelatedDocuments(entityId, limit)` using a single unified SQL query with lightweight column projections.             |
| `[MODIFY]` | [`src/pipeline/entity-resolver.ts`](../../src/pipeline/entity-resolver.ts)   | Maintained `documents: string[]` in entity properties during resolution and deduplication.                                           |
| `[MODIFY]` | [`src/pipeline/web-ingestion-pipeline.ts`](../../src/pipeline/web-ingestion-pipeline.ts) | Populated `entity_chunks` via `chunkRepo.linkEntityChunk` during web page extraction.                                                |
| `[MODIFY]` | [`src/pipeline/s3-ingestion-pipeline.ts`](../../src/pipeline/s3-ingestion-pipeline.ts)   | Populated `entity_chunks` via `chunkRepo.linkEntityChunk` during S3 document extraction.                                             |
| `[MODIFY]` | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)             | Added `getEntityDocuments` method to `KnowledgeAccessAgent` mapped to `GET /entities/{id}/documents`.                                |
| `[MODIFY]` | [`test/http-gateway.test.ts`](../../test/http-gateway.test.ts)               | Added route matching and schema validation tests for `DocumentSummarySchema` and `/api/knowledge/entities/{id}/documents`.          |
| `[MODIFY]` | [`test/agents.test.ts`](../../test/agents.test.ts)                           | Added missing mock methods (`linkEntityChunk`, `getRelatedDocuments`) to mock repositories.                                          |
| `[MODIFY]` | [`test/graphrag.test.ts`](../../test/graphrag.test.ts)                       | Added `getRelatedDocuments` to mock entity repository.                                                                               |
| `[MODIFY]` | [`frontend/src/types/api.ts`](../../frontend/src/types/api.ts)               | Added `DocumentSummary` interface.                                                                                                   |
| `[MODIFY]` | [`frontend/src/services/api.ts`](../../frontend/src/services/api.ts)         | Added `getEntityDocuments(entityId)` to `ApiService`.                                                                                |
| `[MODIFY]` | [`frontend/src/components/EntityDrawer.vue`](../../frontend/src/components/EntityDrawer.vue) | Replaced single source-doc card with interactive Related Documents list with count badge, origin tags, previewing, and external links.|

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
```bash
npm run format:check
```
**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking
```bash
npm run typecheck
```
**Result**:
```text
> tsc --noEmit
# Exited with code 0 (zero compiler errors)
```

### 3.3 Linter Verification
```bash
npm run lint
```
**Result**:
```text
> eslint src/ test/
✖ 4 problems (0 errors, 4 warnings) # only pre-existing any casts
# Exited with code 0
```

### 3.4 Automated Test Suite
```bash
npm test
```
**Result**:
```text
ℹ tests 118
ℹ suites 46
ℹ pass 118
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1486.50589
```

### 3.5 Frontend Build
```bash
npm --prefix frontend run build
```
**Result**:
```text
vite v8.0.0 building client environment for production...
transforming...✓ 34 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.78 kB │ gzip:  0.43 kB
dist/assets/index-C1n83OTb.css   38.25 kB │ gzip:  7.03 kB
dist/assets/index-AGTznFm3.js   147.61 kB │ gzip: 50.02 kB
✓ built in 461ms
```

### 3.6 Golem Build & Deployment Planning
```bash
npm run build && eval $(grep -v '^#' .env | grep -v '^$' | sed 's/^/export /') && golem deploy --plan --yes
```
**Result**:
```text
Pre-initializing component (init_func=wizer-initialize)...
Done! Input: 12653.1 KB, Output: 36876.3 KB
Finished building [OK]

Preparing deployment
  Extracting golem-kgs-effect:effect-main agent types from golem_kgs_effect_effect_main.wasm
  Diffing:
    + getEntityDocuments:
    +   signature: 'getEntityDocuments(id: string) -> { id: string; title: string; source: string; resourceName: string; sourceKey: string; sizeBytes: number; createdAt: string; updatedAt: string; }[]'
    +   description: Retrieves summary list of all documents associated with an entity
    +   http:
    +   - method: GET
    +     path: /entities/{id}/documents

Summary 
  Finished planning [OK]
```

---

## 4. How to Run & Verify

1. **Deploying the Application**:
   ```bash
   ./deploy.sh
   # or
   eval $(grep -v '^#' .env | grep -v '^$' | sed 's/^/export /') && golem deploy
   ```

2. **Invoking the New Method via HTTP**:
   ```bash
   curl -s http://localhost:9006/api/knowledge/entities/ent_concept_golem_cloud/documents | jq .
   ```

3. **Frontend UI**:
   - Start the frontend:
     ```bash
     npm --prefix frontend run dev
     ```
   - In the graph or search view, click on any entity node.
   - The drawer opens with the **Related Documents** section:
     - Document count badge (`📚 Related Documents (N)`).
     - Each document item shows:
       - Source badge (`🌐 WEB` or `📄 S3`).
       - `Origin` badge if it matches the initial discovery document.
       - Direct `👁️ Preview` button opening `DocumentModal`.
       - For web documents, a `🌐 Visit Page ↗` button opening the live URL in a new browser tab.
