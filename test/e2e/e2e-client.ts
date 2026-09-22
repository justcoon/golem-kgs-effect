import type {
  AnswerResponse,
  DocumentResult,
  DocumentSummary,
  EntityResult,
  EntitySearchResponse,
  GraphRAGContextBundle,
  KnowledgeBaseOverview,
  NeighborhoodResponse,
  SearchResponse,
  S3TaskStatusResponse,
} from "../../src/agents/types.js";

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: Record<string, unknown>;
  readonly serverInfo?: {
    readonly name?: string;
    readonly version?: string;
  };
}

export interface McpToolsListResult {
  readonly tools: ReadonlyArray<McpTool>;
  readonly nextCursor?: string;
}

export interface McpCallToolResult {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
  }>;
  readonly isError?: boolean;
}

export interface E2EClientOptions {
  readonly baseUrl?: string;
  readonly mcpUrl?: string;
  readonly timeoutMs?: number;
}

export class E2EClient {
  readonly baseUrl: string;
  readonly mcpUrl: string;
  readonly timeoutMs: number;
  private mcpRequestId = 1;
  private mcpSessionId: string | null = null;

  constructor(options: E2EClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.GOLEM_API_URL ?? "http://localhost:9006";
    this.mcpUrl =
      options.mcpUrl ??
      process.env.GOLEM_MCP_URL ??
      "http://localhost:9007/mcp";
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        data = text as unknown as T;
      }

      return { status: response.status, data };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // --- Ingestion Task & Webhook Endpoints ---

  async triggerIngestionSync(
    sourceType: "s3" | "web",
    resourceName: string,
    force = false,
  ): Promise<S3TaskStatusResponse> {
    const res = await this.request<S3TaskStatusResponse>(
      "POST",
      `/api/ingestion/${sourceType}/${encodeURIComponent(resourceName)}/sync`,
      {
        force,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `triggerIngestionSync failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getS3TaskStatus(resourceName: string): Promise<S3TaskStatusResponse> {
    const res = await this.request<S3TaskStatusResponse>(
      "GET",
      `/api/ingestion/s3/${encodeURIComponent(resourceName)}/status`,
    );
    if (res.status !== 200) {
      throw new Error(
        `getS3TaskStatus failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async resetCursor(
    sourceType: "s3" | "web",
    resourceName: string,
  ): Promise<S3TaskStatusResponse> {
    const res = await this.request<S3TaskStatusResponse>(
      "POST",
      `/api/ingestion/${sourceType}/${encodeURIComponent(resourceName)}/reset`,
    );
    if (res.status !== 200) {
      throw new Error(
        `resetCursor failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async pollS3SyncCompletion(
    resourceName: string,
    timeoutMs = 60000,
    intervalMs = 1000,
  ): Promise<S3TaskStatusResponse> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus: S3TaskStatusResponse | null = null;

    while (Date.now() < deadline) {
      const status = await this.getS3TaskStatus(resourceName);
      lastStatus = status;
      if (status.status === "IDLE" || status.status === "COMPLETED") {
        return status;
      }
      if (status.status === "FAILED") {
        throw new Error(
          `S3 ingestion task failed: ${status.errorMessage ?? "Unknown error"}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Timed out waiting for S3 sync completion after ${timeoutMs}ms. Last status: ${JSON.stringify(lastStatus)}`,
    );
  }

  // --- Knowledge Search Endpoints ---

  async search(
    query: string,
    limit = 10,
    searchType: "hybrid" | "vector" | "keyword" = "hybrid",
  ): Promise<SearchResponse> {
    const res = await this.request<SearchResponse>(
      "POST",
      "/api/knowledge/search",
      {
        query,
        limit,
        searchType,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `search failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  // --- Entity & Graph Endpoints ---

  async searchEntities(
    query?: string,
    limit = 20,
  ): Promise<EntitySearchResponse> {
    const res = await this.request<EntitySearchResponse>(
      "POST",
      "/api/knowledge/entities/search",
      {
        query,
        limit,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `searchEntities failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getTopEntities(limit = 20): Promise<EntitySearchResponse> {
    const res = await this.request<EntitySearchResponse>(
      "POST",
      "/api/knowledge/entities/top",
      {
        limit,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `getTopEntities failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getEntity(id: string): Promise<EntityResult | null> {
    const res = await this.request<EntityResult | null>(
      "GET",
      `/api/knowledge/entities/${encodeURIComponent(id)}`,
    );
    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new Error(
        `getEntity failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getEntityDocuments(id: string): Promise<DocumentSummary[]> {
    const res = await this.request<DocumentSummary[]>(
      "GET",
      `/api/knowledge/entities/${encodeURIComponent(id)}/documents`,
    );
    if (res.status !== 200) {
      throw new Error(
        `getEntityDocuments failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getDocument(id: string): Promise<DocumentResult | null> {
    const res = await this.request<DocumentResult | null>(
      "GET",
      `/api/knowledge/documents/${encodeURIComponent(id)}`,
    );
    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new Error(
        `getDocument failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getNeighborhood(
    entityId: string,
    maxDepth = 1,
    relationTypes?: string[],
    minConfidence?: number,
  ): Promise<NeighborhoodResponse> {
    const res = await this.request<NeighborhoodResponse>(
      "POST",
      "/api/knowledge/neighborhood",
      {
        entityId,
        maxDepth,
        relationTypes,
        minConfidence,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `getNeighborhood failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async getOverview(): Promise<KnowledgeBaseOverview> {
    const res = await this.request<KnowledgeBaseOverview>(
      "GET",
      "/api/knowledge/overview",
    );
    if (res.status !== 200) {
      throw new Error(
        `getOverview failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  // --- GraphRAG & Ask Endpoints ---

  async getGraphRag(
    query: string,
    topK = 5,
    maxHops = 2,
    minConfidence = 0.5,
  ): Promise<GraphRAGContextBundle> {
    const res = await this.request<GraphRAGContextBundle>(
      "POST",
      "/api/knowledge/graphrag",
      {
        query,
        topK,
        maxHops,
        minConfidence,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `getGraphRag failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async ask(
    query: string,
    topK = 5,
    maxHops = 2,
    generateAnswer = true,
  ): Promise<AnswerResponse> {
    const res = await this.request<AnswerResponse>(
      "POST",
      "/api/knowledge/ask",
      {
        query,
        topK,
        maxHops,
        generateAnswer,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `ask failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
  }

  async mcpRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = this.mcpRequestId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.mcpSessionId) {
        headers["mcp-session-id"] = this.mcpSessionId;
      }

      const response = await fetch(this.mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const sessId = response.headers.get("mcp-session-id");
      if (sessId) {
        this.mcpSessionId = sessId;
      }

      if (!response.ok) {
        throw new Error(
          `MCP request '${method}' failed with status ${response.status}: ${await response.text()}`,
        );
      }

      const text = await response.text();
      let rawJson = text.trim();

      // Handle text/event-stream format if returned by Streamable HTTP
      if (rawJson.includes("data:")) {
        const lines = rawJson.split("\n");
        const jsonLine = lines.find((l) => {
          const content = l
            .trim()
            .replace(/^data:\s*/, "")
            .trim();
          return content.startsWith("{") || content.startsWith("[");
        });
        if (jsonLine) {
          rawJson = jsonLine
            .trim()
            .replace(/^data:\s*/, "")
            .trim();
        }
      }

      const parsed = JSON.parse(rawJson) as {
        result?: T;
        error?: { code: number; message: string };
      };
      if (parsed.error) {
        throw new Error(
          `MCP Error (${parsed.error.code}): ${parsed.error.message}`,
        );
      }
      return parsed.result as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async mcpNotify(method: string, params?: unknown): Promise<void> {
    const payload = {
      jsonrpc: "2.0",
      method,
      params: params ?? {},
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.mcpSessionId) {
        headers["mcp-session-id"] = this.mcpSessionId;
      }

      await fetch(this.mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async mcpInitialize(): Promise<McpInitializeResult> {
    const result = await this.mcpRequest<McpInitializeResult>("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "golem-kgs-e2e",
        version: "1.0.0",
      },
    });
    await this.mcpNotify("notifications/initialized");
    return result;
  }

  async mcpListTools(): Promise<McpToolsListResult> {
    return this.mcpRequest<McpToolsListResult>("tools/list", {});
  }

  async mcpCallTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallToolResult> {
    return this.mcpRequest<McpCallToolResult>("tools/call", {
      name,
      arguments: args,
    });
  }
}
