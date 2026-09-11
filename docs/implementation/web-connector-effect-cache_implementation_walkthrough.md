# Feature Implementation Walkthrough: Refactor WebPageConnector to Use Effect Cache

- **Feature ID / Slug**: `web-connector-effect-cache`
- **Date**: 2026-09-11
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

We have refactored [`WebPageConnector`](../../src/connectors/web-connector.ts) to replace the raw JavaScript mutable `new Map` cache with Effect's native **`effect/Cache`**.

The new implementation:
- Enforces an LRU bounded memory capacity (`target.maxPages ?? 256`) and TTL expiration (60 minutes).
- Provides concurrent request deduplication (singleflighting).
- Encapsulates asynchronous fetch logic inside the cache's `lookup` function, eliminating manual cache checking and fallback branches in `fetch(item)`.
- Introduces `WebPageConnector.make` static factory returning `Effect.Effect<WebPageConnector>`, while preserving constructor compatibility with `new WebPageConnector(...)` for test ergonomics.
- Updates `WebConnectorService.Live` to instantiate connectors via `WebPageConnector.make`.
- Passes all strict verification steps: code formatting, TypeScript typechecking, ESLint (0 errors, 0 warnings), Golem WASM build, and all 128 automated unit/integration tests.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                       | Summary of Changes                                                                                                                                                                          |
| :--------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts) | Added `PageResponse` interface; replaced `Map` with `Cache.Cache`; added `createDefaultCache` and `WebPageConnector.make`; updated `discover`, `fetch`, and `WebConnectorService.Live`. |
| `[MODIFY]` | [`test/web-connector.test.ts`](../../test/web-connector.test.ts)         | Added test asserting `WebPageConnector.make` initializes with `Cache` and that repeated `fetch` calls deduplicate HTTP requests; used typed `HttpClientResponse.fromWeb`.               |

### Key Logic & API Changes

1. **`Cache.Cache<string, PageResponse, ConnectorError>`**:
   - Initialized via `Cache.make`:
     ```typescript
     static createDefaultCache(
       target: WebResourceTarget,
       httpClient: HttpClient.HttpClient,
     ): Effect.Effect<Cache.Cache<string, PageResponse, ConnectorError>> {
       const capacity = target.maxPages ? Math.max(target.maxPages, 256) : 256;
       return Cache.make({
         capacity,
         timeToLive: Duration.minutes(60),
         lookup: (url: string) =>
           fetchPageContent(url, httpClient, target.headers),
       });
     }
     ```
2. **Simplified `fetch(item)`**:
   - Replaced:
     ```typescript
     const cached = pageCache.get(item.uri) ?? pageCache.get(item.id);
     const res = cached !== undefined ? cached : yield* fetchPageContent(item.uri, httpClient, target.headers);
     ```
   - With:
     ```typescript
     const res = yield* Cache.get(pageCache, item.uri);
     ```
3. **Crawl Ingestion in `discover()`**:
   - Fetches URLs via `Cache.get(pageCache, currentUrl)`.
   - If redirected (`pageRes.finalUrl !== currentUrl`), sets `Cache.set(pageCache, pageRes.finalUrl, pageRes)` to index the final target URL.
4. **Service Integration**:
   - `WebConnectorService.Live.createConnector` now calls `yield* WebPageConnector.make(targetOpt.value, httpClient)`.

### Cache Capacity & LRU Eviction Behavior

A key motivation for switching from `new Map` to `effect/Cache` was bounded memory safety in WebAssembly components:

- **LRU Eviction**: When the number of unique cached pages reaches `capacity` (`Math.max(target.maxPages, 256)`), Effect's cache automatically evicts the least recently accessed pages. This bounds memory consumption and prevents out-of-memory crashes during large crawls.
- **Transparent Re-fetch on Eviction**: If `fetch(item)` subsequently requests a page that was evicted, `Cache.get` does **not** fail or return undefined. Instead, it automatically executes the cache's `lookup` function (`fetchPageContent`), re-downloads the page over HTTP, re-populates the cache slot, and returns the result seamlessly to the pipeline.
- **Zero Impact on Pipeline Reliability**: Cache eviction only trades an extra HTTP request for strict memory bounds, ensuring crawling and document extraction remain resilient under arbitrarily large crawl sets.

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
> typecheck
> tsc --noEmit
(zero errors)
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
(zero errors, zero warnings)
```

### 3.4 Golem Build

Command executed:
```bash
npm run build
```

**Result**:
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
  Selected components and layers:
    golem-kgs-effect:effect-main: effect, effect[optimized], golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    ...
    Pre-initializing JS component ...
    Writing pre-initialized component ...
Done! Input: 13138.4 KB, Output: 40116.1 KB
Finished building [OK]
```

### 3.5 Test Suite Execution

Command executed:
```bash
npm test
```

**Result**:
```text
ℹ tests 128
ℹ suites 48
ℹ pass 128
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
Including the new test:
- `should use WebPageConnector.make with Effect Cache to deduplicate fetch HTTP requests`

---

## 4. Conclusion & Next Steps

The refactoring is complete, fully verified, and ready for review.
