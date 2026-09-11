# Feature Plan: Refactor WebPageConnector to Use Effect Cache

- **Feature ID / Slug**: `web-connector-effect-cache`
- **Date**: 2026-09-11
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

In [`WebPageConnector`](../../src/connectors/web-connector.ts), page responses are currently cached in an in-memory `private readonly pageCache = new Map<string, ...>()`.

While this avoids re-fetching crawled pages during extraction, using a raw mutable JavaScript `Map` has several limitations in an idiomatic Effect architecture:
- **Unbounded memory growth**: The map grows without limit as pages are crawled.
- **Duplicated fetch logic**: Callers of `fetch()` have to manually inspect the cache and fall back to `fetchPageContent`.
- **No concurrent request deduplication (stampeding / single-flight protection)**: If multiple fibers request the same URL concurrently, each triggers redundant HTTP GET requests.
- **Impure mutable state**: Mutating state directly in an Effect service breaks referential transparency and fiber safety.

This feature replaces `new Map` with **`effect/Cache`**, configuring an LRU capacity bound, TTL expiration, and an asynchronous lookup function that unifies fetching and caching.

### Goals

- Replace `new Map` with `Cache.Cache<string, PageResponse, ConnectorError>`.
- Use an Effect-native `lookup` function `(url: string) => fetchPageContent(url, httpClient, target.headers)` so `Cache.get` automatically resolves missing pages without ad-hoc ternary checks.
- Add `WebPageConnector.make` static factory returning `Effect.Effect<WebPageConnector>` while preserving backward compatibility in the constructor with an optional `pageCache` parameter.
- Bound memory usage with LRU eviction based on `target.maxPages ?? 256` and an appropriate TTL.
- Ensure all existing unit and integration tests pass without regressions, and add tests specifically validating Effect `Cache` integration.

### Non-Goals

- Changing the external `SourceConnector` interface contract (`connect`, `discover`, `fetch`, `checkpoint`).
- Modifying S3 connector or database layers.

---

## 2. Architecture & Technical Design

### Key Decisions

1. **`effect/Cache` (`Cache.make`)**:
   - `lookup: (url: string) => fetchPageContent(url, httpClient, target.headers)`
   - `capacity: target.maxPages ? Math.max(target.maxPages, 256) : 256`
   - `timeToLive: Duration.minutes(60)`
2. **Unified Fetching in `fetch(item)`**:
   - Instead of:
     ```typescript
     const cached = pageCache.get(item.uri) ?? pageCache.get(item.id);
     const res = cached !== undefined ? cached : yield* fetchPageContent(item.uri, httpClient, target.headers);
     ```
   - It becomes:
     ```typescript
     const res = yield* Cache.get(this.pageCache, item.uri);
     ```
     If the page was fetched during `discover()`, it is returned immediately from cache. If not (e.g. from `sitemap.xml`), `Cache.get` triggers `lookup(item.uri)` and caches the result.
3. **Handling Redirects in `discover()`**:
   - When crawling `currentUrl`, `Cache.get(this.pageCache, currentUrl)` executes the fetch.
   - If `pageRes.finalUrl !== currentUrl`, we also record `yield* Cache.set(this.pageCache, pageRes.finalUrl, pageRes)` so lookups by final URL hit the cache directly.
4. **Constructor Ergonomics & Backward Compatibility**:
   - Add `WebPageConnector.make(target, httpClient)` as the idiomatic factory in `WebConnectorService.Live`.
   - Maintain `constructor(target, httpClient, pageCache?)` with a synchronous fallback `Effect.runSync(Cache.make(...))` so existing tests calling `new WebPageConnector(...)` continue to work seamlessly.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                       | Description                                                                                           |
| :--------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts) | Replace `new Map` with `Cache.Cache`, add `WebPageConnector.make`, update `discover` & `fetch`.        |
| `[MODIFY]` | [`test/web-connector.test.ts`](../../test/web-connector.test.ts)         | Add unit test asserting `Cache` request deduplication, LRU caching, and `WebPageConnector.make`.     |

### Detailed Changes

#### `src/connectors/web-connector.ts`
- Define `PageResponse` type alias for the cached payload.
- Update `WebPageConnector` properties:
  - Remove `private readonly pageCache = new Map<...>()`.
  - Add `private readonly pageCache: Cache.Cache<string, PageResponse, ConnectorError>`.
- Add `static make(target: WebResourceTarget, httpClient: HttpClient.HttpClient): Effect.Effect<WebPageConnector>`.
- Update `constructor` to receive `pageCache?: Cache.Cache<string, PageResponse, ConnectorError>`.
- Refactor `discover` to get pages via `Cache.get(this.pageCache, currentUrl)` and set redirected URLs via `Cache.set`.
- Refactor `fetch` to retrieve pages via `Cache.get(this.pageCache, item.uri)`.
- Update `WebConnectorService.Live` to instantiate using `WebPageConnector.make(...)`.

#### `test/web-connector.test.ts`
- Verify `WebPageConnector.make` and `new WebPageConnector` cache behavior.
- Test that calling `fetch` twice on the same item executes only 1 HTTP GET request.

---

## 4. Verification Plan

### Automated Checks

```bash
npm run format:check
npm run typecheck
npm run lint
npm run build
npm test
```

### Manual / Integration Verification

- Verify that crawling and document extraction behave identically to before while bounded by the cache capacity.

---

## 5. Risks & Open Questions

- **Cache TTL vs. Long-running Crawls**: Using 60 minutes TTL ensures freshness while avoiding memory retention past standard sync cycles.
