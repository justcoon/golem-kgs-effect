# Feature Implementation Walkthrough: MCP Configuration for Knowledge Access Agent

- **Feature ID / Slug**: `access-agent-mcp`
- **Date**: 2026-09-10
- **Status**: Ready for Review

---

## 1. Executive Summary

We have configured Model Context Protocol (MCP) server support for `KnowledgeAccessAgent`. This enables external AI tools (Claude Desktop, Cursor, MCP Inspector, etc.) to discover and interact with the Knowledge Graph System directly via MCP tools and resources using Golem's native Streamable HTTP transport on port 9007.

To enhance tool selection, clarity, and schema documentation for LLMs, we also added descriptive `promptHint` annotations to the agent and all 11 methods.

---

## 2. Changes Implemented

### File Modifications

| Action | File Path | Summary of Changes |
| :--- | :--- | :--- |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml) | Added root-level `mcp.deployments.local` section with domain `localhost:9007` exposing `KnowledgeAccessAgent: {}`. |
| `[MODIFY]` | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts) | Added top-level and method-level `promptHint` metadata across all 11 methods for optimal tool/resource selection; dynamically derived `supportedSources` from `SourceTypeSchema.literals` (now returning `["s3", "web"]` instead of hardcoded `["s3"]`). |
| `[MODIFY]` | [`test/http-gateway.test.ts`](../../test/http-gateway.test.ts) | Added automated test verifying `mcp.deployments.local` in `golem.yaml` with port 9007 and `KnowledgeAccessAgent`. |

---

## 3. MCP Mapping Details

| Agent Method | MCP Type | MCP Identifier | Prompt Hint |
|---|---|---|---|
| `search` | Tool | `KnowledgeAccessAgent-search` | Search ingested documents using hybrid, semantic vector, or keyword search |
| `searchEntities` | Tool | `KnowledgeAccessAgent-searchEntities` | Search knowledge graph entities by name, alias, or keyword |
| `getTopEntities` | Tool | `KnowledgeAccessAgent-getTopEntities` | List top connected hub entities in the knowledge graph sorted by connectivity degree |
| `getNeighborhood` | Tool | `KnowledgeAccessAgent-getNeighborhood` | Traverse and explore relationships and neighboring entities around an entity |
| `getEntity` | Tool | `KnowledgeAccessAgent-getEntity` | Look up an entity by its exact ID |
| `getEntityDocuments` | Tool | `KnowledgeAccessAgent-getEntityDocuments` | Get documents associated with or mentioning an entity |
| `getDocument` | Tool | `KnowledgeAccessAgent-getDocument` | Retrieve raw content and metadata for a document by its ID |
| `graphRag` | Tool | `KnowledgeAccessAgent-graphRag` | Execute GraphRAG retrieval returning structured context and synthesized prompt |
| `findPaths` | Tool | `KnowledgeAccessAgent-findPaths` | Find relationship paths connecting two entities in the graph |
| `ask` | Tool | `KnowledgeAccessAgent-ask` | Ask a natural language question to get a synthesized answer with source citations |
| `getOverview` | Resource | `KnowledgeAccessAgent-getOverview` | Retrieve knowledge base overview statistics including counts of documents, chunks, entities, and relations |

---

## 4. Verification & Validation Results

### 4.1 Code Formatting
```bash
npm run format:check
```
**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 4.2 Type Checking
```bash
npm run typecheck
```
**Result**:
```text
> tsc --noEmit
Passed with 0 errors.
```

### 4.3 Linting
```bash
npm run lint
```
**Result**:
```text
> eslint src/ test/
Passed with 0 errors.
```

### 4.4 Automated Unit Tests
```bash
npm test
```
**Result**:
```text
ℹ tests 119
ℹ suites 46
ℹ pass 119
ℹ fail 0
```

### 4.5 Golem WASM Component Build
```bash
npm run build # golem build --yes
```
**Result**:
```text
Selecting components
  Found components: golem-kgs-effect:effect-main
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'tsc ...'
    Executing external command 'rollup ...'
    Injecting JS module ... into QuickJS WASM
    Pre-initializing JS component ...
Done! Input: 12651.5 KB, Output: 36865.6 KB
Adding metadata to components
Finished building [OK]
```
