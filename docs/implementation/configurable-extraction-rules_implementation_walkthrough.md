# Feature Implementation Walkthrough: Configurable Entity & Relation Extraction Rules

- **Feature ID / Slug**: `configurable-extraction-rules`
- **Date**: 2026-09-07
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

We refactored the semantic extraction pipeline to eliminate static, hardcoded assumptions (`KNOWN_TECHNOLOGIES`, fixed English relation regexes, and static stopwords) in favor of a **purely configuration-driven architecture**.

All dictionary terms, relation extraction patterns, and stopwords are now configured via [`AppAgentConfig`](../../src/config/agent-config.ts) and can be overridden in `golem.yaml`. This enables seamless domain adaptations (e.g. Legal, Healthcare, Financial) with zero code changes, zero database migrations, zero DB overhead during ingestion, and complete GitOps auditability.

---

## 2. Changes Implemented

### File Modifications

| Action | File Path | Summary of Changes |
| :--- | :--- | :--- |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts) | Defined `RelationPatternRuleSchema`, `ExtractionConfigSchema`, and `ExtractionConfigFields`. Eliminated static constants (`DEFAULT_DICTIONARY`, `DEFAULT_RELATION_PATTERNS`, `DEFAULT_STOPWORDS`), keeping code 100% domain-agnostic. |
| `[MODIFY]` | [`src/config/agent-config.ts`](../../src/config/agent-config.ts) | Incorporated `ExtractionConfigFields` into `AppAgentConfig`. |
| `[MODIFY]` | [`src/pipeline/extractor.ts`](../../src/pipeline/extractor.ts) | Removed hardcoded constants; updated `EntityExtractor.extract` to default to empty collections (`{}` and `[]`) when no rules are provided, and to dynamically compile word boundaries when configured. |
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts) | Injected configured `extraction` rules from `AppAgentConfigService` into `ExtractionService.make(...)`. |
| `[MODIFY]` | [`test/pipeline.test.ts`](../../test/pipeline.test.ts) | Added unit tests verifying custom domain extraction (Legal domain), custom stopwords filtering, empty dictionary behavior, and schema validation. |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml) | Configured explicit `extraction` section with `dictionary`, `relationPatterns`, and `stopwords`. |
| `[MODIFY]` | [`README.md`](../../README.md) | Documented the `extraction` section in `golem.yaml` and `AppAgentConfig`. |

### Key Logic & API Changes

1. **Configurable Vocabulary (`dictionary`)**:
   - Accepts arbitrary key-value mappings (e.g. `"gdpr": "General Data Protection Regulation"`).
   - Automatically registers the keyword as an alias for canonical entity resolution.

2. **Configurable Relation Patterns (`relationPatterns`)**:
   - Accepts custom relations with phrase lists and confidence scores:
     ```typescript
     {
       relation: "GOVERNED_BY",
       phrases: ["governed by", "subject to", "pursuant to"],
       confidence: 0.90
     }
     ```
   - Dynamically compiles regexes at initialization time.
   - Matches candidate entities against both entity names and registered aliases.

3. **Configurable Stopwords (`stopwords`)**:
   - Customizable exclusion list for multi-word proper-noun detection (e.g. ignoring `"Legal Notice"`, `"Table Of Contents"`).

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
Command:
```bash
npm run format:check
```
Output:
```text
> format:check
> prettier --check src/ test/

Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking
Command:
```bash
npm run typecheck
```
Output:
```text
> typecheck
> tsc --noEmit
```
*Result: 0 errors.*

### 3.3 Linter Verification
Command:
```bash
npm run lint
```
Output:
```text
> lint
> eslint src/ test/
```
*Result: 0 errors / 0 warnings.*

### 3.4 Automated Test Suite
Command:
```bash
npm test
```
Output:
```text
ℹ tests 80
ℹ suites 36
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 992.734946
```
*Result: 80/80 passed across 36 suites (including 4 new tests for custom domain extraction, stopwords, and schemas).*

### 3.5 Golem WebAssembly Component Build
Command:
```bash
golem build --yes
```
Output:
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
Done! Input: 12604.0 KB, Output: 34479.4 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

---

## 4. How to Run & Verify

1. **Verify automated suite**:
   ```bash
   npm test
   npm run typecheck
   npm run lint
   ```

2. **Custom Domain Testing in code**:
   ```typescript
   import { EntityExtractor } from "./src/pipeline/extractor.js";

   const extracted = EntityExtractor.extract(
     "Client Data is governed by GDPR and requires CCPA compliance.",
     "doc_test",
     0,
     {
       dictionary: {
         gdpr: "General Data Protection Regulation",
         ccpa: "California Consumer Privacy Act",
       },
       relationPatterns: [
         {
           relation: "GOVERNED_BY",
           phrases: ["governed by", "subject to"],
           confidence: 0.95,
         },
       ],
     },
   );

   console.log(extracted.entities);
   console.log(extracted.edges);
   ```

3. **Configuring in `golem.yaml`**:
   Add custom vocabulary under `components.golem-kgs-effect:effect-main.config.extraction`.

---

## 5. Sign-off / Next Steps

- All implementation and validation steps are complete.
- Ready for user sign-off.
