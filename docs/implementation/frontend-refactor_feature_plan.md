# Feature Plan: Refactor Frontend for Golem Knowledge Graph & GraphRAG (User-Facing)

- **Feature ID / Slug**: `frontend-refactor`
- **Date**: 2026-09-07
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

The `frontend/` directory currently contains a legacy Vue 3 prototype built for an older RAG project with obsolete endpoints (`/api/search`, `/api/search/similar`, `/api/documents/:id`).

This feature refactors `frontend/` into a modern, high-aesthetic, user-facing Web UI built specifically for **Golem Knowledge Graph Service (`golem-kgs-effect`)**. In this iteration, the interface focuses exclusively on **user-facing search, discovery, and question-answering capabilities** (omitting the administrative Ingestion & Coordinator dashboard):

1. **GraphRAG Q&A Interface** (`/api/knowledge/ask`): Natural language question answering with synthesized answers, confidence scoring, grounded entity tags, relationship badges, and interactive citations.
2. **Hybrid / Vector / Keyword Search** (`/api/knowledge/search`): Multi-modal chunk retrieval with score displays, source/namespace badges, and rich metadata.
3. **Interactive Knowledge Graph Explorer** (`/api/knowledge/neighborhood`, `/api/knowledge/paths`, `/api/knowledge/entities/:id`): Visual interactive node-link graph with zoom, pan, entity details drawer, and multi-hop path finding between entities.
4. **Document Inspector Modal** (`/api/knowledge/documents/:id`): Full document viewer with Markdown rendering, metadata chips, and entity cross-navigation.
5. **Knowledge Base Stats Bar** (`/api/knowledge/overview`): Read-only statistics in the header showing total documents, chunks, entities, edges, and last synchronized timestamp.

---

## 2. Architecture & API Surface

### 2.1 Backend HTTP Routing & Proxy Configuration
In `frontend/vite.config.js`, the dev server proxies `/api` requests to `http://localhost:9006` without stripping `/api`, routing directly to `KnowledgeAccessAgent`:
- `/api/knowledge/*` -> `KnowledgeAccessAgent`

### 2.2 Frontend Application Architecture
```
frontend/src/
├── assets/
│   └── styles/
├── types/
│   └── api.ts             # Complete TypeScript interfaces matching KnowledgeAccessAgent schemas
├── services/
│   └── api.ts             # Typed API client for all knowledge routes
├── components/
│   ├── DocumentModal.vue  # Full document viewer with markdown formatting & metadata
│   ├── EntityDrawer.vue   # Detailed slide-out drawer for inspected entities
│   └── GraphCanvas.vue    # Interactive SVG node-link graph visualizer (zoom, pan, drag)
├── views/
│   ├── AskView.vue        # GraphRAG Question Answering view with grounded entities & citations
│   ├── SearchView.vue     # Hybrid/Vector/Keyword search view with score indicators
│   └── GraphView.vue      # Neighborhood explorer & Path finder view with GraphCanvas
├── App.vue                # Main application layout, top navigation, KB overview bar, modal orchestration
├── style.css              # Dark mode design tokens, glassmorphism, typography, and animations
└── main.js                # Vue 3 application entry point
```

---

## 3. File-by-File Changes

### 3.1 Configuration & Types
- **[MODIFY] [frontend/vite.config.js](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/vite.config.js)**:
  - Remove path rewrite so that `/api/knowledge` requests pass through to `http://localhost:9006` intact.
- **[NEW] [frontend/src/types/api.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/types/api.ts)**:
  - Define TypeScript types: `KnowledgeBaseOverview`, `SearchResultItem`, `SearchResponse`, `Citation`, `AnswerResponse`, `EntityResult`, `EdgeResult`, `NeighborhoodResponse`, `GraphPath`, `PathFindingResult`, `DocumentResult`.
- **[DELETE] [frontend/src/types/search.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/types/search.ts)**:
  - Replace obsolete search types with `frontend/src/types/api.ts`.

### 3.2 Services
- **[MODIFY] [frontend/src/services/api.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/services/api.ts)**:
  - Implement typed methods for all user-facing Golem endpoints:
    - `getOverview()`: `GET /api/knowledge/overview`
    - `search(query, limit, searchType)`: `POST /api/knowledge/search`
    - `ask(query, topK, maxHops, generateAnswer)`: `POST /api/knowledge/ask`
    - `getEntity(id)`: `GET /api/knowledge/entities/{id}`
    - `getDocument(id)`: `GET /api/knowledge/documents/{id}`
    - `getNeighborhood(entityId, maxDepth, relationTypes, minConfidence)`: `POST /api/knowledge/neighborhood`
    - `findPaths(sourceEntityId, targetEntityId, maxDepth, relationTypes, direction)`: `POST /api/knowledge/paths`

### 3.3 Components & Views
- **[NEW] [frontend/src/components/GraphCanvas.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/components/GraphCanvas.vue)**:
  - Interactive SVG-based graph visualization component supporting dynamic layout, node drag, mouse pan/zoom, edge labels, relation styling, and node click selection.
- **[NEW] [frontend/src/components/EntityDrawer.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/components/EntityDrawer.vue)**:
  - Drawer displaying entity details, entity type, description, properties, metadata, and quick action to explore neighborhood.
- **[MODIFY] [frontend/src/components/DocumentModal.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/components/DocumentModal.vue)**:
  - Update schema bindings to match `DocumentResult` (`title`, `content`, `namespace`, `source`, `tags`, `sizeBytes`, `createdAt`, `updatedAt`).
- **[DELETE] [frontend/src/components/SearchBar.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/components/SearchBar.vue)** & **[DELETE] [frontend/src/components/ResultCard.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/components/ResultCard.vue)**:
  - Replaced by dedicated views `SearchView.vue` and `AskView.vue`.
- **[NEW] [frontend/src/views/AskView.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/AskView.vue)**:
  - GraphRAG natural language Q&A interface with query input, synthesized markdown answer, confidence pill, grounded entities chips, and clickable citations.
- **[NEW] [frontend/src/views/SearchView.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/SearchView.vue)**:
  - Hybrid / vector / keyword search with search type toggle, limit selector, score visual indicators, chunk content display, and document inspect button.
- **[NEW] [frontend/src/views/GraphView.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/views/GraphView.vue)**:
  - Entity neighborhood visualizer + Multi-hop Path Finder between entities with `GraphCanvas.vue` integration.
- **[MODIFY] [frontend/src/App.vue](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/App.vue)**:
  - Modern header with live knowledge base stats (Documents, Chunks, Entities, Edges, Last Sync), tab switcher (`Ask (GraphRAG)`, `Search`, `Graph Explorer`), active tab render, and global DocumentModal / EntityDrawer integration.
- **[MODIFY] [frontend/src/style.css](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/src/style.css)**:
  - Curated sleek dark mode design system (deep slate `#0b0f19`, glass cards, glowing badges, refined typography, smooth transitions).
- **[MODIFY] [frontend/index.html](file:///Users/coon/workspace-zv/git/golem-kgs-effect/frontend/index.html)**:
  - Updated page title to "Golem Knowledge Graph & GraphRAG" and Google Fonts Inter link.

---

## 4. Verification Plan

### 4.1 Automated Validation
1. **Frontend Production Build**:
   ```bash
   cd frontend && npm run build
   ```
   Must succeed with zero TypeScript or packaging errors.
2. **Backend Integrity**:
   ```bash
   npm run typecheck && npm test
   ```
   Ensures no backend code or types were broken.

### 4.2 Manual / End-to-End Verification
- Test all API calls with the Vite development server running (`cd frontend && npm run dev`).
- Verify tab switching between Ask, Search, and Graph Explorer views.
- Test GraphRAG Q&A flow with sample questions and verify citations modal.
- Test Search with hybrid, vector, and keyword options.
- Test Graph visualization with entity neighborhood expansion and path finding.
- Test DocumentModal preview.
