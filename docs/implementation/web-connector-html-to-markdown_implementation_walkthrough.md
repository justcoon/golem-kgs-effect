# Feature Implementation Walkthrough: Web Connector HTML to Markdown Transformation

- **Feature ID / Slug**: `web-connector-html-to-markdown`
- **Date**: 2026-09-11
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

We enhanced the web connector and document processing pipeline by replacing flat text extraction with clean, semantic Markdown extraction. 

Previously, web documents had HTML tags stripped down to flat text, losing all heading levels (`<h1>`-`<h6>`). Consequently, downstream chunking via `DocumentChunker` (`src/pipeline/chunker.ts`) could not extract heading breadcrumbs (`parseMarkdownSections`), resulting in empty breadcrumb trails for all web content.

With this implementation:
- `extractMarkdownFromHtml`: Built-in zero-dependency extractor preserving heading hierarchies (`#`, `##`, `###`), lists (`- item`), code blocks (`` `code` ``, ```` ``` ````), blockquotes (`> ...`), Markdown tables, and hyperlinks (`[text](url)` resolved against `baseUrl`), while stripping layout chrome, navigation, headers, footers, scripts, and styles.
- `extractMarkdownWithNodeHtmlMarkdown`: Pure-JS library-backed extractor powered by `node-html-markdown` after stripping chrome boilerplate and resolving relative links against `baseUrl`.
- `DocumentChunker` now automatically produces hierarchical `headerBreadcrumb` paths from web documents.
- `chunker.ts` now also emits `heading` in chunk metadata alongside `headerPath`, ensuring that frontend badges in `SearchView.vue` render without requiring frontend code modifications.
- Complete backward compatibility is maintained via `export const extractTextFromHtml = extractMarkdownFromHtml`.
- All 123 automated tests, TypeScript type checking, ESLint, Prettier formatting, and Golem WASM component build succeed cleanly with zero errors.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                                   | Summary of Changes                                                                                                              |
| :--------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts)                                  | Implemented `stripHtmlChrome`, `extractMarkdownFromHtml` (zero-dependency built-in), and `extractMarkdownWithNodeHtmlMarkdown` (`node-html-markdown` backed). |
| `[MODIFY]` | [`src/pipeline/chunker.ts`](../../src/pipeline/chunker.ts)                                                  | Added `heading: item.header` to chunk metadata alongside `headerPath` for search result heading badge compatibility.            |
| `[MODIFY]` | [`src/pipeline/graphrag-service.ts`](../../src/pipeline/graphrag-service.ts)                                | Upgraded `synthesizeAnswerText`, added `isUsableParagraph` to filter truncated syntax fragments, `sanitizeMarkdownBlock` to balance code fences/backticks, suppressed UUID provenance noise in entities, and deduplicated `CO_OCCURS_WITH` relationships to natural "associated with" phrasing. |
| `[MODIFY]` | [`frontend/src/style.css`](../../frontend/src/style.css)                                                    | Added global `.markdown-body` styles for headings, lists, code pills, pre code blocks, blockquotes, and tables to ensure dark mode formatting across all views. |
| `[MODIFY]` | [`test/web-connector.test.ts`](../../test/web-connector.test.ts)                                            | Added comprehensive test suite for markdown formatting, relative link resolution, and `DocumentChunker` breadcrumb parsing.     |
| `[MODIFY]` | [`test/graphrag.test.ts`](../../test/graphrag.test.ts)                                                      | Added test verifying syntax fragment filtering, unclosed backtick balancing, UUID description suppression, and relation deduplication in `synthesizeAnswerText`. |
| `[MODIFY]` | [`docs/implementation/web-connector-html-to-markdown_feature_plan.md`](./web-connector-html-to-markdown_feature_plan.md) | Updated feature plan status to Completed.                                                                                       |

### Key Logic & API Changes

1. **`extractMarkdownFromHtml(body: string, baseUrl?: string): string`**:
   - Strips non-content tags (`<script>`, `<style>`, `<noscript>`, `<iframe>`, comments).
   - Strips layout chrome (`<header>`, `<footer>`, `<nav>`, `<aside>`, `<button>`, `<form>`, `<svg>`, `role="navigation"`, `aria-hidden="true"`).
   - Formats `<pre><code>` and `<pre>` blocks into fenced code blocks (```` ``` ````).
   - Formats inline `<code>` into backtick spans (`` `code` ``).
   - Converts `<h1-6>` tags into Markdown heading markers (`#`, `##`, `###`, etc.).
   - Converts `<blockquote>` tags into quote lines prefixed with `> `.
   - Converts `<table>` rows (`<tr>`, `<th>`, `<td>`) into standard GitHub-Flavored Markdown tables.
   - Converts `<li...>` items into bullet lists (`- item`).
   - Converts hyperlinks `<a href="...">text</a>` into `[text](resolvedUrl)` using `baseUrl` for relative URLs, while keeping anchor text for fragment/script links.
   - Converts `<strong>`/`<b>` into `**bold**` and `<em>`/`<i>` into `*italic*`.
   - Converts `<hr>` to `---`.
   - Decodes standard HTML entities and normalizes whitespace while preserving Markdown structure.

2. **Integration with `DocumentChunker`**:
   - `extractContent(baseUrl, body, ...)` now invokes `extractMarkdownWithNodeHtmlMarkdown(body, resolvedBaseUrl)` by default.
   - `RawDocument.content` contains full GFM Markdown with layout boilerplate stripped and links resolved against `baseUrl`.
   - `DocumentChunker` extracts hierarchical `headerBreadcrumb`s and attaches both `headerPath` and `heading` to chunk metadata.

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

(Clean exit with code 0)
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

✖ 4 problems (0 errors, 4 warnings)
(Clean exit with code 0, no errors)
```

### 3.4 Golem Component Build

Command executed:
```bash
npm run build # golem build --yes
```

**Result**:
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
  Selected components and layers:
    golem-kgs-effect:effect-main: effect, effect[optimized], golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'npx tsc ...' in directory /Users/coon/workspace-zv/git/golem-kgs-effect
    Executing external command 'npx --no rollup ...' in directory /Users/coon/workspace-zv/git/golem-kgs-effect
    created golem-temp/ts-dist/golem-kgs-effect-effect-main/main.js in 4.1s
    Injecting JS module into QuickJS WASM ...
    Pre-initializing JS component into ...golem_kgs_effect_effect_main.preinitialized.wasm
    Done! Input: 12658.6 KB, Output: 36960.3 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

### 3.5 Automated Test Suite Execution

Command executed:
```bash
npm test
```

**Result**:
```text
ℹ tests 123
ℹ suites 47
ℹ pass 123
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All 122 tests passed, including:
- Markdown extraction preserving `#` headings, lists, bold text, code blocks, blockquotes, and tables.
- Relative URL resolution in markdown links against the page `baseUrl`.
- Chunker hierarchical breadcrumb extraction (`Main Topic > Sub Topic A`) from extracted web Markdown.

---

## 4. How to Run & Verify

1. **Run automated tests**:
   ```bash
   npm test
   ```
2. **Build the WASM component**:
   ```bash
   npm run build
   ```
3. **Verify frontend display**:
   - Ingest a web target via `WebIngestorTaskAgent` (e.g. `POST /api/ingestion/web/docs/sync`).
   - Open the web application and navigate to **Search** or **Documents**.
   - Inspect a web document in the **Document Modal** viewer (`DocumentModal.vue`): it now displays beautifully formatted headings, lists, code spans, blockquotes, and links.
   - Search for keywords in the **Search View**: notice the chunk cards display the `📌 Heading > Subheading` breadcrumb badge.

---

## 5. Sign-off / Next Steps

Implementation and validation are complete and verified across all test and build gates. Ready for final review and sign-off.
