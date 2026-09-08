# Feature Plan: Phase 3 - Base Connector Framework & S3 Ingestion

- **Feature ID / Slug**: `phase-3-connectors-s3-ingestion`
- **Date**: 2026-09-06
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Following the completion and approval of Phase 1 (Foundations & Storage Substrate) and Phase 2 (Processing Pipeline & Semantic Services), **Phase 3** delivers the **Base Connector Framework and S3 Ingestion Subsystem**. This phase enables the system to discover, fetch, and incrementally ingest documents from external storage systems—specifically S3-compatible object stores (such as RustFS and AWS S3)—converting external files into canonical `RawDocument` instances ready for the Phase 2 chunking and knowledge extraction pipeline.

### Goals

1. **Dynamic Multi-Resource S3 Configuration & Secrets**:
   - Define `secretDefaults.local.resources.s3` in [`golem.yaml`](../../golem.yaml) supporting dynamic, named S3 resource targets (`main`, `legal`, `technical`, `archive`, or custom identifiers), each with `endpoint`, `region`, `bucket`, `accessKeyId`, and `secretAccessKey`.
   - Define `S3ResourceTargetSchema` and `ResourcesConfigFields` in [`src/config/schema.ts`](../../src/config/schema.ts) using `Schema.Record` and `Schema.Redacted`.
   - Implement `ResourcesConfig` in [`src/config/resources-config.ts`](../../src/config/resources-config.ts) using Golem `defineConfig`, with a `ToValues` layer resolving the dynamic resource mapping into `ResourcesConfigValues`.
2. **Base Connector Lifecycle Contract (`src/connectors/connector-base.ts`)**:
   - Establish a generic, type-safe `SourceConnector<Config, Cursor, Item>` contract with standardized lifecycle operations:
     - `connect`: Validate connectivity and credentials.
     - `discover`: Incrementally query external objects created or modified since the last recorded cursor.
     - `fetch`: Retrieve payload content for discovered items.
     - `normalize`: Convert raw items into canonical `RawDocument` and `ProvenanceRecord` representations.
     - `checkpoint`: Produce updated `SaveCheckpointInput` for state persistence.
   - Define standardized tagged error types (`ConnectorError`).
3. **S3 / RustFS Document Connector (`src/connectors/s3-connector.ts`)**:
   - Implement an S3-compatible connector targeting RustFS and AWS S3.
   - Implement S3 REST API interactions via Effect 4 `effect/unstable/http` (`HttpClient`):
     - `ListObjectsV2`: Bucket prefix listing with continuation tokens and max-keys pagination.
     - `GetObject`: Streaming/buffered content retrieval.
   - Implement AWS Signature Version 4 (SigV4) header generation using `node:crypto` (available in the Golem QuickJS runtime), supporting custom endpoints, regions, and path-style or virtual-hosted requests.
   - Implement lightweight XML parsing for S3 `ListBucketResult` responses.
   - Filter supported text extensions (`.md`, `.txt`, `.json`, `.csv`, `.html`, `.xml`).
   - Maintain durable incremental cursors (`lastModified` timestamp and set of processed `ETag`s).
   - Implement both `Live` and host-independent `Mock` layers for comprehensive offline testing.
4. **Connector Barrel Export (`src/connectors/index.ts`)**:
   - Expose base contracts, schemas, and S3 connector implementations.
5. **Comprehensive Testing Suite (`test/connectors.test.ts`)**:
   - Verify SigV4 header calculation against standard AWS test vectors or deterministic inputs.
   - Verify S3 XML response decoding (keys, sizes, ETags, timestamps, prefixes).
   - Verify incremental cursor advancement, ensuring unchanged files with identical ETags are skipped.
   - Verify `RawDocument` normalization, content extraction, and provenance metadata formatting.

### Non-Goals

- Durable agent supervision, cron timers, and autonomous coordination (Phase 4).
- GraphRAG retrieval and hybrid search engine (Phase 5).
- HTTP gateway REST endpoints and mounts (Phase 6).

---

## 2. Architecture & Technical Design

### 2.1 Connector Ingestion Architecture

```
 ┌────────────────────────────────────────────────────────┐
 │            External Source (RustFS / AWS S3)           │
 └───────────────────────────┬────────────────────────────┘
                             │
                  S3 REST API (SigV4 Auth)
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │           S3Connector (src/connectors/s3-connector.ts) │
 │  1. ListObjectsV2(prefix, continuationToken)           │
 │  2. Filter by Cursor (skip known ETags / older dates)  │
 │  3. GetObject(key) -> content, metadata                │
 │  4. Normalize -> RawDocument + ProvenanceRecord        │
 └───────────────────────────┬────────────────────────────┘
                             │
                  Emit Canonical Documents
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │            Downstream Processing & Storage             │
 │  • DocumentRepository.saveDocument (PostgreSQL)        │
 │  • CheckpointRepository.saveCheckpoint (Cursor state)  │
 │  • Phase 2 Pipeline (Chunker -> Embedding -> Resolver) │
 └────────────────────────────────────────────────────────┘
```

### 2.2 Dynamic Multi-Resource Configuration in `golem.yaml`

To provide first-class support for multiple, dynamically-added S3 resources (e.g. `main`, `legal`, `technical`, `archive-docs`, or external AWS buckets), all S3 endpoint, bucket, and credential definitions are organized under `secretDefaults.local.resources.s3`:

```yaml
secretDefaults:
  local:
    db:
      user: "{{ POSTGRES_USER }}"
      password: "{{ POSTGRES_PASSWORD }}"
    embedding:
      apiKey: "{{ EMBEDDING_API_KEY }}"
    resources:
      s3:
        main:
          endpoint: "{{ S3_ENDPOINT_URL }}"
          region: "{{ AWS_DEFAULT_REGION }}"
          bucket: "golem-documents"
          accessKeyId: "{{ AWS_ACCESS_KEY_ID }}"
          secretAccessKey: "{{ AWS_SECRET_ACCESS_KEY }}"
        legal:
          endpoint: "{{ S3_ENDPOINT_URL }}"
          region: "{{ AWS_DEFAULT_REGION }}"
          bucket: "legal-docs"
          accessKeyId: "{{ AWS_ACCESS_KEY_ID }}"
          secretAccessKey: "{{ AWS_SECRET_ACCESS_KEY }}"
        technical:
          endpoint: "{{ S3_ENDPOINT_URL }}"
          region: "{{ AWS_DEFAULT_REGION }}"
          bucket: "technical-docs"
          accessKeyId: "{{ AWS_ACCESS_KEY_ID }}"
          secretAccessKey: "{{ AWS_SECRET_ACCESS_KEY }}"
        # Additional resources (resource4, resourceN...) can be dynamically added
```

#### Typed Schema Model:
```typescript
export const S3ResourceTargetSchema = Schema.Struct({
  endpoint: Schema.String,
  region: Schema.String,
  bucket: Schema.String,
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
});
export type S3ResourceTarget = typeof S3ResourceTargetSchema.Type;

export const ResourcesSecretSchema = Schema.Struct({
  s3: Schema.Record(Schema.String, S3ResourceTargetSchema),
});

export const ResourcesConfigFields = {
  resources: Schema.Redacted(ResourcesSecretSchema),
};
```
This enables:
- **Dynamic Resource Registrations**: Zero code changes to add new S3 targets; the schema accepts any named record under `resources.s3`.
- **Decoupled Service Resolution**: Connectors and agents can target a specific resource name (e.g. `s3Connector.forResource("legal")` or `new S3Connector(target)`).
- **Security & Redaction**: The entire multi-resource credentials structure remains wrapped inside `Redacted` at the Golem host boundary.

### 2.3 Incremental Cursor Model

The S3 cursor data stored in `SyncCheckpoint.cursorData` is structured as:
```typescript
interface S3CursorData {
  readonly lastSyncTimestamp: string; // ISO 8601
  readonly processedKeys: Record<string, string>; // key -> ETag mapping
  readonly continuationToken?: string;
}
```
During each synchronization execution:
1. `discover` lists bucket contents under the configured prefix.
2. For each object returned:
   - If `lastModified <= lastSyncTimestamp` and `processedKeys[key] === eTag`, the object has not changed and is skipped.
   - If the object is new or has a different `eTag`, it is flagged for ingestion.
3. Upon fetching and processing, the cursor is updated with the new `ETag` and maximum `lastModified` timestamp.

---

## 3. Proposed File Changes

| Action     | File Path                                                                              | Purpose                                                                                        |
| :--------- | :------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                       | Add `secretDefaults.local.resources.s3` dynamic resource blocks                               |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                                   | Add `S3ResourceTargetSchema`, `ResourcesSecretSchema`, and `ResourcesConfigValues` Tag         |
| `[NEW]`    | [`src/config/resources-config.ts`](../../src/config/resources-config.ts)               | Golem `defineConfig` for dynamic multi-resource secrets and `ToValues` Layer                   |
| `[MODIFY]` | [`src/config/index.ts`](../../src/config/index.ts)                                     | Export `resources-config.js`                                                                   |
| `[NEW]`    | [`src/connectors/connector-base.ts`](../../src/connectors/connector-base.ts)           | Abstract connector contracts, lifecycle types, and `ConnectorError` definition                |
| `[NEW]`    | [`src/connectors/s3-signer.ts`](../../src/connectors/s3-signer.ts)                     | Pure AWS SigV4 signer and S3 XML parser utilities (host-independent)                          |
| `[NEW]`    | [`src/connectors/s3-connector.ts`](../../src/connectors/s3-connector.ts)               | S3 connector implementation, object discovery, fetching, normalization, and `Mock` layer     |
| `[NEW]`    | [`src/connectors/index.ts`](../../src/connectors/index.ts)                             | Barrel exports for connector abstractions and S3 implementations                              |
| `[NEW]`    | [`test/connectors.test.ts`](../../test/connectors.test.ts)                             | Unit tests for SigV4 signing, XML parsing, S3 connector discovery, cursor tracking, and mocks |

---

## 4. Verification Plan

### 4.1 Automated Tooling & Quality Gates

The strict 5-stage validation pipeline will be executed:
1. **Formatting**: `npm run format:check` (Prettier on `src/` and `test/`)
2. **Linting**: `npm run lint` (ESLint on `src/` and `test/`)
3. **Type Checking**: `npm run typecheck` (`tsc --noEmit` with `strict: true`)
4. **Unit Tests**: `npm test` (`tsx --test`) covering connector contracts, S3 XML parsing, SigV4 signatures, cursor persistence, and mock data ingestion.
5. **Golem Build**: `npm run build` (`golem build --yes`) confirming the WebAssembly component compiles and pre-initializes cleanly.

### 4.2 Walkthrough & Review

Upon successful verification:
- Create `docs/implementation/phase-3-connectors-s3-ingestion_implementation_walkthrough.md`.
- Mark this feature plan as `Completed`.
- Present walkthrough and results for user review and approval.
