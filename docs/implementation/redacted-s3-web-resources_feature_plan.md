# Feature Plan: Redacted S3 and Web Resources

- **Feature ID / Slug**: `redacted-s3-web-resources`
- **Date**: 2026-09-22
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Currently, the application config wraps the entire `resources` struct (`{ s3: [...], web: [...] }`) in a single `Schema.Redacted(...)`. This registers one monolithic secret path `resources` with the Golem host. As a result, operators using the Golem CLI cannot update S3 resources without also providing the web resources in the same secret payload, and vice versa.

The goal of this feature is to break `resources` into a standard `Schema.Struct` where `s3` and `web` are independently wrapped in `Schema.Redacted(...)`. This separates their secrets into two distinct, addressable secret paths: `resources.s3` and `resources.web`.

### Goals

- Refactor `ResourcesConfigFields` so `s3` and `web` are individually wrapped with `Schema.Redacted(...)`.
- Expose independent secret paths `resources.s3` and `resources.web` in Golem.
- Update `ResourcesConfig` layers (`ToS3Values`, `ToWebValues`, `ToValues`) to evaluate `config.resources.s3.get` and `config.resources.web.get` independently.
- Maintain backwards-compatible decoding for target records/arrays where applicable.
- Ensure `secretDefaults` in `golem.yaml` work without breaking changes (the YAML hierarchy already matches `resources.s3` and `resources.web`).
- Update existing schema unit tests in `test/connectors.test.ts`.

### Non-Goals

- Changing the internal schemas of `S3ResourceTargetSchema` or `WebResourceTargetSchema`.
- Changing connector ingestion or agent processing logic (the resulting `S3ResourcesConfig` and `WebResourcesConfig` services remain structurally identical).

---

## 2. Architecture & Technical Design

### Golem Secret Resolution

In `@golemcloud/effect-golem`, `compileConfig` recursively traverses `Schema.Struct` nodes to build dot-separated config and secret paths. When it encounters `Schema.Redacted(inner)`, it registers the current path as a secret leaf and uses `inner` for WIT codec mapping.

* **Current Architecture**:
  - `resources: Schema.Redacted(ResourcesSecretSchema)`
  - Secret path registered: `resources`
  - In Golem CLI: Only `golem secret update-value resources` exists.
  - Access in Effect: `const secret = yield* config.resources.get;`

* **Target Architecture**:
  - `resources: Schema.Struct({ s3: Schema.Redacted(Schema.Array(S3ResourceTargetSchema)), web: Schema.Redacted(Schema.Array(WebResourceTargetSchema)) })`
  - Secret paths registered: `resources.s3` and `resources.web`
  - In Golem CLI: `golem secret update-value resources.s3` and `golem secret update-value resources.web` are independent.
  - Access in Effect:
    - S3: `const s3Secret = yield* config.resources.s3.get;`
    - Web: `const webSecret = yield* config.resources.web.get;`

### Key Decisions

1. **Retain Layer Separation**: `ResourcesConfig.ToS3Values` only needs to evaluate `config.resources.s3.get`, and `ResourcesConfig.ToWebValues` only needs to evaluate `config.resources.web.get`. This optimizes secret evaluation so components that only consume S3 don't fetch or decode web secrets.
2. **Preserve Service Contracts**: `S3ResourcesConfig` and `WebResourcesConfig` interfaces remain completely unchanged, ensuring zero downstream breakage in connectors (`s3-connector.ts`, `web-connector.ts`) or agents (`agent-pipeline-layer.ts`).

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                                                    | Description                                                                                                   |
| :--------- | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                                                         | Redact `s3` and `web` fields individually within `resources: Schema.Struct(...)`. Remove obsolete monolithic schema. |
| `[MODIFY]` | [`src/config/resources-config.ts`](../../src/config/resources-config.ts)                                     | Update `ToS3Values`, `ToWebValues`, and `ToValues` to read `resources.s3.get` and `resources.web.get`.       |
| `[MODIFY]` | [`test/connectors.test.ts`](../../test/connectors.test.ts)                                                   | Update schema unit test to assert redaction on `parsed.resources.s3` and `parsed.resources.web`.             |

### Detailed Changes

#### Configuration & Schema

- **`src/config/schema.ts`**:
  - Replace `ResourcesSecretSchema` and `ResourcesConfigFields` with:
    ```typescript
    export const ResourcesConfigFields = {
      resources: Schema.Struct({
        s3: Schema.Redacted(Schema.Array(S3ResourceTargetSchema)),
        web: Schema.Redacted(Schema.Array(WebResourceTargetSchema)),
      }),
    };
    ```
  - Export types updated accordingly.

- **`src/config/resources-config.ts`**:
  - Update `ToS3Values` to evaluate `yield* config.resources.s3.get` and parse array/map.
  - Update `ToWebValues` to evaluate `yield* config.resources.web.get` and parse array/map.
  - Update `ToValues` to evaluate both `.s3.get` and `.web.get`.

#### Unit Tests

- **`test/connectors.test.ts`**:
  - Update test `should parse and redact ResourcesConfigSchema` to test the new nested shape:
    ```typescript
    const raw = {
      resources: {
        s3: Redacted.make([ ... ]),
        web: Redacted.make([ ... ]),
      },
    };
    ```
  - Verify `Redacted.isRedacted(parsed.resources.s3)` and `Redacted.isRedacted(parsed.resources.web)`.

---

## 4. Verification Plan

### Automated Checks

- **Code Formatting**:
  ```bash
  npm run format:check
  ```
- **Type Checking**:
  ```bash
  npm run typecheck
  ```
- **Linter Verification**:
  ```bash
  npm run lint
  ```
- **Automated Unit & Integration Tests**:
  ```bash
  npm test
  ```
- **Golem Component Build**:
  ```bash
  npm run build
  ```

### Manual / CLI Verification

- Check secret paths reported by Golem:
  ```bash
  golem secret list
  ```
  Verify `resources.s3` and `resources.web` appear as distinct secrets.
- Verify retrieving each secret independently:
  ```bash
  golem secret get resources.s3 --show-sensitive
  golem secret get resources.web --show-sensitive
  ```

---

## 5. Risks & Open Questions

- **Risk**: Existing deployed agent environments that already have the monolithic `resources` secret will have an orphan `resources` secret and will need `resources.s3` and `resources.web` created/set.
  - *Mitigation*: For local/test environments, `secretDefaults` automatically provisions `resources.s3` and `resources.web` from `golem.yaml`. For production/cloud environments, run `golem secret update-value resources.s3 ...` and `resources.web ...` and then `golem secret delete resources`.
