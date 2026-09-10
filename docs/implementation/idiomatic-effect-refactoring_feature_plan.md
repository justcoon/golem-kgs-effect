# Feature Plan: Idiomatic Effect TS Refactoring

- **Feature ID / Slug**: `idiomatic-effect-refactoring`
- **Date**: 2026-09-10
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

This refactoring replaces imperative JavaScript patterns (`try...catch` blocks, manual ternary `Option` construction, manual `_tag` checking, and premature `Option` unpacking) across `src/` with idiomatic Effect TS constructs (`Option.try`, `Option.fromNullable`, `Option.match`, `Option.isNone`, `Option.filter`).

### Goals

- Eliminate all 7 ad-hoc `try...catch` blocks in `src/` by adopting `Option.try(...)`.
- Replace verbose ternary Option constructors (`x !== undefined ? Option.some(x) : Option.none()`) with `Option.fromNullable(x)`.
- Replace imperative `Option._tag === "None"` comparisons with `Option.isNone(...)` or `Option.match(...)`.
- Replace premature `Option.getOrUndefined` unpacking followed by null checks with functional pattern matching (`Option.match`).
- Maintain 100% backward compatibility with existing tests, OpenAPI/REST schemas, and Golem WIT contracts.

### Non-Goals

- Changing SQL parameter bindings: `@effect/sql` expects `null` for SQL NULL column values (in `src/storage/*.ts`).
- Changing REST wire schemas: `Schema.NullOr(...)` must be retained at agent HTTP boundaries for OpenAPI/JSON compatibility and Golem 404 response routing.
- Changing TypeScript optional properties (`foo?: T`) on domain data interfaces: optional fields remain idiomatic for TypeScript object construction.

---

## 2. Architecture & Technical Design

### Key Decisions

1. **Native JS Throwing Operations (`new URL`, `new RegExp`, `JSON.parse`)**:
   - Standard JS library functions throw exceptions on invalid input.
   - Using `Option.try(() => new URL(...))` or `Option.try(() => new RegExp(...))` safely captures potential thrown exceptions and lifts the result into an `Option.Option<T>`.
   - Chaining with `Option.map`, `Option.filter`, or `Option.getOrElse` allows clean, declarative pipeline expressions without imperative control jumps.

2. **Nullability & Optional Values in Memory**:
   - `Option.fromNullable(nullableValue)` replaces manual `v !== undefined ? Option.some(v) : Option.none()` across configuration lookups.
   - `Option.match(opt, { onNone, onSome })` cleanly handles branching when unpacking values without intermediary `undefined` variables.

3. **Access Agent & Entity Lookups**:
   - `access-agent.ts` currently has `if (opt._tag === "None") return null;` in `getEntity` and `getDocument`.
   - Refactor to `Option.match` or `Option.isNone(opt)` to eliminate direct tag inspection.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                                | Description                                                                                                   |
| :--------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/web-connector.ts)     | Replace 6 `try...catch` blocks (`new URL`, `new RegExp`) with `Option.try`, `Option.filter`, `Option.isSome`. |
| `[MODIFY]` | [`src/agents/types.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/types.ts)                     | Replace `try { JSON.parse }` in `JsonFromString` with `Option.try(...).pipe(Option.getOrElse(...))`.           |
| `[MODIFY]` | [`src/config/resources-config.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/resources-config.ts) | Replace ternary Option constructions with `Option.fromNullable(...)`.                                         |
| `[MODIFY]` | [`src/connectors/s3-connector.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/connectors/s3-connector.ts)     | Replace `Option.getOrUndefined(cursor)` with `Option.match(cursor, { onNone, onSome })`.                      |
| `[MODIFY]` | [`src/agents/access-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts)         | Replace manual `_tag === "None"` checks with `Option.isNone(...)` or `Option.match(...)`.                      |

### Detailed Changes

#### `src/connectors/web-connector.ts`
- **`resolveUrl`**:
  ```ts
  export function resolveUrl(
    baseUrl: string,
    relativeOrAbsolute: string,
  ): string | undefined {
    return Option.try(() => new URL(relativeOrAbsolute, baseUrl).toString()).pipe(
      Option.getOrUndefined,
    );
  }
  ```
- **`isUrlAllowed`**:
  ```ts
  const regexMatches = Option.try(() => new RegExp(pattern)).pipe(
    Option.filter((re) => re.test(url)),
    Option.isSome,
  );
  if (regexMatches) return false;
  ```
- **`extractContent` link filtering & crawler hostname extraction**:
  Lift URL parsing into `Option.try(() => new URL(...))`.

#### `src/agents/types.ts`
- **`JsonFromString`**:
  ```ts
  decode: SchemaGetter.transform((s) => {
    if (!s) return {};
    return Option.try(() => JSON.parse(s)).pipe(Option.getOrElse(() => s));
  }),
  ```

#### `src/config/resources-config.ts`
- **`getS3Resource` & `getWebResource`**:
  ```ts
  getS3Resource: (name: string): Option.Option<S3ResourceTarget> =>
    Option.fromNullable(s3Targets[name]),
  getWebResource: (name: string): Option.Option<WebResourceTarget> =>
    Option.fromNullable(webTargets[name]),
  ```

#### `src/connectors/s3-connector.ts`
- **`discover`**:
  ```ts
  const { lastSyncTime, processedKeys } = Option.match(cursor, {
    onNone: () => ({ lastSyncTime: 0, processedKeys: {} }),
    onSome: (c) => ({
      lastSyncTime: new Date(c.lastSyncTimestamp).getTime(),
      processedKeys: c.processedKeys,
    }),
  });
  ```

#### `src/agents/access-agent.ts`
- **`getEntity` & `getDocument`**:
  Replace `if (opt._tag === "None") return null;` with `Option.isNone(opt)` or `Option.match(opt, { onNone: () => null, onSome: (entity) => ({ ... }) })`.

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
- **Automated Tests**:
  ```bash
  npm test
  ```
  Ensure all 118 tests pass with 0 regressions.
- **Frontend Build**:
  ```bash
  npm --prefix frontend run build
  ```
- **Golem Component Build**:
  ```bash
  npm run build
  ```

---

## 5. Risks & Open Questions

- **Risk**: `Option.try` wrapping `new URL` returns `Option.none()` on failure; callers expecting `string | undefined` will receive `undefined` when piped through `Option.getOrUndefined`, ensuring 100% behavioral parity.
- **Open Questions**: None. The boundaries for SQL `NULL` and OpenAPI/HTTP `null` are intentionally kept as discussed.
