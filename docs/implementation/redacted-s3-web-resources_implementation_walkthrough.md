# Feature Implementation Walkthrough: Redacted S3 and Web Resources

- **Feature ID / Slug**: `redacted-s3-web-resources`
- **Date**: 2026-09-22
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

This feature refactored the dynamic resources configuration so that S3 resources and Web resources are independently wrapped in `Schema.Redacted(...)`. Previously, the entire `resources` struct was wrapped in a single `Schema.Redacted(...)`, presenting one monolithic `resources` secret path to Golem.

With this implementation:
- Two independent secret paths are now registered in Golem: **`resources.s3`** and **`resources.web`**.
- Operators can view or update S3 resource lists and Web resource lists independently via the Golem CLI without needing to bundle both in one update payload.
- All Effect services (`ResourcesConfig.ToS3Values`, `ResourcesConfig.ToWebValues`, and `ResourcesConfig.ToValues`), connector layers, unit tests, and the Golem WASM build have been updated, validated, and verified.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                | Summary of Changes                                                                                     |
| :--------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                                     | Changed `resources` to `Schema.Struct` containing individually redacted `s3` and `web` target arrays.  |
| `[MODIFY]` | [`src/config/resources-config.ts`](../../src/config/resources-config.ts)                 | Updated `ToS3Values`, `ToWebValues`, and `ToValues` to read `resources.s3.get` and `resources.web.get`.|
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts)         | Updated `makeS3ConnectorLayer` and `makeWebConnectorLayer` to yield `.s3.get` and `.web.get`.          |
| `[MODIFY]` | [`test/connectors.test.ts`](../../test/connectors.test.ts)                               | Updated unit test to assert independent redaction on `parsed.resources.s3` and `parsed.resources.web`.|

### Key Logic & API Changes

1. **`src/config/schema.ts`**:
   - Replaced `ResourcesSecretSchema` and monolithic `resources: Schema.Redacted(...)` with:
     ```typescript
     export const ResourcesConfigFields = {
       resources: Schema.Struct({
         s3: Schema.Redacted(Schema.Array(S3ResourceTargetSchema)),
         web: Schema.Redacted(Schema.Array(WebResourceTargetSchema)),
       }),
     };
     ```
2. **`src/config/resources-config.ts`**:
   - `ToS3Values` only accesses `config.resources.s3.get` and maps targets to `Record<string, S3ResourceTarget>`.
   - `ToWebValues` only accesses `config.resources.web.get` and maps targets to `Record<string, WebResourceTarget>`.
   - `ToValues` accesses both `.s3.get` and `.web.get` for unified layer consumption.
   - `parseS3Targets` and `parseWebTargets` updated to gracefully handle both array inputs and wrapped `{ s3?: ... }` / `{ web?: ... }` shapes.
3. **`src/agents/agent-pipeline-layer.ts`**:
   - Updated `makeS3ConnectorLayer` to evaluate `yield* config.resources.s3.get`.
   - Updated `makeWebConnectorLayer` to evaluate `yield* config.resources.web.get`.
4. **`golem.yaml`**:
   - No changes required. The existing `secretDefaults` hierarchy:
     ```yaml
     secretDefaults:
       local:
         resources:
           s3: [...]
           web: [...]
     ```
     automatically maps to the new `resources.s3` and `resources.web` paths.

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
[Exit Code 0, 0 compiler errors]
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
[Exit Code 0, 0 lint warnings/errors]
```

### 3.4 Automated Unit & Integration Tests

Command executed:
```bash
npm test
```

**Result**:
```text
ℹ tests 145
ℹ suites 50
ℹ pass 145
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4388.145571
```

### 3.5 Golem WASM Component Build

Command executed:
```bash
npm run build # golem build --yes
```

**Result**:
```text
Building golem-kgs-effect:effect-main
  Executing external command 'npx tsc ...'
  Executing external command 'npx --no rollup ...'
  Injecting JS module into QuickJS WASM agent_guest.wasm
  Pre-initializing JS component (wizer-initialize)...
  Done! Input: 13665.7 KB, Output: 48458.6 KB
Adding metadata to components
Finished building [OK]
```

---

## 4. How to Use & Verify with Golem CLI

Once deployed or when running with the local server (`golem server start`):

1. **List Secrets**:
   ```bash
   golem secret list
   ```
   You will now see:
   - `resources.s3`
   - `resources.web`

2. **Update S3 resources independently**:
   ```bash
   golem secret update-value resources.s3 --secret-value '[
     {
       "name": "main",
       "endpoint": "http://127.0.0.1:9000",
       "region": "us-east-1",
       "bucket": "golem-documents",
       "prefixes": ["general/"],
       "accessKeyId": "rustfsadmin",
       "secretAccessKey": "rustfsadmin123"
     }
   ]'
   ```

3. **Update Web resources independently**:
   ```bash
   golem secret update-value resources.web --secret-value '[
     {
       "name": "golem-docs",
       "baseUrl": "https://learn.golem.cloud",
       "seedUrls": ["https://learn.golem.cloud"],
       "includePatterns": ["/v1.5/"]
     }
   ]'
   ```

---

## 5. Sign-off / Next Steps

- All implementation and validation gates have passed.
- Ready for final user sign-off.
