# Implementation Walkthrough: Document UUID and Resource Isolation

## Executive Summary

This feature replaces string-concatenated document IDs (`doc_s3_<bucket>_<key>`) with **deterministic RFC 4122 UUIDs (UUID v5)** and establishes **source**, **resource name** (`resource_name`), and **source key** (`source_key`) as first-class, indexed relational columns in PostgreSQL. 

This change completely eliminates document, chunk, and graph provenance collisions when multiple resources share identical bucket names or document file paths across different S3 endpoints, and enables sub-millisecond document lookups by resource coordinates without JSONB parsing.

---

## Changes Implemented

### 1. Deterministic UUID Generator
- **[`src/utils/uuid.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/utils/uuid.ts)**:
  - Implemented `generateDocumentUuid(source, resourceName, sourceKey)` using RFC 4122 UUID v5 over SHA-1 and a fixed KGS application namespace UUID (`b2e37985-78e7-4402-9954-47b4d1b329fb`).
  - Added `isValidUuid(id)` helper with RFC 4122 regex validation.

### 2. Domain & Schemas
- **[`src/domain/provenance.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/provenance.ts)**:
  - Updated `RawDocument` schema to replace `namespace: Schema.String` with `resourceName: Schema.String` and added `sourceKey: Schema.String`.
- **[`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts)**:
  - Updated `DocumentResultSchema` to include `resourceName` and `sourceKey`.

### 3. Database Schema & Storage
- **[`migrations/002_graph_tables.sql`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/migrations/002_graph_tables.sql)**:
  - Replaced column `namespace` with `resource_name VARCHAR(100) NOT NULL DEFAULT 'default'`.
  - Added column `source_key VARCHAR(1024) NOT NULL DEFAULT ''`.
  - Added unique constraint: `CONSTRAINT uq_documents_source_resource_key UNIQUE (source, resource_name, source_key)`.
  - Added indexes: `idx_documents_resource_name` and `idx_documents_source_resource_key`.
- **[`src/storage/repository-tags.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/repository-tags.ts)**:
  - Added `findByResourceKey(source, resourceName, sourceKey)` to `DocumentRepositoryShape`.
  - Updated `listDocuments` options to support `resourceName?: string`.
- **[`src/storage/document-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/document-repository.ts)**:
  - Updated `DocumentRow` and `mapDocumentRow` to map `resource_name` <-> `resourceName` and `source_key` <-> `sourceKey`.
  - Updated `saveDocument` to insert and update `resource_name` and `source_key`.
  - Implemented `findByResourceKey(source, resourceName, sourceKey)` for fast indexed B-tree point lookups.
  - Updated `listDocuments` filter to check `resource_name`.
- **[`src/storage/chunk-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/chunk-repository.ts)**:
  - Aligned document row mapping and `saveRawDocument` with `resource_name` and `source_key`.

### 4. Connectors & Ingestion Pipeline
- **[`src/connectors/s3-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/s3-connector.ts)**:
  - In `fetch(item)` and `Mock`: generates UUID v5 via `generateDocumentUuid("s3", resourceName, item.id)`.
  - Populates `resourceName` and `sourceKey` on `RawDocument`.
  - Cleaned `metadata` to only store file-level attributes (`bucket`, `eTag`, `sizeBytes`, `lastModified`), intentionally stripping infrastructure details (`endpoint`, `region`).
- **[`src/pipeline/chunker.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/chunker.ts)**:
  - Propagates `resourceName` and `sourceKey` into chunk metadata.
- **[`src/agents/access-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts)**:
  - Updated `getDocument` endpoint mapping to return `resourceName` and `sourceKey`.

### 5. Test Suite
- **[`test/connectors.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/connectors.test.ts)**:
  - Verified document ID is a valid RFC 4122 UUID matching `generateDocumentUuid`.
  - Verified metadata omits `endpoint` and `region`.
  - Added new test: verified multi-resource isolation and determinism across two separate resources ingesting identical file paths.
- **[`test/domain-schemas.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/domain-schemas.test.ts)**:
  - Added comprehensive test suite for `generateDocumentUuid` (validity, determinism, resource isolation, source isolation, key isolation).
- **[`test/pipeline.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/pipeline.test.ts)** & **[`test/agents.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/agents.test.ts)**:
  - Updated fixtures to use `resourceName` and `sourceKey`.
  - Added `findByResourceKey` mock implementation to `mockDocRepo`.

---

## Validation Results

### 1. Code Formatting
```bash
npm run format:check
```
**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 2. Type Checking
```bash
npm run typecheck
```
**Result**:
```text
> typecheck
> tsc --noEmit
# 0 errors
```

### 3. Linter Verification
```bash
npm run lint
```
**Result**:
```text
> lint
> eslint src/ test/
# 0 errors (2 pre-existing any warnings in config/agents layer)
```

### 4. Automated Tests
```bash
npm test
```
**Result**:
```text
ℹ tests 105
ℹ suites 41
ℹ pass 105
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1098.599607
```

### 5. Golem WASM Component Build
```bash
npm run build
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
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
Done! Input: 12617.6 KB, Output: 36332.5 KB
Adding metadata to components
Finished building [OK]
```

---

## Verification & Usage Guide

### 1. Querying a Document by Resource & Key
To look up a document without parsing JSONB:
```typescript
import { DocumentRepository } from "./src/storage/document-repository.js";

const doc = yield* docRepo.findByResourceKey("s3", "main", "general/overview.md");
if (Option.isSome(doc)) {
  console.log("Found document ID:", doc.value.id); // e.g. "a40f8087-0b1e-5a08-a53d-d30777b732da"
  console.log("Metadata:", doc.value.metadata);   // { bucket: "...", eTag: "...", sizeBytes: ... }
}
```

### 2. SQL Point Lookup
```sql
SELECT id, source, resource_name, source_key, title, size_bytes, metadata
FROM documents
WHERE source = 's3' 
  AND resource_name = 'main' 
  AND source_key = 'general/overview.md';
```
This hits `idx_documents_source_resource_key` instantly.

### 3. S3 Ingestion Task Agent Mount Path
The S3 ingestion worker HTTP mount path is:
```text
/api/ingestion/s3/{resourceName}/*
```
Examples:
- `POST /api/ingestion/s3/main/sync`
- `GET /api/ingestion/s3/main/status`
- `POST /api/ingestion/s3/main/reset`
- `POST /api/ingestion/s3/main/batch-callback`

