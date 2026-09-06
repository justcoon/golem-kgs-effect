# Feature Implementation Walkthrough: Phase 3 - Base Connector Framework & S3 Ingestion

- **Feature ID / Slug**: `phase-3-connectors-s3-ingestion`
- **Date**: 2026-09-06
- **Status**: Approved <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

Phase 3 ("Base Connector Framework & S3 Ingestion") has been fully implemented in accordance with the approved feature plan. This phase establishes the extensible source connector framework, dynamic multi-resource configuration, and native S3-compatible document ingestion pipeline:

1. **Dynamic Multi-Resource S3 Configuration & Secrets**: All S3 endpoints, buckets, and credentials are consolidated under `secretDefaults.local.resources.s3` in [`golem.yaml`](../../golem.yaml) (`main`, `legal`, `technical`). Backed by typed Effect schemas (`S3ResourceTargetSchema`, `ResourcesSecretSchema`) in [`src/config/schema.ts`](../../src/config/schema.ts) and Golem `defineConfig` in [`src/config/resources-config.ts`](../../src/config/resources-config.ts), enabling dynamic addition of S3 targets without code modifications.
2. **Base Connector Lifecycle Contract**: Established generic `SourceConnector<Config, Cursor, Item>` in [`src/connectors/connector-base.ts`](../../src/connectors/connector-base.ts) with standardized lifecycle hooks (`connect`, `discover`, `fetch`, `normalize`, `checkpoint`) and typed `ConnectorError`.
3. **Pure SigV4 Signer & XML Parser**: Created host-independent AWS Signature Version 4 signer and S3 `ListBucketResult` XML parser in [`src/connectors/s3-signer.ts`](../../src/connectors/s3-signer.ts) using `node:crypto` HMAC-SHA256, compatible with RustFS/MinIO and AWS S3 without bloated external SDKs.
4. **S3 Document Connector**: Implemented [`S3Connector`](../../src/connectors/s3-connector.ts) powered by Effect 4 `effect/unstable/http` (`HttpClient`), featuring prefix-based object discovery, pagination, incremental cursor evaluation (skipping matching ETags), and transformation into canonical `RawDocument` and `ProvenanceRecord` models.
5. **Mock Testing Layer**: Provided `S3ConnectorService.Mock` for fast, offline, and deterministic unit testing of complete connector lifecycles.
6. **Rigorous 5-Step Validation**: 33 out of 33 tests passing across 19 suites, zero lint or formatting issues, 100% strict type safety, and clean WebAssembly compilation.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                | Summary of Changes                                                                                       |
| :--------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                         | Added `secretDefaults.local.resources.s3` with `main`, `legal`, and `technical` S3 targets             |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                                     | Added `S3ResourceTargetSchema`, `ResourcesSecretSchema`, `ResourcesConfigFields`, and `ResourcesConfigValues` |
| `[NEW]`    | [`src/config/resources-config.ts`](../../src/config/resources-config.ts)                 | Implemented Golem `defineConfig` for `Resources.Config` with dynamic `getS3Resource` lookup in `ToValues`|
| `[MODIFY]` | [`src/config/index.ts`](../../src/config/index.ts)                                       | Exported `resources-config.js`                                                                           |
| `[NEW]`    | [`src/connectors/connector-base.ts`](../../src/connectors/connector-base.ts)             | Created `SourceConnector` contract, `DiscoveredItem`, `ExtractedDocument`, `S3CursorData`, and `ConnectorError` |
| `[NEW]`    | [`src/connectors/s3-signer.ts`](../../src/connectors/s3-signer.ts)                       | Created pure AWS SigV4 signer, path-style URL builder, and S3 XML parser                                |
| `[NEW]`    | [`src/connectors/s3-connector.ts`](../../src/connectors/s3-connector.ts)                 | Implemented `S3Connector` and `S3ConnectorService` with `Live` and `Mock` layers                         |
| `[NEW]`    | [`src/connectors/index.ts`](../../src/connectors/index.ts)                               | Barrel exports for connector interfaces, S3 connector, and signer utilities                             |
| `[NEW]`    | [`test/connectors.test.ts`](../../test/connectors.test.ts)                               | 8 comprehensive unit tests covering dynamic resources, SigV4 signing, XML parsing, and mock ingestion    |
| `[MODIFY]` | [`docs/implementation/phase-3-connectors-s3-ingestion_feature_plan.md`](../../docs/implementation/phase-3-connectors-s3-ingestion_feature_plan.md) | Updated plan with dynamic multi-resource architecture and marked as `Completed`                          |

---

## 3. Key Logic & Architectural Highlights

### 3.1 Dynamic Multi-Resource Configuration

In [`golem.yaml`](../../golem.yaml), [`src/config/schema.ts`](../../src/config/schema.ts), and [`src/config/resources-config.ts`](../../src/config/resources-config.ts):
- Rather than fixing a single S3 bucket or spreading bucket credentials across disjoint config and secret keys, all resources are grouped in `secretDefaults.local.resources.s3`:
  ```yaml
  secretDefaults:
    local:
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
  ```
- `ResourcesSecretSchema` uses `Schema.Record(Schema.String, S3ResourceTargetSchema)` wrapped in `Schema.Redacted(...)`.
- Any number of new S3 resources can be defined dynamically without altering schema definitions or agent logic.
- `ResourcesConfigValues` exposes `getS3Resource(name)` returning `Option<S3ResourceTarget>`.

### 3.2 Pure AWS SigV4 Signer & XML Parser

In [`src/connectors/s3-signer.ts`](../../src/connectors/s3-signer.ts):
- Computes standard AWS Signature Version 4 authorization headers (`AWS4-HMAC-SHA256`) using `node:crypto` HMAC-SHA256 (supported in QuickJS WebAssembly).
- Canonicalizes URI paths, query strings, headers (`host`, `x-amz-date`, `x-amz-content-sha256`), and derives the scoped signing key:
  $$k_{\text{signing}} = \text{HMAC}(\text{HMAC}(\text{HMAC}(\text{HMAC}(\text{"AWS4"} + \text{secret}, \text{date}), \text{region}), \text{"s3"}), \text{"aws4\_request"})$$
- Parses S3 `ListObjectsV2` XML responses into strongly-typed `ParsedS3Object` arrays, extracting `Key`, `Size`, `ETag`, `LastModified`, and `NextContinuationToken`.

### 3.3 Incremental Ingestion & Cursor Tracking

In [`src/connectors/s3-connector.ts`](../../src/connectors/s3-connector.ts):
- During `discover`, the connector compares each object's `lastModified` and `ETag` against the previous `S3CursorData`.
- If an object has not changed (`lastModified <= cursor.lastSyncTimestamp` AND `cursor.processedKeys[key] === etag`), it is skipped, avoiding redundant downloads.
- When an object is added or modified, it is discovered and converted into a `RawDocument` with markdown-extracted title, metadata (bucket, key, size, timestamp), and a corresponding `ProvenanceRecord`.
- `checkpoint()` serializes the cursor for atomic persistence in `CheckpointRepository`.

---

## 4. Verification & Validation Results

### 4.1 Code Formatting

```bash
npm run format:check
```

**Output**:
```text
> format:check
> prettier --check src/ test/

Checking formatting...
All matched files use Prettier code style!
```

### 4.2 Linter Verification

```bash
npm run lint
```

**Output**:
```text
> lint
> eslint src/ test/
```
Zero warnings or errors.

### 4.3 Type Checking

```bash
npm run typecheck
```

**Output**:
```text
> typecheck
> tsc --noEmit
```
Zero TypeScript compilation errors with `strict: true`.

### 4.4 Automated Unit Tests

```bash
npm test
```

**Output**:
```text
> test
> tsx --test

▶ Phase 3 Connectors & S3 Ingestion
  ▶ Dynamic Multi-Resource Configuration
    ✔ should decode dynamic multi-resource S3 configuration under resources.s3 (4.528557ms)
    ✔ should validate a single S3ResourceTarget (0.22329ms)
  ✔ Dynamic Multi-Resource Configuration (5.752089ms)
  ▶ S3 SigV4 Signer & URL Builder
    ✔ should build path-style S3 URLs with query parameters correctly (0.354461ms)
    ✔ should calculate deterministic AWS SigV4 authorization headers (15.187012ms)
  ✔ S3 SigV4 Signer & URL Builder (15.771435ms)
  ▶ S3 XML Response Parser
    ✔ should parse S3 ListObjectsV2 XML response with objects and pagination (0.734263ms)
    ✔ should handle empty bucket results gracefully (0.202353ms)
  ✔ S3 XML Response Parser (1.174695ms)
  ▶ S3 Connector Lifecycle & Incremental Ingestion
    ✔ should discover, fetch, and normalize documents via Mock S3 layer (3.364494ms)
    ✔ should re-ingest modified files when ETag or timestamp changes (0.455559ms)
  ✔ S3 Connector Lifecycle & Incremental Ingestion (4.034443ms)
✔ Phase 3 Connectors & S3 Ingestion (27.533875ms)
▶ Domain Schemas (18.301828ms)
▶ Phase 2 Processing Pipeline & Semantic Services (17.33335ms)
ℹ tests 33
ℹ suites 19
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1283.791239
```

### 4.5 Golem WebAssembly Build

```bash
npm run build
```

**Output**:
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
Writing pre-initialized component to golem-temp/agents/golem_kgs_effect_effect_main.preinitialized.wasm...
Done! Input: 12386.8 KB, Output: 32484.6 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

---

## 5. How to Run & Verify

To run the complete verification suite locally:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

To run only the connectors test suite:
```bash
npx tsx --test test/connectors.test.ts
```

---

## 6. Sign-off / Next Steps

- **Status**: Ready for Review and Approval.
- **Next Phase**: Phase 4 ("Durable Agent Implementation") from `plan.md`:
  - `S3IngestorTaskAgent`: Durable worker driving S3 scanning, cursor snapshotting, and pipeline streaming.
  - `IngestionCoordinatorAgent`: Supervisor managing connector registries, Golem host `.schedule()` cron timers, and worker lifecycle.
  - `KnowledgeAccessAgent`: Stateless ephemeral agent for graph traversals and search queries.
