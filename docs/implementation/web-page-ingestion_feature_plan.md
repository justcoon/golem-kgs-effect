# Feature Plan: Web / Documentation Page Ingestion Connector & Agent

- **Feature ID / Slug**: `web-page-ingestion`
- **Date**: 2026-09-09
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

This feature introduces a native **Web / Documentation Page Ingestion Connector** and a dedicated **`WebIngestorTaskAgent`** to the Golem Knowledge Graph System. It enables ingesting, chunking, embedding, and extracting knowledge graph entities from public web documentation, sitemaps, and web pages without requiring AWS credentials or external storage buckets.

### Goals

1. **Public Web Page & Sitemap Discovery (`WebPageConnector`)**:
   - Implements `SourceConnector` in [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts).
   - Supports crawling page URLs defined via `sitemapUrl` (`sitemap.xml`) or a static list of `seedUrls`.
   - Performs lightweight HTML-to-Markdown parsing, preserving page title (`<title>`), breadcrumbs, heading hierarchy (`<h1>`–`<h6>`), paragraphs, and link references while stripping script/style boilerplate.
   - Emits standardized `RawDocument` (with deterministic UUIDs based on URI) and `ProvenanceRecord` with HTTP headers (`ETag`, `Last-Modified`).
2. **Incremental Change Tracking (`WebCursorData`)**:
   - Tracks synced URLs and their associated `ETag` and/or `Last-Modified` timestamps.
   - Bypasses unchanged pages during incremental syncs; supports `force: true` for full rescan.
3. **Web Ingestion Pipeline (`runWebIngestion`)**:
   - Implements [`src/pipeline/web-ingestion-pipeline.ts`](../../src/pipeline/web-ingestion-pipeline.ts) reusing the existing `DocumentChunker`, `EmbeddingService`, `ExtractionService`, `EntityResolverService`, and repository substrate.
4. **Durable Worker Agent (`WebIngestorTaskAgent`)**:
   - Defines a durable Golem agent in [`src/agents/web-task-agent.ts`](../../src/agents/web-task-agent.ts) bound 1:1 to a configured web target name (`resourceName: string`).
   - Exposes `sync`, `getStatus`, and `resetCursor` methods over HTTP mounted at `/api/ingestion/web/{resourceName}`.
   - Uses schema-driven snapshots (`Snapshot.define`) for crash resilience.
5. **Coordinator Dispatch Integration**:
   - Enables `"web"` in `SourceTypeSchema` in [`src/agents/types.ts`](../../src/agents/types.ts).
   - Updates [`IngestionCoordinatorAgent`](../../src/agents/coordinator-agent.ts) to dispatch sync runs, scheduled cron jobs, and push webhooks to `WebIngestorTaskAgent`.
6. **Manifest & Deployment Registration**:
   - Registers `WebIngestorTaskAgent` in [`golem.yaml`](../../golem.yaml) under `httpApi.deployments.local.agents`.
   - Registers side-effect import in [`src/main.ts`](../../src/main.ts).

### Non-Goals

- Deep, unbounded multi-domain web crawling (the connector is scoped to configured domain/prefix sitemaps and seed URL lists).
- Headless browser rendering for heavy SPA / client-rendered JavaScript apps (it targets standard HTML documentation pages, static sites, and Markdown resources accessible via standard HTTP GET).

---

## 2. Architecture & Technical Design

```
                     ┌────────────────────────────────────────┐
                     │       IngestionCoordinatorAgent        │
                     │  - schedules, manual sync, push hooks  │
                     └───────────────────┬────────────────────┘
                                         │ RPC dispatch (sourceType: "web")
                                         ▼
                      ┌───────────────────────────────────────┐
                      │          WebIngestorTaskAgent         │
                      │  - mounted: /api/ingestion/web/{res}  │
                      │  - durable state & snapshot policy    │
                      └───────────────────┬───────────────────┘
                                          │ runs
                                          ▼
                      ┌───────────────────────────────────────┐
                      │           runWebIngestion             │
                      └───────────────────┬───────────────────┘
                                          │ uses
                                          ▼
                      ┌───────────────────────────────────────┐
                      │           WebPageConnector            │
                      │     (implements SourceConnector)      │
                      └───────────────┬───────┬───────────────┘
                                      │       │
              ┌───────────────────────┘       └───────────────────────┐
              ▼                                                       ▼
      1. discover(cursor)                                     2. fetch(item)
      - Fetch sitemap.xml / seed URLs                         - HTTP GET via FetchHttpClient
      - Compare ETag / Last-Modified                          - Clean HTML to Markdown
      - Return changed/new DiscoveredItems                    - Return ExtractedDocument
                                                                      │
                                                                      ▼
                                                      [Shared Pipeline Substrate]
                                                      - DocumentChunker
                                                      - EmbeddingService
                                                      - ExtractionService
                                                      - EntityResolverService
                                                      - PostgreSQL Repositories
```

### 2.1 Configuration Specification (`golem.yaml` & Effect Schemas)

Web resources are declared in `golem.yaml` under `secretDefaults.<env>.resources.web`:

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
        - name: "main"
          endpoint: "{{ S3_ENDPOINT_URL }}"
          region: "{{ AWS_DEFAULT_REGION }}"
          bucket: "golem-documents"
          prefixes:
            - "general/"
          accessKeyId: "{{ AWS_ACCESS_KEY_ID }}"
          secretAccessKey: "{{ AWS_SECRET_ACCESS_KEY }}"

      # --- Web Ingestion Resources ---
      web:
        # Style A: Sitemap-driven documentation crawler
        - name: "golem-docs"
          baseUrl: "https://learn.golem.cloud"
          sitemapUrl: "https://learn.golem.cloud/sitemap.xml"
          includePatterns:
            - "/docs/"
          excludePatterns:
            - "/assets/"
            - "/tags/"
          headers:
            User-Agent: "GolemKnowledgeBot/1.0"

        # Style B: Seed URL list (raw markdown files, articles, specs)
        - name: "effect-specs"
          baseUrl: "https://raw.githubusercontent.com"
          seedUrls:
            - "https://raw.githubusercontent.com/golemcloud/effect-golem/main/README.md"
            - "https://raw.githubusercontent.com/golemcloud/golem/main/README.md"
```

#### Schema Definitions in `src/config/schema.ts`

```typescript
export const WebResourceTargetSchema = Schema.Struct({
  name: Schema.String,
  baseUrl: Schema.String,
  sitemapUrl: Schema.optional(Schema.String),
  seedUrls: Schema.optional(Schema.Array(Schema.String)),
  includePatterns: Schema.optional(Schema.Array(Schema.String)),
  excludePatterns: Schema.optional(Schema.Array(Schema.String)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type WebResourceTarget = typeof WebResourceTargetSchema.Type;

export const ResourcesSecretSchema = Schema.Struct({
  s3: Schema.Array(S3ResourceTargetSchema),
  web: Schema.optional(Schema.Array(WebResourceTargetSchema)),
});
```

#### Field Reference Table

| Field | Type | Required? | Description & Example |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique identifier for this target (e.g. `"golem-docs"`). Maps 1:1 to `resourceName` constructor parameter of `WebIngestorTaskAgent`. |
| `baseUrl` | `string` | **Yes** | Root origin URL (e.g. `"https://learn.golem.cloud"`). Enforces domain boundary and resolves relative links. |
| `sitemapUrl` | `string` | Optional | Absolute URL to `sitemap.xml` for automated URL discovery. |
| `seedUrls` | `string[]` | Optional | Explicit list of full URLs to ingest (e.g. raw markdown links, curated articles). |
| `includePatterns` | `string[]` | Optional | Array of regex or substring filters. Only URLs matching at least one pattern are ingested (e.g. `["/docs/", "/guide/"]`). |
| `excludePatterns` | `string[]` | Optional | Array of regex or substring filters. URLs matching any pattern are skipped (e.g. `["/assets/", "/tags/", "/search"]`). |
| `headers` | `Record<string, string>` | Optional | Custom HTTP headers sent on outbound GET/HEAD requests (e.g. `User-Agent`, `Authorization: Bearer <token>`). |

### 2.2 Ingestion & Processing Architecture

1. **Native WASI HTTP Execution via `FetchHttpClient`**:
   QuickJS WASM supports `globalThis.fetch`. Effect's `FetchHttpClient.layer` provides idiomatic, testable HTTP client execution without any third-party Node native modules.
2. **Deterministic Document UUIDs & Resource Scoping**:
   Document UUIDs will be generated using `generateDocumentUuid("web", resourceName, url)` ensuring isolation across resources and idempotent updates.
3. **Pure-TypeScript Lightweight HTML-to-Markdown Converter**:
   Instead of heavy external C++ parsers like `jsdom` or `cheerio` (which cannot run in WASM), the connector uses a dedicated lightweight HTML transformer that strips `<script>`, `<style>`, `<nav>`, `<footer>` and converts headings, links, paragraphs, and lists into clean Markdown.
4. **Sitemap XML Parsing**:
   Uses clean regex-based XML extraction matching `<url><loc>...</loc><lastmod>...</lastmod></url>` patterns, consistent with existing S3 XML parsing in `src/connectors/s3-signer.ts`.

---

### 2.3 Reference Implementation & Code Reuse (`FetcherAgent`)

Core parsing, redirect, and URL normalization primitives will be adapted from the battle-tested implementation in [`golem-web-crawler-effect/fetcher-agent.ts`](https://github.com/justcoon/golem-web-crawler-effect/blob/main/src/fetcher-agent.ts):

- **Multi-Hop Redirect Handling (`fetchPageContent`)**: Traverses 3xx redirects (up to 5 hops) using `HttpClientRequest`, resolving relative `Location` headers against the active URL.
- **HTML Sanitization & Entity Decoding (`extractTextFromHtml`)**: Strips `<script>`, `<style>`, `<noscript>`, `<iframe>`, `<header>`, `<footer>`, `<nav>`, `<aside>`, and comments, converting blocks to newlines and decoding common HTML entities (`&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`).
- **Metadata & Canonical Resolution (`extractContent`)**: Parses `<title>`, `<base href>`, `<link rel="canonical">`, and `<meta property="og:url">`.
- **URL Filtering**: Ignores non-HTTP schemes (`mailto:`, `tel:`, `javascript:`) and media/asset extensions (`.png`, `.jpg`, `.pdf`, `.zip`, `.css`, `.js`).

---

### 2.4 Database Storage & Metadata Alignment (Zero Migrations)

No new database tables or schema migrations are required:
- **`documents.title` & `documents.content`**: Stores the extracted page title and clean markdown/text content for downstream chunking, embedding, and GraphRAG.
- **`documents.metadata` (`JSONB`)**: Stores web-specific metadata: `{ url, domain, canonicalUrl, httpStatus, etag, lastModified, redirectChain }`.
- **`documents.source` & `documents.resource_name`**: Populated with `"web"` and the configured target name (`resourceName`), using deterministic UUID generation.
- **`sync_checkpoints.cursor_data` (`JSONB`)**: Persists incremental sync checkpoints `{ lastSyncTimestamp, processedUrls: { [url]: { etag, lastModified, contentHash } } }`.
- **`chunks`, `embeddings`, `entities`, `edges`**: All downstream graph tables receive records seamlessly from the shared pipeline.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                 | Description                                                                                     |
| :--------- | :------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------- |
| `[NEW]`    | [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts) | Implements `WebPageConnector`, sitemap parsing, HTML-to-Markdown extractor, and Effect service |
| `[NEW]`    | [`src/pipeline/web-ingestion-pipeline.ts`](../../src/pipeline/web-ingestion-pipeline.ts) | Pipeline orchestrator coordinating `WebPageConnector` with chunking, embedding, and storage    |
| `[NEW]`    | [`src/agents/web-task-agent.ts`](../../src/agents/web-task-agent.ts)      | Durable Golem task agent for web targets mounted at `/api/ingestion/web/{resourceName}`         |
| `[NEW]`    | [`test/web-connector.test.ts`](../../test/web-connector.test.ts)         | Unit tests for sitemap discovery, HTML-to-Markdown conversion, and incremental sync cursors    |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                     | Add `WebResourceTargetSchema` and optional `web` list to `ResourcesSecretSchema`                |
| `[MODIFY]` | [`src/config/resources-config.ts`](../../src/config/resources-config.ts) | Add web target lookup helper to `ResourcesConfigValues`                                         |
| `[MODIFY]` | [`src/agents/types.ts`](../../src/agents/types.ts)                       | Enable `"web"` in `SourceTypeSchema`; add Web task state and status schemas                    |
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts) | Provide `WebConnectorService` in the shared agent layer                                        |
| `[MODIFY]` | [`src/agents/coordinator-agent.ts`](../../src/agents/coordinator-agent.ts) | Add dispatch branch for `sourceType === "web"` to `WebIngestorTaskAgent`                       |
| `[MODIFY]` | [`src/main.ts`](../../src/main.ts)                                       | Import `./agents/web-task-agent.js` for side-effect registration                                 |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                         | Add `WebIngestorTaskAgent: {}` to `httpApi.deployments.local.agents`                            |
| `[MODIFY]` | [`openapi.yaml`](../../openapi.yaml)                                     | Add OpenAPI endpoint definitions for `/api/ingestion/web/{resource-name}/*`                    |
| `[MODIFY]` | [`README.md`](../../README.md)                                           | Update documentation to cover Web Page Ingestion agent & endpoints                              |

---

## 4. Verification Plan

### Automated Checks

1. **Code Formatting**:
   ```bash
   npm run format:check
   ```
2. **Type Checking**:
   ```bash
   npm run typecheck
   ```
3. **Linter Verification**:
   ```bash
   npm run lint
   ```
4. **Automated Tests**:
   ```bash
   npm test
   ```
5. **Golem Component Build**:
   ```bash
   npm run build
   ```

### Manual / Scenario Verification

1. Verify sitemap discovery and HTML cleaning on realistic test HTML strings and mock sitemaps.
2. Verify coordinator scheduling and manual sync triggering (`POST /api/coordinator/sync` with `sourceType: "web"`).
3. Verify agent state persistence and cursor advancement via `GET /api/ingestion/web/{resourceName}/status`.

---

## 5. Risks & Open Questions

- **HTML Variability:** Complex layouts with heavy inline CSS/scripts might produce noisy text.
  - *Mitigation:* The HTML converter strips `<script>`, `<style>`, `<noscript>`, `<svg>`, `<nav>`, `<header>`, `<footer>` and extracts semantic text/headings.
- **Incremental Change Detection:** Some static servers do not send reliable `ETag` or `Last-Modified` headers.
  - *Mitigation:* The connector can fall back to SHA-256 body checksums when headers are absent to avoid re-indexing identical content.
