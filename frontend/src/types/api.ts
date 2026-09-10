export interface KnowledgeBaseOverview {
  totalDocuments: number;
  totalChunks: number;
  totalEntities: number;
  totalRelationships: number;
  supportedSources: string[];
  lastSynchronizedAt: string | null;
}

export interface SearchResultItem {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

export interface SearchResponse {
  results: SearchResultItem[];
  totalResults: number;
  query: string;
}

export type SearchType = 'hybrid' | 'vector' | 'keyword';

export interface Citation {
  documentId: string;
  chunkId: string;
  sourceUri: string;
  title: string;
  excerpt: string;
}

export interface EntityResult {
  id: string;
  name: string;
  entityType: string;
  description: string | null;
  properties: Record<string, any>;
  metadata: Record<string, any>;
}

export interface EdgeResult {
  sourceId: string;
  targetId: string;
  relationType: string;
  weight: number;
  confidence: number;
  properties: Record<string, any>;
}

export interface AnswerResponse {
  question: string;
  answer: string;
  citations: Citation[];
  groundedEntities: EntityResult[];
  groundedRelationships: EdgeResult[];
  confidenceScore: number;
}

export interface NeighborhoodResponse {
  entities: EntityResult[];
  edges: EdgeResult[];
}

export interface GraphPath {
  entityIds: string[];
  edges: EdgeResult[];
  totalWeight: number;
}

export interface PathFindingResult {
  paths: GraphPath[];
  entities: EntityResult[];
  shortestPathLength: number | null;
}

export interface EntitySearchRequest {
  query?: string;
  limit?: number;
}

export interface EntitySearchResponse {
  entities: EntityResult[];
  total: number;
  query: string;
}

export interface DocumentResult {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  tags: string[];
  source: string;
  resourceName?: string;
  sourceKey?: string;
  namespace?: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  source: string;
  resourceName: string;
  sourceKey: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface GraphRAGContextBundle {
  query: string;
  entities: EntityResult[];
  relationships: EdgeResult[];
  relevantChunks: SearchResultItem[];
  formattedContextPrompt: string;
  metadata: {
    totalEntities: number;
    totalRelationships: number;
    totalChunks: number;
    retrievalDurationMs: number;
  };
}
