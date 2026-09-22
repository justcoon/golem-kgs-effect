# Feature Implementation Walkthrough: Scoped Resource Connector Layers

- **Feature ID / Slug**: `scoped-resource-connector-layers`
- **Date**: 2026-09-22
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

This feature refactored connector layer creation so that S3 and Web connector layers are strictly scoped to a specific `resourceName`.

Previously, `makeS3ConnectorLayer` and `makeWebConnectorLayer` loaded all secret configurations for every resource in the environment into each task worker's context.

With this implementation:
- `resourceName: string` is strictly required across `makeS3ConnectorLayer`, `makeWebConnectorLayer`, `makeS3TaskAgentLayer`, and `makeWebTaskAgentLayer`.
- The layer factories validate that the target resource exists in the secret store, failing fast with a typed `ConnectorError` during layer initialization if absent.
- The resulting `S3ResourcesConfig` and `WebResourcesConfig` services contain **only** the target configuration for that specific resource, enforcing the principle of least privilege.
- Connector layers were decoupled into [`src/agents/connector-layers.ts`](../../src/agents/connector-layers.ts) to eliminate runtime database dependencies during unit testing.
- The unused legacy helper `makeAgentPipelineLayer` was removed.
- All formatting, linting, typechecking, 149 unit/integration tests, the Golem WASM build, and the full 7-suite containerized E2E test suite succeeded cleanly.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                | Summary of Changes                                                                                     |
| :--------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `[NEW]`    | [`src/agents/connector-layers.ts`](../../src/agents/connector-layers.ts)                 | Pure connector layer factories with strict `resourceName` validation, credential isolation, and re-exported parse functions. |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                                     | Added clean, strongly-typed `parseS3Targets` and `parseWebTargets` converting `ReadonlyArray<T>` to `Record<string, T>`. |
| `[MODIFY]` | [`src/config/resources-config.ts`](../../src/config/resources-config.ts)                 | Re-exported `parseS3Targets` and `parseWebTargets` from `schema.ts`.                                  |
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts)         | Re-exported connector layers, updated task agent factories to require `resourceName`, removed unused `makeAgentPipelineLayer`. |
| `[MODIFY]` | [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts)                       | Passed `resourceName` from agent constructor to `makeS3TaskAgentLayer(config, resourceName)`.          |
| `[MODIFY]` | [`src/agents/web-task-agent.ts`](../../src/agents/web-task-agent.ts)                     | Passed `resourceName` from agent constructor to `makeWebTaskAgentLayer(config, resourceName)`.         |
| `[MODIFY]` | [`test/agents.test.ts`](../../test/agents.test.ts)                                       | Added unit tests validating fail-fast behavior and credential isolation for scoped connector layers.   |

### Key Logic & API Changes

1. **Strictly Scoped Connector Layer Factories ([`src/agents/connector-layers.ts`](../../src/agents/connector-layers.ts))**:
   ```typescript
   export const makeS3ConnectorLayer = (
     config: AppAgentConfigService,
     resourceName: string,
   ) =>
     Effect.gen(function* () {
       const resourcesVal = Redacted.value(yield* config.resources.s3.get);
       const s3Targets = parseS3Targets(resourcesVal);
       const target = s3Targets[resourceName];

       if (!target) {
         return yield* Effect.fail(
           new ConnectorError({
             connectorId: `s3_${resourceName}`,
             message: `S3 resource target '${resourceName}' is not configured in secrets`,
           }),
         );
       }

       const scopedTargets = { [resourceName]: target };
       const s3ConfigLayer = Layer.succeed(S3ResourcesConfig, {
         s3: scopedTargets,
         getS3Resource: (name: string) =>
           name === resourceName ? Option.some(target) : Option.none(),
       });

       return S3ConnectorService.Live.pipe(
         Layer.provide(s3ConfigLayer),
         Layer.provide(FetchHttpClient.layer),
       );
     });
   ```
   (Identical validation and scoping logic implemented for `makeWebConnectorLayer`).

2. **Task Agent Factories ([`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts))**:
   - `makeS3TaskAgentLayer(config: AppAgentConfigService, resourceName: string)`
   - `makeWebTaskAgentLayer(config: AppAgentConfigService, resourceName: string)`
   - Deleted unused legacy `makeAgentPipelineLayer`.

3. **Agent Implementation Binding**:
   - [`src/agents/s3-task-agent.ts`](../../src/agents/s3-task-agent.ts): `yield* makeS3TaskAgentLayer(config, resourceName)`
   - [`src/agents/web-task-agent.ts`](../../src/agents/web-task-agent.ts): `yield* makeWebTaskAgentLayer(config, resourceName)`

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
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
```bash
npm run typecheck
```
**Result**:
```text
> typecheck
> tsc --noEmit
[Exit Code 0, 0 errors]
```

### 3.3 Linter Verification
```bash
npm run lint
```
**Result**:
```text
> lint
> eslint src/ test/
[Exit Code 0, 0 problems]
```

### 3.4 Automated Unit & Integration Tests
```bash
npm test
```
**Result**:
```text
ℹ tests 149
ℹ suites 51
ℹ pass 149
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1615.230285
```

### 3.5 Golem WASM Component Build
```bash
npm run build # golem build --yes
```
**Result**:
```text
Building golem-kgs-effect:effect-main
  Injecting JS module into QuickJS WASM agent_guest.wasm
  Pre-initializing JS component (wizer-initialize)...
  Done! Input: 13666.4 KB, Output: 48460.1 KB
Adding metadata to components
Finished building [OK]
```

### 3.6 Containerized End-to-End (E2E) Test Suite
```bash
./run_e2e_test.sh
```
**Result**:
```text
[INFO] Verifying HTTP Gateway readiness on http://localhost:9006/api/knowledge/overview...
[SUCCESS] HTTP Gateway is responsive!
[INFO] Verifying MCP Gateway readiness on http://localhost:9007/mcp...
[SUCCESS] MCP Gateway is responsive!
[INFO] Executing E2E test suite...

▶ Golem KGS Full End-to-End (E2E) Test Suite
  ▶ Suite 1: Gateway Connectivity & Agent Initialization
    ✔ should reach KnowledgeAccessAgent overview endpoint
    ✔ should reach S3IngestorTaskAgent status endpoint
  ✔ Suite 1: Gateway Connectivity & Agent Initialization
  ▶ Suite 2: S3 Ingestion, Storage Persistence & Checkpointing
    ✔ should trigger S3 sync and poll until task completes
    ✔ should verify ingested documents and knowledge graph state in storage
    ✔ should verify incremental checkpointing skips unchanged files on subsequent sync
    ✔ should reset cursor and verify subsequent sync re-ingests documents
  ✔ Suite 2: S3 Ingestion, Storage Persistence & Checkpointing
  ▶ Suite 3: Event-Driven Webhook Ingestion
    ✔ should trigger a sync via direct task agent webhook
    ✔ should retrieve an ingested document by ID
  ✔ Suite 3: Event-Driven Webhook Ingestion
  ▶ Suite 4: Multi-Modal Search (Hybrid, Vector & Keyword)
    ✔ should execute hybrid search and return ranked results with RRF scores
    ✔ should execute vector semantic search
    ✔ should execute keyword search
  ✔ Suite 4: Multi-Modal Search (Hybrid, Vector & Keyword)
  ▶ Suite 5: Knowledge Graph Traversal & Entity Exploration
    ✔ should list top hub entities sorted by degree centrality
    ✔ should search entities by name prefix or alias
    ✔ should retrieve entity details and document associations
    ✔ should traverse graph neighborhood up to 2 hops
  ✔ Suite 5: Knowledge Graph Traversal & Entity Exploration
  ▶ Suite 6: GraphRAG Context Retrieval & Answer Synthesis
    ✔ should retrieve GraphRAG context bundle with grounded entities and relationships
    ✔ should synthesize an answer with citations via /ask endpoint
  ✔ Suite 6: GraphRAG Context Retrieval & Answer Synthesis
  ▶ Suite 7: Model Context Protocol (MCP) Streamable HTTP Invocations
    ✔ should initialize MCP session and verify protocol capabilities
    ✔ should list MCP tools and expose KnowledgeAccessAgent tools with schemas
    ✔ should execute KnowledgeAccessAgent search via MCP tools/call
    ✔ should execute KnowledgeAccessAgent ask via MCP tools/call
  ✔ Suite 7: Model Context Protocol (MCP) Streamable HTTP Invocations
✔ Golem KGS Full End-to-End (E2E) Test Suite
ℹ tests 21
ℹ suites 8
ℹ pass 21
ℹ fail 0
[SUCCESS] All E2E test suites passed!
[INFO] Tearing down E2E test environment...
[SUCCESS] E2E Test Run Completed Successfully!
```

---

## 4. Verification / Test Coverage

1. **Isolation Test**: Verified that an agent instance configured for `"main"` only has access to `"main"`. Invoking `createConnector("legal")` fails with `ConnectorError` even though `"legal"` is present in global secrets.
2. **Fail-Fast Test**: Verified that creating a layer for a non-existent target fails fast during layer initialization with a descriptive `ConnectorError`.
3. **Full System E2E Validation**: The deployed containerized environment successfully registered and deployed `resources.s3` and `resources.web` secrets, initialized `S3IngestorTaskAgent("main")`, synchronized documents, checkpointed state, and serviced queries through HTTP gateway and MCP gateway.

---

## 5. Sign-off / Next Steps

- All implementation and validation gates have passed.
- Ready for final user sign-off.
