# Feature Implementation Walkthrough: On-The-Fly Web Ingestion & Minimal Memory Footprint

- **Feature ID / Slug**: `on-the-fly-web-ingestion`
- **Date**: 2026-09-11
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

We have redesigned the web ingestion subsystem to operate **on the fly** in a single streaming pass:
- **Immediate DB Persistence**: As each page is fetched and parsed into markdown, it is immediately processed (`processAndIndexDocument`), generating embeddings, extracting knowledge graph triples, and persisting directly into `raw_documents`, `document_chunks`, `entities`, `relationships`, and `entity_chunks`.
- **$O(1)$ Page Body Memory Footprint**: The HTML body and `RawDocument` strings are discarded from memory immediately after indexing, freeing memory to GC without lingering in any in-memory map or cache.
- **Check DB / Checkpoint First**: Before fetching a page body, the crawler checks `processedUrls` in the DB/checkpoint. It sends conditional headers (`If-None-Match`, `If-Modified-Since`) and natively handles HTTP `304 Not Modified`, skipping body downloads and indexing for fresh documents.
- **Progressive Checkpoints**: Saves sync checkpoints to `sync_checkpoints` periodically (every 10 documents) and at crawl completion, ensuring sync progress is retained even if interrupted.
- **Contract & Test Compatibility**: `WebPageConnector` continues to implement `SourceConnector` (`discover`, `fetch`) for tests and standalone consumption.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                 | Summary of Changes                                                                                                                                                                                                                 |
| :--------- | :------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/connectors/web-connector.ts`](../../src/connectors/web-connector.ts)         | Added `ConditionalHeaders` and HTTP 304 handling in `fetchPageContent`; added `crawlOnTheFly` method and standalone `buildRawDocument`; removed full-body `pageCache`; simplified `discover` and `fetch`.                          |
| `[MODIFY]` | [`src/pipeline/web-ingestion-pipeline.ts`](../../src/pipeline/web-ingestion-pipeline.ts) | Rewired `runWebIngestion` to call `connector.crawlOnTheFly`, indexing documents to DB on the fly with progressive checkpointing every 10 documents.                                                                                |
| `[MODIFY]` | [`test/web-connector.test.ts`](../../test/web-connector.test.ts)                 | Added tests validating on-the-fly crawl emission without body retention, HTTP 304 conditional request skipping, and backward compatibility of `connector.discover` and `connector.fetch`.                                         |

### Key Architectural Flow

```mermaid
sequenceDiagram
    autonumber
    participant Pipeline as WebIngestionPipeline
    participant DB as SQLite/Postgres DB
    participant Connector as WebPageConnector
    participant Remote as External Web Server
    participant Processor as processAndIndexDocument

    Pipeline->>DB: 1. Read Checkpoint (processedUrls, ETag, lastModified)
    DB-->>Pipeline: Return known URLs metadata

    loop For each URL in Crawl Queue (until maxPages)
        Pipeline->>Connector: crawlOnTheFly
        Connector->>Remote: HTTP GET (If-None-Match: etag, If-Modified-Since: lastmod)
        alt HTTP 304 Not Modified
            Remote-->>Connector: 304 Not Modified
            Connector-->>Pipeline: notModified: true
            Pipeline->>Pipeline: Update syncedAt in memory state
        else HTTP 200 OK
            Remote-->>Connector: 200 OK + HTML Body
            Connector->>Connector: Extract Markdown & Outbound Links
            Connector-->>Pipeline: Return RawDocument + Outbound Links

            Note over Pipeline, DB: Immediate DB Storage On-The-Fly
            Pipeline->>Processor: processAndIndexDocument(document)
            Processor->>DB: saveDocument -> raw_documents table
            Processor->>DB: upsertChunk -> document_chunks table
            Processor->>DB: fuseKnowledge -> entities & relationships tables
            Processor->>DB: linkEntityChunk -> entity_chunks table

            Note over Pipeline: Immediate Memory Reclamation
            Pipeline->>Pipeline: Discard RawDocument & HTML body (freed by GC)
            Pipeline->>Pipeline: Push new outbound links to Crawl Queue

            opt Every 10 pages OR crawl completion
                Pipeline->>DB: Save sync checkpoint to sync_checkpoints table
            end
        end
    end
```

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
Command: `npm run format:check`
```text
Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking
Command: `npm run typecheck`
```text
> typecheck
> tsc --noEmit
(zero errors)
```

### 3.3 Linter Verification
Command: `npm run lint`
```text
> lint
> eslint src/ test/
(zero errors, zero warnings)
```

### 3.4 Automated Test Suite
Command: `npm test`
```text
ℹ tests 129
ℹ suites 48
ℹ pass 129
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
Including tests:
- `should crawl on the fly emitting documents and extracting links without retaining bodies in cache`
- `should handle HTTP 304 Not Modified and skip document body processing when cursor is fresh`
- `should recursively crawl internal links from seedUrls matching includePatterns`

### 3.5 Golem WASM Component Build
Command: `npm run build`
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    ...
    Writing pre-initialized component ...
Done! Input: 13147.3 KB, Output: 40166.1 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```

---

## 4. Conclusion

The on-the-fly web ingestion pipeline and minimal memory architecture are fully implemented, verified with comprehensive tests, and compiled into the Golem component bundle.
