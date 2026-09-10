# Feature Plan: Entity Related Documents

- **Feature ID / Slug**: `entity-related-documents`
- **Date**: 2026-09-10
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Currently, when viewing an entity in the Knowledge Graph frontend drawer (`EntityDrawer.vue`), only a single initial document (`extractedFromDoc`) is displayed from `entity.properties.extractedFromDocument`.

In a real Knowledge Graph System (KGS), canonical entities (e.g. `Golem Cloud`, `QuickJS`, `PostgreSQL`, `Effect-TS`) span multiple ingested documents, web pages, and files. Users need the ability to explore **all** documents and sources that reference or discuss an entity, preview those documents directly, and navigate to live web pages when applicable.

To ensure fast query performance and minimal network overhead, the endpoint returns lightweight **`DocumentSummary`** projections (omitting the heavy `content` and `metadata` blobs). Full document content is fetched on demand only when the user clicks "View Preview".

### Goals

1. **Lightweight Repository Method in `EntityRepository`**: Implement `getRelatedDocuments: (entityId: string, limit?: number) => Effect.Effect<ReadonlyArray<DocumentSummary>, SqlError>` directly in `EntityRepository` with a single unified PostgreSQL query selecting pure relational columns (`id`, `title`, `source`, `resource_name`, `source_key`, `size_bytes`, `created_at`, `updated_at`) and omitting `content` and `metadata`.
2. **Junction Persistence**: Ensure the existing `entity_chunks` relational junction table is populated during ingestion in both `S3IngestorTaskAgent` and `WebIngestorTaskAgent` via `chunkRepo.linkEntityChunk`.
3. **Properties Accumulation**: During entity resolution in `EntityResolver.fuseKnowledge`, maintain an accumulated unique list of document IDs in `properties.documents: string[]`.
4. **Agent API Endpoint**: Expose `GET /api/knowledge/entities/{id}/documents` on `KnowledgeAccessAgent` returning `ReadonlyArray<DocumentSummary>`, delegating to `entityRepo.getRelatedDocuments(id)`.
5. **Frontend Service**: Add `getEntityDocuments(entityId)` to `ApiService` in `frontend/src/services/api.ts`.
6. **Interactive UI in EntityDrawer**:
   - Upgrade the "Source Document" section into an interactive **"Related Documents"** list (`📚 Related Documents (N)`).
   - Display each related document with:
     - Title, ID, and source badge (`🌐 Web`, `📄 S3`, or `📋 Doc`).
     - "Origin" indicator highlighting the initial extraction document.
     - Direct "View Preview" button invoking `openDocument(doc.id)` (which fetches full document content on demand).
     - Direct "🌐 Visit Page ↗" link using `sourceKey` for web pages (opens in a new tab).
   - Provide clean loading and empty states, with graceful fallback to `properties.documents` / `extractedFromDoc`.

### Non-Goals

- Modifying the underlying database schema (`entity_chunks` and `documents` tables already support this model).
- Returning full document `content` in the list query (full text is fetched on demand when previewing).

---

## 2. Architecture & Technical Design

### Data Flow & Linking Model

```mermaid
flowchart LR
    subgraph Ingestion
        Doc[RawDocument] --> Chunks[Chunks]
        Chunks --> Extractor[ExtractionService]
        Extractor --> Entities[Extracted Entities]
        Entities --> Resolver[EntityResolver]
        Entities -. linkEntityChunk .-> EntityChunks[(entity_chunks)]
    end

    subgraph Storage & Access
        EntityChunks --> EntityRepo[EntityRepository: getRelatedDocuments]
        Resolver -. properties.documents .-> EntityRepo
        EntityRepo --> AccessAgent[KnowledgeAccessAgent: getEntityDocuments]
        AccessAgent --> APIRoute["GET /api/knowledge/entities/{id}/documents"]
    end

    subgraph UI
        APIRoute --> ApiService[frontend ApiService]
        ApiService --> EntityDrawer[EntityDrawer.vue]
        EntityDrawer -- On Demand Preview --> DocModal[DocumentModal.vue]
        EntityDrawer -- Direct SourceKey URL --> ExternalWeb[Live Web Navigation]
    end
```

### Key Decisions

1. **Lightweight SQL Projection in `EntityRepository`**:
   `EntityRepository.getRelatedDocuments(entityId)` executes a single PostgreSQL query that selects only essential columns, omitting `content` and `metadata`:
   ```sql
   SELECT DISTINCT 
       d.id, 
       d.title, 
       d.source, 
       d.resource_name, 
       d.source_key, 
       d.size_bytes, 
       d.created_at, 
       d.updated_at
   FROM documents d
   WHERE d.id IN (
       -- 1. Documents linked via entity_chunks junction table
       SELECT c.document_id
       FROM entity_chunks ec
       JOIN chunks c ON ec.chunk_id = c.id
       WHERE ec.entity_id = ${entityId}

       UNION

       -- 2. Initial document recorded in properties
       SELECT (e.properties->>'extractedFromDocument')::varchar
       FROM entities e
       WHERE e.id = ${entityId} 
         AND e.properties ? 'extractedFromDocument'

       UNION

       -- 3. Any documents accumulated in properties.documents JSON array
       SELECT jsonb_array_elements_text(e.properties->'documents')::varchar
       FROM entities e
       WHERE e.id = ${entityId} 
         AND jsonb_typeof(e.properties->'documents') = 'array'
   )
   ORDER BY d.updated_at DESC
   LIMIT 50;
   ```
2. **First-Class `source_key` as URL**:
   The `documents` table already stores the exact URL in `source_key` for web resources. The query reads `d.source_key` directly, eliminating any need to extract JSONB `metadata->>'url'`.
3. **Clean WIT Schema**:
   ```ts
   export const DocumentSummarySchema = Schema.Struct({
     id: Schema.String,
     title: Schema.String,
     source: Schema.String,
     resourceName: Schema.String,
     sourceKey: Schema.String,
     sizeBytes: Schema.Number,
     createdAt: Schema.String,
     updatedAt: Schema.String,
   });
   export type DocumentSummary = typeof DocumentSummarySchema.Type;
   ```
4. **On-Demand Previewing**:
   When the user clicks "View Preview", the frontend calls `openDocument(doc.id)`, which invokes the existing `GET /documents/{id}` to fetch the full markdown and render the preview modal.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                    | Description                                                                                                                           |
| :--------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/domain/provenance.ts`](../../src/domain/provenance.ts)                 | Add `DocumentSummary` domain interface.                                                                                               |
| `[MODIFY]` | [`src/agents/types.ts`](../../src/agents/types.ts)                           | Add `DocumentSummarySchema` and type.                                                                                                 |
| `[MODIFY]` | [`src/storage/repository-tags.ts`](../../src/storage/repository-tags.ts)     | Add `getRelatedDocuments` to `EntityRepositoryShape`.                                                                                 |
| `[MODIFY]` | [`src/storage/entity-repository.ts`](../../src/storage/entity-repository.ts) | Implement `getRelatedDocuments(entityId)` selecting lightweight columns (`content` & `metadata` omitted).                            |
| `[MODIFY]` | [`src/pipeline/entity-resolver.ts`](../../src/pipeline/entity-resolver.ts)   | Accumulate `documents: string[]` in entity properties during resolution and deduplication.                                            |
| `[MODIFY]` | [`src/pipeline/web-ingestion-pipeline.ts`](../../src/pipeline/web-ingestion-pipeline.ts) | Call `chunkRepo.linkEntityChunk` for extracted entities to populate `entity_chunks`.                                                 |
| `[MODIFY]` | [`src/pipeline/s3-ingestion-pipeline.ts`](../../src/pipeline/s3-ingestion-pipeline.ts)   | Call `chunkRepo.linkEntityChunk` for extracted entities to populate `entity_chunks`.                                                 |
| `[MODIFY]` | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)             | Add `getEntityDocuments` method to `KnowledgeAccessAgent` mapped to `GET /entities/{id}/documents` returning `DocumentSummarySchema[]`.|
| `[MODIFY]` | [`test/access-agent.test.ts`](../../test/access-agent.test.ts)               | Add tests for `getEntityDocuments` contract and routing.                                                                              |
| `[MODIFY]` | [`frontend/src/types/api.ts`](../../frontend/src/types/api.ts)               | Add `DocumentSummary` interface.                                                                                                      |
| `[MODIFY]` | [`frontend/src/services/api.ts`](../../frontend/src/services/api.ts)         | Add `getEntityDocuments(entityId): Promise<DocumentSummary[]>` to `ApiService`.                                                      |
| `[MODIFY]` | [`frontend/src/components/EntityDrawer.vue`](../../frontend/src/components/EntityDrawer.vue) | Redesign source document section into interactive Related Documents list with badges, previews, web links, and loading state.        |

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
- **Automated Backend Tests**:
  ```bash
  npm run test
  ```
- **Frontend Vite Build**:
  ```bash
  npm --prefix frontend run build
  ```
- **Golem Component Build & Deploy Plan**:
  ```bash
  npm run build
  eval $(grep -v '^#' .env | grep -v '^$' | sed 's/^/export /') && golem deploy --plan --yes
  ```

### Manual / UI Verification
1. Run local frontend dev server or inspect built bundle.
2. Select an entity that appears in multiple documents or documentation web pages.
3. Confirm `EntityDrawer` renders the "Related Documents" list with accurate count, titles, and source badges.
4. Verify clicking "View Preview" opens `DocumentModal` with full document content.
5. Verify clicking "Visit Page ↗" uses `sourceKey` to open the live web URL in a new browser tab.
