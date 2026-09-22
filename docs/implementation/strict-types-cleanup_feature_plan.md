# Feature Plan: Strict Types Cleanup & Anti-Pattern Elimination

- **Feature ID / Slug**: `strict-types-cleanup`
- **Date**: 2026-09-22
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

This feature systematically eliminates typing anti-patterns, redundant type assertions, double `as unknown as Type` casts, and loose `unknown` declarations across the codebase, establishing strict static typing throughout the domain, storage, and pipeline layers.

### Goals

1. **Eliminate Unsafe Double Casting**: Remove `as unknown as VectorEmbedding` in `src/pipeline/embedding-service.ts` by leveraging native TypeScript compatibility between `number[]` and `VectorEmbedding` (`readonly number[]`).
2. **Remove Redundant Record Assertions**: Eliminate `(metadata as Record<string, unknown>)` and `(properties as Record<string, unknown>)` casts across `src/agents/access-agent.ts`, `src/pipeline/chunker.ts`, and `src/pipeline/entity-resolver.ts` where Effect Schema types already guarantee `Readonly<Record<string, unknown>>`.
3. **Remove Redundant Array Assertions**: Remove mutable array casts (`as string[]`, `as Edge[]`) in `src/storage/graph-repository.ts` where `GraphPath` expects `ReadonlyArray`.
4. **Strongly Type Database Row Contracts**:
   - Update repository row interfaces in `src/storage/` to use domain types (`SyncStatus`, `EntityType`) and typed JSON unions (`string | Record<string, unknown> | null`) instead of `unknown`.
   - Remove manual `as SyncStatus` and `as EntityType` type assertions in mapper functions.
   - Refactor `parseJsonOr` in `src/storage/database-client.ts` to accept `string | T | null | undefined` and eliminate unsafe `(value as T)` casts.
5. **Remove Redundant `as ReadonlyArray<RowType>` on SQL Queries**: Clean up queries in `src/storage/*.ts` where generic `sql<RowType>` already types the resolved result.
6. **Idiomatic Effect Error Catching**: Replace `Effect.catch((err: unknown) => ...)` with `Effect.catchAll((_err) => ...)` in ingestion pipelines.

### Non-Goals

- Modifying database schemas or migrations (the underlying PostgreSQL columns remain unchanged).
- Changing external agent HTTP API contracts or Golem WIT interfaces.
- Modifying `README.md`.

---

## 2. Architecture & Technical Design

### Key Decisions

1. **Strict Subtyping Over Type Assertions**:
   - `VectorEmbedding` is `typeof Schema.Array(Schema.Number).Type`, which is `ReadonlyArray<number>`.
   - `number[]` is a valid subtype of `ReadonlyArray<number>`. Double type assertions (`as unknown as VectorEmbedding`) circumvent compiler checks and are replaced by direct assignment.
2. **First-Class JSON Column Types in Row Interfaces**:
   - Postgres JSONB columns retrieved via `@golemcloud/effect-golem/postgres` return either already-parsed objects, raw JSON strings, or nulls.
   - Typing them as `string | Record<string, unknown> | null` accurately models the driver behavior without resorting to `unknown`.
3. **Safe `parseJsonOr` Signature**:
   - `parseJsonOr<T>(value: string | T | null | undefined, fallback: T): T` ensures that when `value` is non-string and non-null, it is already known to be of type `T`. This eliminates the unsafe `(value as T) ?? fallback` assertion.
4. **Leveraging `@effect/sql` Generics**:
   - In `@golemcloud/effect-golem/postgres`, `sql<RowType>` returns `Effect<ReadonlyArray<RowType>, SqlError>`. Wrapping the yielded expression in `(...) as ReadonlyArray<RowType>` is redundant and will be removed.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                              | Description                                                                                                   |
| :--------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/pipeline/embedding-service.ts`](../../src/pipeline/embedding-service.ts)         | Use `VectorEmbedding` in `OpenAiEmbeddingItem`; remove double `as unknown as VectorEmbedding` assertions.      |
| `[MODIFY]` | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)                       | Remove redundant `(chunk.metadata as Record<string, unknown>)` assertion in citation extraction.             |
| `[MODIFY]` | [`src/pipeline/chunker.ts`](../../src/pipeline/chunker.ts)                             | Remove redundant `(document.metadata as Record<string, unknown>)` assertion in metadata spreading.            |
| `[MODIFY]` | [`src/pipeline/entity-resolver.ts`](../../src/pipeline/entity-resolver.ts)             | Remove redundant `(properties as Record<string, unknown>)` assertions when merging properties.                |
| `[MODIFY]` | [`src/storage/graph-repository.ts`](../../src/storage/graph-repository.ts)             | Remove `as string[]` and `as Edge[]` casts for `GraphPath`; clean up redundant `as ReadonlyArray<EdgeRow>`.   |
| `[MODIFY]` | [`src/storage/database-client.ts`](../../src/storage/database-client.ts)               | Strongly type `parseJsonOr` with `string | T | null | undefined` and eliminate unsafe `as T` casting.           |
| `[MODIFY]` | [`src/storage/checkpoint-repository.ts`](../../src/storage/checkpoint-repository.ts)   | Strongly type `CheckpointRow` (`SyncStatus`, typed JSON); remove `as SyncStatus` and redundant SQL casts.    |
| `[MODIFY]` | [`src/storage/entity-repository.ts`](../../src/storage/entity-repository.ts)           | Strongly type `EntityRow` (`EntityType`, typed JSON); remove `as EntityType` and redundant SQL casts.         |
| `[MODIFY]` | [`src/storage/document-repository.ts`](../../src/storage/document-repository.ts)       | Strongly type `DocumentRow` JSON metadata; remove redundant SQL query casts.                                  |
| `[MODIFY]` | [`src/storage/chunk-repository.ts`](../../src/storage/chunk-repository.ts)             | Strongly type `ChunkRow` JSON metadata; remove redundant SQL query casts.                                     |
| `[MODIFY]` | [`src/pipeline/s3-ingestion-pipeline.ts`](../../src/pipeline/s3-ingestion-pipeline.ts)   | Replace `Effect.catch((_err: unknown) => ...)` with `Effect.catchAll((_err) => ...)`.                         |
| `[MODIFY]` | [`src/pipeline/web-ingestion-pipeline.ts`](../../src/pipeline/web-ingestion-pipeline.ts) | Replace `Effect.catch((err: unknown) => ...)` with `Effect.catchAll((_err) => ...)`.                          |

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
- **End-to-End (E2E) Test Suite**:
  ```bash
  ./run_e2e_test.sh
  ```

---

## 5. Risks & Open Questions

- **Risk**: Changing row interfaces in storage repositories might reveal subtle type mismatches if any query returns columns with unexpected formats.
  - **Mitigation**: Verified via the full unit test suite (149 tests) and containerized Postgres E2E tests (`./run_e2e_test.sh`).
- **Open Questions**: None.
