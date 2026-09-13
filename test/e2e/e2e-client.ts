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
  TaskRunSummary,
  WebhookIngestPayload,
} from "../../src/agents/types.js";

export interface E2EClientOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export class E2EClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(options: E2EClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.GOLEM_API_URL ?? "http://localhost:9016";
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

  // --- Coordinator & Ingestion Endpoints ---

  async triggerCoordinatorSync(
    sourceType: "s3" | "web",
    resourceName: string,
    force = false,
  ): Promise<TaskRunSummary> {
    const res = await this.request<TaskRunSummary>(
      "POST",
      "/api/coordinator/sync",
      {
        sourceType,
        resourceName,
        force,
      },
    );
    if (res.status !== 200) {
      throw new Error(
        `triggerCoordinatorSync failed with status ${res.status}: ${JSON.stringify(res.data)}`,
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

  async sendWebhook(
    sourceType: "s3" | "web",
    resourceName: string,
    payload: WebhookIngestPayload,
  ): Promise<TaskRunSummary> {
    const res = await this.request<TaskRunSummary>(
      "POST",
      `/api/coordinator/webhook/${sourceType}/${resourceName}`,
      { payload },
    );
    if (res.status !== 200) {
      throw new Error(
        `sendWebhook failed with status ${res.status}: ${JSON.stringify(res.data)}`,
      );
    }
    return res.data;
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
}
