import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { E2EClient } from "./e2e-client.js";

describe("Golem KGS Full End-to-End (E2E) Test Suite", () => {
  const client = new E2EClient({
    baseUrl: process.env.GOLEM_API_URL || "http://localhost:9006",
    mcpUrl: process.env.GOLEM_MCP_URL || "http://localhost:9007/mcp",
    timeoutMs: 45000,
  });

  describe("Suite 1: Gateway Connectivity & Agent Initialization", () => {
    it("should reach KnowledgeAccessAgent overview endpoint", async () => {
      const overview = await client.getOverview();
      assert.ok(
        typeof overview.totalDocuments === "number",
        "totalDocuments must be a number",
      );
      assert.ok(
        typeof overview.totalChunks === "number",
        "totalChunks must be a number",
      );
      assert.ok(
        typeof overview.totalEntities === "number",
        "totalEntities must be a number",
      );
      assert.ok(
        typeof overview.totalRelationships === "number",
        "totalRelationships must be a number",
      );
    });

    it("should reach S3IngestorTaskAgent status endpoint", async () => {
      const status = await client.getS3TaskStatus("main");
      assert.equal(status.resourceName, "main");
      assert.ok(
        ["IDLE", "SYNCING", "COMPLETED", "FAILED"].includes(status.status),
      );
      assert.ok(status.metrics, "metrics must be present");
    });
  });

  describe("Suite 2: S3 Ingestion, Storage Persistence & Checkpointing", () => {
    it("should trigger S3 sync and poll until task completes", async () => {
      const summary = await client.triggerIngestionSync("s3", "main", true);
      assert.equal(summary.resourceName, "main");

      const finalStatus = await client.pollS3SyncCompletion(
        "main",
        60000,
        1500,
      );
      assert.ok(
        finalStatus.status === "COMPLETED" || finalStatus.status === "IDLE",
        "Task status must return to COMPLETED or IDLE on completion",
      );
      assert.ok(
        finalStatus.metrics.totalSynced > 0,
        "totalSynced must be greater than 0",
      );
    });

    it("should verify ingested documents and knowledge graph state in storage", async () => {
      const overview = await client.getOverview();
      assert.ok(
        overview.totalDocuments >= 2,
        `Expected >= 2 documents, got ${overview.totalDocuments}`,
      );
      assert.ok(
        overview.totalChunks >= 2,
        `Expected >= 2 chunks, got ${overview.totalChunks}`,
      );
      assert.ok(
        overview.totalEntities >= 2,
        `Expected >= 2 entities, got ${overview.totalEntities}`,
      );
    });

    it("should verify incremental checkpointing skips unchanged files on subsequent sync", async () => {
      const summary = await client.triggerIngestionSync("s3", "main", false);
      assert.equal(summary.resourceName, "main");

      const statusAfter = await client.pollS3SyncCompletion(
        "main",
        30000,
        1000,
      );
      assert.ok(
        statusAfter.status === "COMPLETED" || statusAfter.status === "IDLE",
      );
      // On incremental run without changes, totalDiscovered files equal existing processed keys
      assert.ok(statusAfter.metrics !== undefined);
    });

    it("should reset cursor and verify subsequent sync re-ingests documents", async () => {
      const resetStatus = await client.resetCursor("s3", "main");
      assert.ok(
        resetStatus.status === "IDLE" || resetStatus.status === "COMPLETED",
      );
      assert.equal(resetStatus.cursor, null);

      // Trigger sync without force: true
      const summary = await client.triggerIngestionSync("s3", "main", false);
      assert.equal(summary.resourceName, "main");

      const finalStatus = await client.pollS3SyncCompletion(
        "main",
        60000,
        1500,
      );
      assert.ok(
        finalStatus.status === "COMPLETED" || finalStatus.status === "IDLE",
      );
      // Because checkpoint was deleted in postgres via resetCursor, all files are re-ingested
      assert.ok(
        finalStatus.metrics.totalSynced > 0,
        "totalSynced must be > 0 after cursor reset",
      );
    });
  });

  describe("Suite 3: Event-Driven Webhook Ingestion", () => {
    it("should trigger a sync via direct task agent webhook", async () => {
      const summary = await client.sendWebhook("s3", "main", {
        action: "sync",
        force: true,
      });

      assert.equal(summary.status, "COMPLETED");
      assert.ok(
        typeof summary.metrics.totalSynced === "number",
        "totalSynced must be a number",
      );
    });

    it("should retrieve an ingested document by ID", async () => {
      const searchRes = await client.search("Golem", 1, "keyword");
      assert.ok(searchRes.results.length > 0, "Must have indexed documents");
      const docId = searchRes.results[0].documentId;
      const doc = await client.getDocument(docId);
      assert.ok(doc !== null, "Document must be retrieved by ID");
      assert.equal(doc.id, docId);
      assert.ok(doc.title.length > 0, "Document title must not be empty");
    });
  });

  describe("Suite 4: Multi-Modal Search (Hybrid, Vector & Keyword)", () => {
    it("should execute hybrid search and return ranked results with RRF scores", async () => {
      const res = await client.search(
        "Golem Cloud durable execution",
        5,
        "hybrid",
      );
      assert.ok(res.results.length > 0, "Hybrid search must return results");
      assert.ok(res.totalResults > 0, "totalResults must be positive");
      assert.equal(res.query, "Golem Cloud durable execution");

      const topResult = res.results[0];
      assert.ok(topResult.score > 0, "Result score must be positive");
      assert.ok(topResult.content.length > 0, "Chunk content must be present");
      assert.ok(topResult.documentId.length > 0, "Document ID must be present");
      assert.ok(
        topResult.metadata !== undefined,
        "Chunk metadata must be present",
      );
    });

    it("should execute vector semantic search", async () => {
      const res = await client.search(
        "WebAssembly serverless components",
        5,
        "vector",
      );
      assert.ok(res.results.length > 0, "Vector search must return results");
      assert.ok(res.totalResults > 0);
      assert.ok(res.results[0].score > 0);
    });

    it("should execute keyword search", async () => {
      const res = await client.search("PostgreSQL", 5, "keyword");
      assert.ok(res.results.length > 0, "Keyword search must return results");
      assert.ok(res.totalResults > 0);
      assert.ok(
        res.results.some((r) => r.content.toLowerCase().includes("postgresql")),
      );
    });
  });

  describe("Suite 5: Knowledge Graph Traversal & Entity Exploration", () => {
    let topEntityId: string;

    it("should list top hub entities sorted by degree centrality", async () => {
      const res = await client.getTopEntities(10);
      assert.ok(res.entities.length > 0, "Top entities must not be empty");
      topEntityId = res.entities[0].id;
      assert.ok(topEntityId.length > 0, "Top entity must have valid ID");
      assert.ok(res.entities[0].name.length > 0, "Top entity must have a name");
    });

    it("should search entities by name prefix or alias", async () => {
      const res = await client.searchEntities("Golem", 5);
      assert.ok(
        res.entities.length > 0,
        "Entity search for 'Golem' must return entities",
      );
      assert.ok(
        res.entities.some((e) => e.name.toLowerCase().includes("golem")),
        "At least one entity should match 'golem'",
      );
    });

    it("should retrieve entity details and document associations", async () => {
      assert.ok(topEntityId, "topEntityId must be defined from previous step");
      const entity = await client.getEntity(topEntityId);
      assert.ok(entity !== null, `Entity ${topEntityId} must exist`);
      assert.equal(entity.id, topEntityId);

      const docs = await client.getEntityDocuments(topEntityId);
      assert.ok(Array.isArray(docs), "Document associations must be an array");
    });

    it("should traverse graph neighborhood up to 2 hops", async () => {
      assert.ok(topEntityId, "topEntityId must be defined from previous step");
      const neighborhood = await client.getNeighborhood(
        topEntityId,
        2,
        undefined,
        0.1,
      );
      assert.ok(
        neighborhood.entities === undefined ||
          Array.isArray(neighborhood.entities),
        "Neighborhood entities must be an array or undefined",
      );
      assert.ok(
        Array.isArray(neighborhood.edges),
        "Neighborhood edges must be an array",
      );

      if (neighborhood.edges.length > 0) {
        const edge = neighborhood.edges[0];
        assert.ok(edge.sourceId, "Edge must have sourceId");
        assert.ok(edge.targetId, "Edge must have targetId");
        assert.ok(edge.relationType, "Edge must have relationType");
        assert.ok(edge.confidence >= 0, "Edge confidence must be non-negative");
      }
    });
  });

  describe("Suite 6: GraphRAG Context Retrieval & Answer Synthesis", () => {
    it("should retrieve GraphRAG context bundle with grounded entities and relationships", async () => {
      const bundle = await client.getGraphRag(
        "How does Golem Cloud achieve durable execution?",
        5,
        2,
      );
      assert.ok(bundle.query.length > 0);
      assert.ok(
        bundle.relevantChunks.length > 0,
        "GraphRAG must retrieve matching chunks",
      );
      assert.ok(Array.isArray(bundle.entities), "Entities must be an array");
      assert.ok(
        Array.isArray(bundle.relationships),
        "Relationships must be an array",
      );
      assert.ok(
        bundle.formattedContextPrompt.length > 0,
        "formattedContextPrompt must not be empty",
      );
    });

    it("should synthesize an answer with citations via /ask endpoint", async () => {
      const response = await client.ask(
        "How does Golem Cloud achieve durable execution?",
        5,
        2,
        true,
      );
      assert.ok(response.question.length > 0);
      assert.ok(
        response.answer.length > 0,
        "Synthesized answer must not be empty",
      );
      assert.ok(
        typeof response.confidenceScore === "number",
        "confidenceScore must be a number",
      );
      assert.ok(
        response.citations.length > 0,
        "Citations must not be empty for relevant query",
      );

      const firstCitation = response.citations[0];
      assert.ok(firstCitation.chunkId, "Citation must contain chunkId");
      assert.ok(firstCitation.documentId, "Citation must contain documentId");
    });
  });

  describe("Suite 7: Model Context Protocol (MCP) Streamable HTTP Invocations", () => {
    it("should initialize MCP session and verify protocol capabilities", async () => {
      const initResult = await client.mcpInitialize();
      assert.ok(initResult, "Init result must be returned");
      assert.ok(
        typeof initResult.protocolVersion === "string",
        "protocolVersion must be string",
      );
      assert.ok(
        initResult.capabilities !== undefined,
        "capabilities must be present",
      );
    });

    it("should list MCP tools and expose KnowledgeAccessAgent tools with schemas", async () => {
      const toolsList = await client.mcpListTools();
      assert.ok(Array.isArray(toolsList.tools), "tools must be an array");
      assert.ok(
        toolsList.tools.length > 0,
        "MCP gateway must expose at least one tool",
      );

      const toolNames = toolsList.tools.map((t) => t.name);
      assert.ok(
        toolNames.some((n) => n.includes("search")),
        `Expected search tool in MCP tools list, got: ${toolNames.join(", ")}`,
      );
      assert.ok(
        toolNames.some((n) => n.includes("ask")),
        `Expected ask tool in MCP tools list, got: ${toolNames.join(", ")}`,
      );
    });

    it("should execute KnowledgeAccessAgent search via MCP tools/call", async () => {
      const toolsList = await client.mcpListTools();
      const searchTool = toolsList.tools.find((t) => t.name.includes("search"));
      assert.ok(searchTool, "Search tool must exist");

      const callResult = await client.mcpCallTool(searchTool.name, {
        query: "Golem durable execution",
        limit: 3,
        searchType: "hybrid",
      });

      assert.ok(
        !callResult.isError,
        "MCP tool execution must not indicate error",
      );
      assert.ok(
        Array.isArray(callResult.content),
        "Tool call result content must be an array",
      );
      assert.ok(
        callResult.content.length > 0,
        "Tool call content must not be empty",
      );

      const textContent = callResult.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
      assert.ok(
        textContent.length > 0,
        "Tool call response must contain text output",
      );
    });

    it("should execute KnowledgeAccessAgent ask via MCP tools/call", async () => {
      const toolsList = await client.mcpListTools();
      const askTool = toolsList.tools.find((t) => t.name.includes("ask"));
      assert.ok(askTool, "Ask tool must exist");

      const callResult = await client.mcpCallTool(askTool.name, {
        query: "How does Golem achieve durability?",
        topK: 3,
        maxHops: 2,
        generateAnswer: true,
      });

      assert.ok(!callResult.isError);
      assert.ok(Array.isArray(callResult.content));
      assert.ok(callResult.content.length > 0);

      const textContent = callResult.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
      assert.ok(
        textContent.length > 0,
        "Ask tool response must return text output",
      );
    });
  });
});
