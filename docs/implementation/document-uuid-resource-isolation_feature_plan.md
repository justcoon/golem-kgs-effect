# Feature Implementation Plan: Document UUID and Resource Isolation

## Executive Summary

Currently, `S3Connector` constructs document IDs via basic string concatenation (`doc_s3_${target.bucket}_${safeKeyId}`) and sets `namespace` to the bucket name. When multiple configured resources share the same bucket name across different S3 endpoints or accounts, or when files share identical sanitized paths, document IDs collide. This causes documents, chunks, and embeddings to overwrite each other during ingestion and corrupts knowledge graph provenance.

This feature establishes **deterministic UUIDs (UUID v5)** for document identity and promotes **source**, **resource name** (`resource_name`), and **source key** (`source_key`) to first-class relational columns in PostgreSQL, completely eliminating collisions while enabling instant B-tree lookups for any document by its source, resource, and key.

---

## User Review Required

> [!IMPORTANT]
> - **Schema Migration**: `migrations/002_graph_tables.sql` is updated to replace `namespace` with `resource_name VARCHAR(100) NOT NULL DEFAULT 'default'`, add `source_key VARCHAR(1024) NOT NULL DEFAULT ''`, and add `CONSTRAINT uq_documents_source_resource_key UNIQUE (source, resource_name, source_key)`.
> - **Domain Model (`RawDocument`)**: `RawDocument` replaces `namespace: Schema.String` with `resourceName: Schema.String` (strictly bound to the configured resource name, e.g. `"main"`, `"legal"` from `golem.yaml`) and adds `sourceKey: Schema.String`.
> - **Deterministic UUID v5**: Document IDs change from `doc_s3_<bucket>_<key>` strings to standard 36-character UUID strings derived deterministically from `${source}:${resourceName}:${sourceKey}`.

---

## Architecture & Design

### 1. Deterministic UUID Generation (`src/utils/uuid.ts`)

A zero-dependency, RFC 4122 compliant UUID v5 generator implemented via `node:crypto`:
```typescript
export function generateDocumentUuid(source: string, resourceName: string, sourceKey: string): string
```
- **Formula**: Deterministic SHA-1 hash of an application namespace UUID + `${source}:${resourceName}:${sourceKey}`.
- **Idempotency**: Ingesting the same file for the same resource always produces the exact same UUID.
- **Complete Isolation**: If two different sources (e.g. `s3` and `git`) or two resources (e.g. `"main"` and `"legal"`) ingest `docs/guide.pdf`, their UUIDs are completely distinct.

### 2. Relational Schema Enhancement (`migrations/002_graph_tables.sql`)

```sql
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,                 -- UUID v5
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    tags TEXT[] DEFAULT '{}',
    source VARCHAR(100) NOT NULL,               -- e.g. 's3'
    resource_name VARCHAR(100) NOT NULL DEFAULT 'default', -- Resource name e.g. 'main'
    source_key VARCHAR(1024) NOT NULL DEFAULT '', -- e.g. 'general/overview.md'
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_documents_source_resource_key UNIQUE (source, resource_name, source_key)
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_resource_name ON documents(resource_name);
CREATE INDEX IF NOT EXISTS idx_documents_source_resource_key ON documents(source, resource_name, source_key);
```

### 3. Repository Layer (`src/storage/document-repository.ts` & `repository-tags.ts`)

- `DocumentRepository` and `ChunkRepository` map `resource_name` <-> `resourceName` and `source_key` <-> `sourceKey`.
- Add `findByResourceKey(source: string, resourceName: string, sourceKey: string): Effect.Effect<Option.Option<RawDocument>, SqlError>` to `DocumentRepository` for sub-millisecond point lookups without JSONB traversal.
- Update `listDocuments({ source?: string, resourceName?: string, limit?: number, offset?: number })`.

### 4. S3 Connector Ingestion (`src/connectors/s3-connector.ts`)

- In `fetch(item)`:
  - `id`: `generateDocumentUuid("s3", target.name, item.id)`
  - `source`: `"s3"`
  - `resourceName`: `target.name` (resource name from `golem.yaml`)
  - `sourceKey`: `item.id` (e.g. `"general/architecture.md"`)
  - `metadata`: contains only content-level attributes (`bucket`, `eTag`, `sizeBytes`, `lastModified`). Infrastructure details (`endpoint`, `region`) are intentionally omitted.
- In `Mock` implementation:
  - Supports resource name isolation and generates deterministic UUIDs with `sourceKey` and clean metadata.

### 5. Concrete Document Record Examples

#### Scenario Setup (from `golem.yaml`)
```yaml
resources:
  s3:
    - name: "main"
      endpoint: "https://s3.us-east-1.amazonaws.com"
      region: "us-east-1"
      bucket: "golem-documents"
      prefixes:
        - "general/"
```
Ingested file:
- **Source**: `"s3"`
- **Resource**: `"main"`
- **Item Key (`sourceKey`)**: `"general/overview.md"`
- **Derived UUID v5 (`id`)**: `generateDocumentUuid("s3", "main", "general/overview.md")` -> `"a40f8087-0b1e-5a08-a53d-d30777b732da"`

#### A. In-Memory TypeScript Domain Model (`RawDocument`)
```typescript
const document: RawDocument = {
  id: "a40f8087-0b1e-5a08-a53d-d30777b732da",
  title: "Knowledge System Overview",
  content: "# Knowledge System Overview\n\nArchitecture specification...",
  source: "s3",
  resourceName: "main",              // Unique resource name from golem.yaml
  sourceKey: "general/overview.md",  // Key within resource
  sizeBytes: 1842,
  tags: ["s3", "main", "md"],
  metadata: {
    bucket: "golem-documents",
    eTag: "\"0123456789abcdef\"",
    sizeBytes: 1842,
    lastModified: "2026-09-08T10:00:00.000Z",
  },
  createdAt: new Date("2026-09-08T10:00:00.000Z"),
  updatedAt: new Date("2026-09-08T13:54:00.000Z"),
};
```

#### B. PostgreSQL Database Row (`documents` table)
```sql
SELECT id, source, resource_name, source_key, title, size_bytes, metadata 
FROM documents 
WHERE source = 's3' AND resource_name = 'main' AND source_key = 'general/overview.md';
```

| Column | Example Value | Description |
|---|---|---|
| `id` | `'a40f8087-0b1e-5a08-a53d-d30777b732da'` | Primary Key (UUID v5, 36 chars) |
| `source` | `'s3'` | Connector source type |
| `resource_name` | `'main'` | Unique resource name from `golem.yaml` |
| `source_key` | `'general/overview.md'` | File path within resource (`UNIQUE(source, resource_name, source_key)`) |
| `title` | `'Knowledge System Overview'` | Extracted document title |
| `content` | `'# Knowledge System Overview\n\nArchitecture specification...'` | Full document text |
| `metadata` | `'{"bucket":"golem-documents","eTag":"\"0123456789abcdef\"","lastModified":"2026-09-08T10:00:00.000Z","sizeBytes":1842}'::jsonb` | Ancillary file metadata (endpoint/region excluded) |
| `tags` | `ARRAY['s3', 'main', 'md']` | Queryable tags |
| `size_bytes` | `1842` | Byte size |
| `created_at` | `'2026-09-08 10:00:00.000+00'` | S3 object lastModified |
| `updated_at` | `'2026-09-08 13:54:00.000+00'` | Ingestion timestamp |

#### C. Multi-Resource Isolation Comparison (No Collision)
Suppose two resources use the same bucket name and both contain `general/overview.md`:
- **Resource `"main"`**:
  - `id`: `"a40f8087-0b1e-5a08-a53d-d30777b732da"`
  - `source`: `"s3"`
  - `resourceName`: `"main"`
  - `sourceKey`: `"general/overview.md"`
- **Resource `"legal"`**:
  - `id`: `"6f2c3d80-87b4-5390-939e-272e5055b85a"`
  - `source`: `"s3"`
  - `resourceName`: `"legal"`
  - `sourceKey`: `"general/overview.md"`

Both records comfortably coexist in the same table, with independent chunk vectors and independent knowledge graph provenance.

---

## Proposed Changes

### Domain & Schemas
#### [NEW] [`src/utils/uuid.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/utils/uuid.ts)
- Pure TypeScript RFC 4122 UUID v5 generator using `node:crypto`.
- `generateDocumentUuid(source: string, resourceName: string, sourceKey: string): string` and `isValidUuid(id: string): boolean`.

#### [MODIFY] [`src/domain/provenance.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/domain/provenance.ts)
- Update `RawDocument` schema: replace `namespace` with `resourceName: Schema.String`, add `sourceKey: Schema.String`.

---

### Database & Storage
#### [MODIFY] [`migrations/002_graph_tables.sql`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/migrations/002_graph_tables.sql)
- Replace `namespace` column with `resource_name VARCHAR(100) NOT NULL DEFAULT 'default'`.
- Add `source_key VARCHAR(1024) NOT NULL DEFAULT ''`.
- Add `CONSTRAINT uq_documents_source_resource_key UNIQUE (source, resource_name, source_key)`.
- Replace index `idx_documents_namespace` with `idx_documents_resource_name`.
- Add index `idx_documents_source_resource_key`.

#### [MODIFY] [`src/storage/repository-tags.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/repository-tags.ts)
- Extend `DocumentRepository` interface with `findByResourceKey(source: string, resourceName: string, sourceKey: string)`.
- Update `listDocuments` options to use `resourceName?: string`.

#### [MODIFY] [`src/storage/document-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/document-repository.ts)
- Map `resource_name` <-> `resourceName` and `source_key` <-> `sourceKey` in `DocumentRow` and `mapDocumentRow`.
- Include `resource_name` and `source_key` in `INSERT INTO documents` and `ON CONFLICT (id) DO UPDATE`.
- Implement `findByResourceKey(source, resourceName, sourceKey)`.
- Update `listDocuments` filter to check `resource_name`.

#### [MODIFY] [`src/storage/chunk-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/chunk-repository.ts)
- Align document row mapping and `saveRawDocument` with `resource_name` and `source_key`.

---

### Ingestion Connectors
#### [MODIFY] [`src/connectors/s3-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/s3-connector.ts)
- Import `generateDocumentUuid`.
- Set `id: generateDocumentUuid(target.name, item.id)`.
- Set `namespace: target.name`.
- Set `sourceKey: item.id`.
- Mirror the same changes in `S3ConnectorService.Mock`.

---

### Tests
#### [MODIFY] [`test/connectors.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/connectors.test.ts)
- Verify `document.id` is a valid UUID.
- Verify deterministic reproduction: identical resource + key produces identical UUID.
- Verify resource isolation: two resources with same bucket and key produce different UUIDs and namespaces.
- Verify `document.sourceKey` matches the item key.

#### [MODIFY] [`test/domain-schemas.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/domain-schemas.test.ts)
- Update `RawDocument` fixtures with `sourceKey`.

#### [MODIFY] [`test/pipeline.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/pipeline.test.ts)
- Update `rawDoc` test fixtures with `sourceKey`.

---

## Verification Plan

### Automated Tests
1. **Formatting**:
   ```bash
   npm run format:check
   ```
2. **Type Checking**:
   ```bash
   npm run typecheck
   ```
3. **Linting**:
   ```bash
   npm run lint
   ```
4. **Unit & Integration Tests**:
   ```bash
   npm test
   ```
5. **Component WASM Build**:
   ```bash
   npm run build
   ```
