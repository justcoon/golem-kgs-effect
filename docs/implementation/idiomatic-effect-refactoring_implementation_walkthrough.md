# Feature Implementation Walkthrough: Idiomatic Effect TS Refactoring

- **Feature ID / Slug**: `idiomatic-effect-refactoring`
- **Date**: 2026-09-10
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

This comprehensive refactoring addressed all primary and secondary idiomatic Effect TS issues across `src/`:
1. Eliminated all 7 imperative `try...catch` blocks across `src/`, replacing them with `Option.liftThrowable`.
2. Streamlined URL resolution: `resolveUrl` now natively returns `Option<URL>`, eliminating redundant string-to-URL parsing cycles.
3. Replaced ad-hoc `Option` constructions, comparisons (`_tag === "None"`), and premature unwrapping with standard Effect combinators (`Option.fromNullishOr`, `Option.map`, `Option.getOrNull`, `Option.getOrElse`).
4. Adopted `Effect.option` instead of manual `map(Some) + catch(None)` patterns.
5. Replaced `.pipe(map(true), catch(false))` with `Effect.match({ onSuccess, onFailure })` in ingestion pipelines.
6. Replaced `.filter(Option.isSome).map(opt => opt.value)` with `ReadonlyArray.getSomes`.
7. Replaced raw, throwing `JSON.parse` across all storage repositories (`chunk-repository`, `document-repository`, `entity-repository`, `graph-repository`, `checkpoint-repository`) with safe `parseJsonOr` backed by `Option.liftThrowable(JSON.parse)`.

All changes maintain complete compatibility with Effect v4, SQL parameter bindings, and Golem runtime HTTP schemas (`Schema.NullOr(...)` for 404 responses).

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                | Summary of Changes                                                                                            |
| :--------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/web-connector.ts)     | Replaced `try...catch` with `Option.liftThrowable`; `resolveUrl` returns `Option<URL>`; used `Effect.option` in `fetchPageContent`. |
| `[MODIFY]` | [`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts)                     | Replaced `try { JSON.parse }` with `tryParseJson` using `Option.liftThrowable`.                              |
| `[MODIFY]` | [`src/config/resources-config.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/resources-config.ts) | Replaced manual ternary Option checks with `Option.fromNullishOr(...)`.                                       |
| `[MODIFY]` | [`src/connectors/s3-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/s3-connector.ts)     | Replaced `Option.getOrUndefined(cursor)` with `Option.match(cursor, { onNone, onSome })`.                      |
| `[MODIFY]` | [`src/storage/repository-tags.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/repository-tags.ts)     | Added `findByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Entity>, SqlError>` to `EntityRepositoryShape`. |
| `[MODIFY]` | [`src/storage/entity-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/entity-repository.ts)   | Implemented single-query batch lookup `findByIds` via `WHERE id = ANY(${Pg.array(ids)})`.                    |
| `[MODIFY]` | [`src/agents/access-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts)         | Replaced N-query `Effect.forEach(findById)` with single-query `entityRepo.findByIds(ids)`.                   |
| `[MODIFY]` | [`src/pipeline/graphrag-service.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/pipeline/graphrag-service.ts) | Replaced concurrent `Effect.all(findById)` with single-query `entityRepo.findByIds(neighborhood.entityIds)`. |
| `[MODIFY]` | [`src/storage/chunk-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/chunk-repository.ts)     | Replaced all raw `JSON.parse` in row and search mappers with `parseJsonOr`.                                  |
| `[MODIFY]` | [`src/storage/document-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/document-repository.ts) | Replaced raw `JSON.parse` in `mapDocumentRow` with `parseJsonOr`.                                             |
| `[MODIFY]` | [`src/storage/graph-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/graph-repository.ts)     | Replaced raw `JSON.parse` in `mapEdgeRow` with `parseJsonOr`.                                                 |
| `[MODIFY]` | [`src/storage/checkpoint-repository.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/storage/checkpoint-repository.ts) | Replaced raw `JSON.parse` for cursor and metrics with `parseJsonOr`.                                          |
| `[MODIFY]` | [`test/web-connector.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/web-connector.test.ts)         | Updated test assertions to verify `Option<URL>` return value from `resolveUrl`.                               |
| `[MODIFY]` | [`test/entity-resolution.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/entity-resolution.test.ts) | Added `findByIds` implementation to mock entity repository.                                                   |
| `[MODIFY]` | [`test/agents.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/agents.test.ts)                       | Added `findByIds` implementation to mock entity repository.                                                   |
| `[MODIFY]` | [`test/graphrag.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/graphrag.test.ts)                   | Added `findByIds` implementation to mock entity repository.                                                   |

### Key Logic & API Changes

1. **`src/connectors/web-connector.ts`**:
   - `resolveUrl` now natively returns `Option.Option<URL>` instead of `string | undefined`:
     ```ts
     export function resolveUrl(
       baseUrl: string,
       relativeOrAbsolute: string,
     ): Option.Option<URL> {
       return tryParseUrl(relativeOrAbsolute, baseUrl);
     }
     ```
   - In `extractContent`, link candidate URLs are parsed once directly into `Option<URL>` and filtered in-place (`protocol`, non-static extensions, `isUrlAllowed`) before mapping to `.toString()`, completely eliminating redundant re-parsing.
   - Redirect `Location` headers and base URLs are parsed via `resolveUrl` with pattern matching.
   - `fetchPageContent` returns `Effect.option(HttpClientRequest.get(...))` directly instead of manual `Effect.map(Option.some).pipe(Effect.catchAll(() => Effect.succeed(Option.none())))`.
2. **Safe JSON Parsing in Storage**:
   - Centralized `parseJsonOr` in `src/storage/database-client.ts`:
     ```ts
     const tryParseJson = Option.liftThrowable(JSON.parse);
     export const parseJsonOr = <T>(value: unknown, fallback: T): T => {
       if (typeof value === "string") {
         return tryParseJson(value).pipe(Option.getOrElse(() => fallback)) as T;
       }
       return (value as T) ?? fallback;
     };
     ```
   - Applied across `chunk-repository.ts`, `document-repository.ts`, `entity-repository.ts`, `graph-repository.ts`, and `checkpoint-repository.ts`.
3. **`Array.getSomes` Adoption**:
   - `ReadonlyArray.getSomes` unwraps `Option<T>[]` into `T[]` cleanly in `src/pipeline/graphrag-service.ts` and `src/agents/access-agent.ts`.
4. **`Effect.match` Ingestion Error Handling**:
   - Replaced verbose `.pipe(Effect.map(() => true), Effect.catchAll(() => Effect.succeed(false)))` with declarative `Effect.match({ onSuccess: () => true, onFailure: () => false })` in `s3-ingestion-pipeline.ts` and `web-ingestion-pipeline.ts`.
5. **Agent Boundaries & Reusable Mappers**:
   - `getEntity` and `getDocument` in `KnowledgeAccessAgent` use `opt.pipe(Option.map(mapper), Option.getOrNull)`.
   - `lastSynchronizedAt` unwraps via `Option.map(lastSyncOpt, d => d.toISOString()).pipe(Option.getOrNull)`.
6. **Batch Entity Lookup (`findByIds`)**:
   - Added `findByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Entity>, SqlError>` to `EntityRepositoryShape` and implemented via `WHERE id = ANY(${Pg.array(ids)})`.
   - Replaced both `Effect.forEach(ids, (id) => entityRepo.findById(id))` in `access-agent.ts` and `Effect.all(ids.map(...))` in `graphrag-service.ts` with direct, single-query `entityRepo.findByIds(ids)`.

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
Command executed:
```bash
npm run format:check
```
**Result**:
```text
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
> tsc --noEmit
(exited with code 0)
```

### 3.3 Linter Verification
Command executed:
```bash
npm run lint
```
**Result**:
```text
> eslint src/ test/
✖ 4 problems (0 errors, 4 warnings)
```

### 3.4 Automated Test Suite
Command executed:
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
ℹ duration_ms 1743.771818
```

### 3.5 Frontend Build
Command executed:
```bash
npm --prefix frontend run build
```
**Result**:
```text
✓ built in 498ms
```

### 3.6 Golem WebAssembly Component Build
Command executed:
```bash
npm run build
```
**Result**:
```text
Building golem-kgs-effect:effect-main
Injecting JS module into QuickJS WASM
Pre-initializing component (init_func=wizer-initialize)...
Done! Input: 12650.1 KB, Output: 36860.2 KB
Finished building [OK]
```

---

## 4. How to Run & Verify

1. **Verify Typecheck and Linter**:
   ```bash
   npm run typecheck && npm run lint
   ```
2. **Run Test Suite**:
   ```bash
   npm test
   ```
3. **Verify Zero `try` blocks remaining in `src/`**:
   ```bash
   grep -rn "try {" src/
   ```
4. **Verify Golem Component Build**:
   ```bash
   npm run build
   ```

---

## 5. Sign-off / Next Steps

All idiomatic Effect TS refactoring items and secondary improvements are fully addressed, verified with automated tests, and confirmed to build cleanly into the Golem WASM guest component.
