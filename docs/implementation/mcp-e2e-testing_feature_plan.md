# Feature Plan: End-to-End Testing for MCP Gateway

- **Feature ID / Slug**: `mcp-e2e-testing`
- **Date**: 2026-09-18
- **Status**: Draft

---

## 1. Overview & Goals

The Golem Knowledge Graph Service exposes `KnowledgeAccessAgent` as an MCP server with Streamable HTTP transport on port `9007` (`http://localhost:9007/mcp`), configured in `golem.yaml` under `mcp.deployments`. While unit tests verify this manifest configuration statically, the end-to-end test suite (`npm run test:e2e`) currently only tests the HTTP REST API (`http://localhost:9006/api/...`).

### Goals
- Extend [`test/e2e/e2e-client.ts`](../../test/e2e/e2e-client.ts) with MCP client methods:
  - `mcpRequest<T>(method: string, params?: unknown): Promise<T>`
  - `mcpInitialize(): Promise<McpInitializeResult>`
  - `mcpListTools(): Promise<McpToolsListResult>`
  - `mcpCallTool(name: string, args?: Record<string, unknown>): Promise<McpCallToolResult>`
- Add **Suite 7: Model Context Protocol (MCP) Streamable HTTP Invocations** to [`test/e2e/full-pipeline.e2e.test.ts`](../../test/e2e/full-pipeline.e2e.test.ts):
  - MCP session initialization and capability handshake (`initialize`, `notifications/initialized`).
  - Dynamic tool discovery (`tools/list`), asserting `KnowledgeAccessAgent-search`, `KnowledgeAccessAgent-ask`, and `KnowledgeAccessAgent-getOverview` are properly exposed with input schemas.
  - MCP tool call execution (`tools/call`) for `KnowledgeAccessAgent-search`, validating ranked hybrid/keyword results returned through MCP protocol.
  - MCP tool call execution (`tools/call`) for `KnowledgeAccessAgent-ask`, validating synthesis results with citations.
- Update [`run_e2e_test.sh`](../../run_e2e_test.sh) to export `GOLEM_MCP_URL` and wait for MCP Gateway readiness.
- Update [`README.md`](../../README.md) to document MCP testing in the E2E test suite.

### Non-Goals
- Modifying `KnowledgeAccessAgent` source code (it already exposes all necessary methods).
- Modifying `golem.yaml` (MCP is already enabled for local and test on port 9007).

---

## 2. Architecture & Technical Design

### MCP Streamable HTTP Protocol
Golem's MCP implementation follows the standard Model Context Protocol over Streamable HTTP:
- **Endpoint**: `http://localhost:9007/mcp`
- **Transport**: HTTP POST with JSON-RPC 2.0 payloads (`Content-Type: application/json`, `Accept: application/json, text/event-stream`).
- **Initialization**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "golem-kgs-e2e", "version": "1.0.0" }
    }
  }
  ```
- **Initialized Notification**:
  ```json
  {
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  }
  ```
- **Listing Tools**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }
  ```
- **Calling Tools**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "KnowledgeAccessAgent-search",
      "arguments": {
        "query": "Golem",
        "limit": 3,
        "searchType": "keyword"
      }
    }
  }
  ```

---

## 3. Proposed Changes & File Impact

| Action | File Path | Description |
| :--- | :--- | :--- |
| `[MODIFY]` | [`test/e2e/e2e-client.ts`](../../test/e2e/e2e-client.ts) | Add `mcpUrl`, JSON-RPC 2.0 client helpers (`mcpRequest`, `mcpInitialize`, `mcpListTools`, `mcpCallTool`), and MCP response types |
| `[MODIFY]` | [`test/e2e/full-pipeline.e2e.test.ts`](../../test/e2e/full-pipeline.e2e.test.ts) | Add Suite 7 verifying MCP handshake, tools discovery, and tool invocations |
| `[MODIFY]` | [`run_e2e_test.sh`](../../run_e2e_test.sh) | Export `GOLEM_MCP_URL` and wait for MCP Gateway readiness |
| `[MODIFY]` | [`README.md`](../../README.md) | Update E2E test suite description to include Suite 7: Model Context Protocol (MCP) |

---

## 4. Verification Plan

### Automated Checks
```bash
npm run format:check # Prettier compliance
npm run typecheck    # TypeScript compiler (tsc --noEmit)
npm run lint         # ESLint verification
npm test             # Automated unit & integration tests
./run_e2e_test.sh    # Full containerized E2E test run exercising all 7 suites
```

---

## 5. Risks & Open Questions

- **Streamable HTTP Response Format**: Golem may return either a standard JSON-RPC response (`application/json`) or an SSE stream (`text/event-stream`). The client will handle standard JSON response bodies with fallback handling for event streams if needed.
