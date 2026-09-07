import type {
  KnowledgeBaseOverview,
  SearchResponse,
  SearchType,
  AnswerResponse,
  EntityResult,
  EntitySearchResponse,
  DocumentResult,
  NeighborhoodResponse,
  PathFindingResult,
} from '../types/api';

const API_BASE_URL = '/api/knowledge';

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return typeof parsed === 'object' && parsed !== null ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return (val as T) ?? fallback;
}

function normalizeSearchItem(item: SearchResultItem): SearchResultItem {
  return {
    ...item,
    metadata: parseJsonField(item.metadata, {}),
  };
}

function normalizeEntity(entity: EntityResult): EntityResult {
  return {
    ...entity,
    properties: parseJsonField(entity.properties, {}),
    metadata: parseJsonField(entity.metadata, {}),
  };
}

function normalizeEdge(edge: EdgeResult): EdgeResult {
  return {
    ...edge,
    properties: parseJsonField(edge.properties, {}),
  };
}

function normalizeDocument(doc: DocumentResult): DocumentResult {
  return {
    ...doc,
    metadata: parseJsonField(doc.metadata, {}),
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.message) errorMessage = parsed.message;
      else if (parsed.error) errorMessage = parsed.error;
    } catch {
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

export const ApiService = {
  /**
   * Retrieves high-level knowledge base metrics (doc count, chunks, entities, relationships, last sync).
   */
  async getOverview(): Promise<KnowledgeBaseOverview> {
    const response = await fetch(`${API_BASE_URL}/overview`);
    return handleResponse<KnowledgeBaseOverview>(response);
  },

  /**
   * Performs hybrid, vector, or keyword search across document chunks.
   */
  async search(
    query: string,
    options: {
      limit?: number;
      searchType?: SearchType;
    } = {}
  ): Promise<SearchResponse> {
    const { limit = 10, searchType = 'hybrid' } = options;
    const response = await fetch(`${API_BASE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, searchType }),
    });
    const res = await handleResponse<SearchResponse>(response);
    return {
      ...res,
      results: (res.results || []).map(normalizeSearchItem),
    };
  },

  /**
   * Answers natural language questions using GraphRAG context retrieval, synthesis, and citations.
   */
  async ask(
    query: string,
    options: {
      topK?: number;
      maxHops?: number;
      generateAnswer?: boolean;
    } = {}
  ): Promise<AnswerResponse> {
    const { topK = 5, maxHops = 2, generateAnswer = true } = options;
    const response = await fetch(`${API_BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK, maxHops, generateAnswer }),
    });
    const res = await handleResponse<AnswerResponse>(response);
    return {
      ...res,
      groundedEntities: (res.groundedEntities || []).map(normalizeEntity),
      groundedRelationships: (res.groundedRelationships || []).map(normalizeEdge),
    };
  },

  /**
   * Retrieves raw document content and metadata by ID.
   */
  async getDocument(id: string): Promise<DocumentResult | null> {
    const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    const doc = await handleResponse<DocumentResult>(response);
    return doc ? normalizeDocument(doc) : null;
  },

  /**
   * Retrieves entity metadata and attributes by ID.
   */
  async getEntity(id: string): Promise<EntityResult | null> {
    const response = await fetch(`${API_BASE_URL}/entities/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    const entity = await handleResponse<EntityResult>(response);
    return entity ? normalizeEntity(entity) : null;
  },

  /**
   * Searches entities by name or keyword for autocomplete and discovery.
   */
  async searchEntities(query = '', limit = 10): Promise<EntityResult[]> {
    const response = await fetch(`${API_BASE_URL}/entities/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });
    const res = await handleResponse<EntitySearchResponse>(response);
    return (res.entities || []).map(normalizeEntity);
  },

  /**
   * Retrieves top connected entities (graph hubs) sorted by relationship degree.
   */
  async getTopEntities(limit = 8): Promise<EntityResult[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/entities/top`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      if (response.ok) {
        const res = await handleResponse<EntitySearchResponse>(response);
        return (res.entities || []).map(normalizeEntity);
      }
    } catch {
      // Fallback
    }
    return this.searchEntities('', limit);
  },

  /**
   * Traverses graph neighborhood around target entity up to maxDepth hops.
   */
  async getNeighborhood(
    entityId: string,
    options: {
      maxDepth?: number;
      relationTypes?: string[];
      minConfidence?: number;
    } = {}
  ): Promise<NeighborhoodResponse> {
    const { maxDepth = 2, relationTypes, minConfidence } = options;
    const response = await fetch(`${API_BASE_URL}/neighborhood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId,
        maxDepth,
        relationTypes: relationTypes && relationTypes.length > 0 ? relationTypes : undefined,
        minConfidence,
      }),
    });
    const res = await handleResponse<NeighborhoodResponse>(response);
    return {
      ...res,
      entities: (res.entities || []).map(normalizeEntity),
      edges: (res.edges || []).map(normalizeEdge),
    };
  },

  /**
   * Discovers multi-hop relational paths between source and target entities.
   */
  async findPaths(
    sourceEntityId: string,
    targetEntityId: string,
    options: {
      maxDepth?: number;
      relationTypes?: string[];
      direction?: 'OUTBOUND' | 'INBOUND' | 'BOTH';
    } = {}
  ): Promise<PathFindingResult> {
    const { maxDepth = 4, relationTypes, direction = 'BOTH' } = options;
    const response = await fetch(`${API_BASE_URL}/paths`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceEntityId,
        targetEntityId,
        maxDepth,
        relationTypes: relationTypes && relationTypes.length > 0 ? relationTypes : undefined,
        direction,
      }),
    });
    const res = await handleResponse<PathFindingResult>(response);
    return {
      ...res,
      paths: (res.paths || []).map((p) => ({
        ...p,
        edges: (p.edges || []).map(normalizeEdge),
      })),
      entities: (res.entities || []).map(normalizeEntity),
    };
  },
};
