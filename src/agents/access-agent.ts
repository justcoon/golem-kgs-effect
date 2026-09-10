import { Effect, Option, Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import {
  AnswerResponseSchema,
  DocumentResultSchema,
  DocumentSummarySchema,
  EntityResultSchema,
  EntitySearchResponseSchema,
  GraphRAGContextBundleSchema,
  KnowledgeBaseOverviewSchema,
  NeighborhoodResponseSchema,
  PathFindingResultSchema,
  SearchResponseSchema,
  SourceTypeSchema,
  type Citation,
  type DocumentResult,
  type EntityResult,
  type SearchResultItem,
} from "./types.js";
import { type Entity } from "../domain/entity.js";
import { type RawDocument } from "../domain/provenance.js";
import { AppAgentConfig } from "../config/agent-config.js";
import {
  CheckpointRepository,
  ChunkRepository,
  DocumentRepository,
  EntityRepository,
  type EntityRepositoryShape,
  GraphRepository,
} from "../storage/index.js";
import { EmbeddingService, GraphRAGService } from "../pipeline/index.js";
import { makeAgentPipelineLayer } from "./agent-pipeline-layer.js";

const mapEntityToResult = (entity: Entity): EntityResult => ({
  id: entity.id,
  name: entity.name,
  entityType: entity.entityType,
  description: entity.description ?? null,
  properties: entity.properties,
  metadata: entity.metadata,
});

const mapDocumentToResult = (doc: RawDocument): DocumentResult => ({
  id: doc.id,
  title: doc.title,
  content: doc.content,
  metadata: doc.metadata,
  tags: doc.tags,
  source: doc.source,
  resourceName: doc.resourceName,
  sourceKey: doc.sourceKey,
  sizeBytes: doc.sizeBytes,
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString(),
});

const resolveEntityId = (input: string, entityRepo: EntityRepositoryShape) =>
  Effect.gen(function* () {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;

    // 1. Exact ID
    const byId = yield* entityRepo.findById(trimmed);
    if (Option.isSome(byId)) {
      return byId.value.id;
    }

    // 2. Name match (case-insensitive or exact)
    const byName = yield* entityRepo.findByName(trimmed);
    if (Option.isSome(byName)) {
      return byName.value.id;
    }

    // 3. Alias match
    const byAlias = yield* entityRepo.findByAlias(trimmed);
    if (Option.isSome(byAlias)) {
      return byAlias.value.id;
    }

    // 4. Fuzzy search by name
    const fuzzy = yield* entityRepo.searchByName(trimmed, 1);
    if (fuzzy.length > 0 && fuzzy[0]) {
      return fuzzy[0].id;
    }

    // Fallback: use input as given
    return trimmed;
  });

const fetchEntitiesByIds = (
  ids: ReadonlyArray<string>,
  entityRepo: EntityRepositoryShape,
) =>
  entityRepo
    .findByIds(ids)
    .pipe(Effect.map((entities) => entities.map(mapEntityToResult)));

export const KnowledgeAccessAgent = defineAgent({
  name: "KnowledgeAccessAgent",
  description:
    "Stateless ephemeral gateway for high-throughput concurrent search, graph traversal, GraphRAG, and question-answering",
  promptHint:
    "Query and explore the knowledge graph, retrieve documents, execute GraphRAG, and answer questions",
  mode: "ephemeral",
  config: AppAgentConfig,
  constructorParams: {},
  http: Http.mount("/api/knowledge", { cors: ["*"] }),
  methods: {
    search: method({
      params: {
        query: Schema.String,
        limit: Schema.optional(Schema.Number),
        searchType: Schema.optional(
          Schema.Literals(["hybrid", "vector", "keyword"]),
        ),
      },
      success: SearchResponseSchema,
      promptHint:
        "Search ingested documents using hybrid, semantic vector, or keyword search",
      description:
        "Performs hybrid, vector, or keyword search across ingested document chunks",
      http: [Http.post("/search")],
    }),
    searchEntities: method({
      params: {
        query: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.Number),
      },
      success: EntitySearchResponseSchema,
      promptHint: "Search knowledge graph entities by name, alias, or keyword",
      description:
        "Searches entities by name, alias, or keyword. Returns top connected hubs if query is omitted or empty.",
      http: [Http.post("/entities/search")],
    }),
    getTopEntities: method({
      params: {
        limit: Schema.optional(Schema.Number),
      },
      success: EntitySearchResponseSchema,
      promptHint:
        "List top connected hub entities in the knowledge graph sorted by connectivity degree",
      description:
        "Returns top connected entities (graph hubs) sorted by degree",
      http: [Http.post("/entities/top")],
    }),
    getNeighborhood: method({
      params: {
        entityId: Schema.String,
        maxDepth: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
        minConfidence: Schema.optional(Schema.Number),
      },
      success: NeighborhoodResponseSchema,
      promptHint:
        "Traverse and explore relationships and neighboring entities around an entity",
      description:
        "Traverses graph neighborhood up to maxDepth hops around target entity",
      http: [Http.post("/neighborhood")],
    }),
    getEntity: method({
      params: {
        id: Schema.String,
      },
      success: Schema.NullOr(EntityResultSchema),
      promptHint: "Look up an entity by its exact ID",
      description: "Finds an entity by exact ID",
      http: [Http.get("/entities/{id}")],
    }),
    getEntityDocuments: method({
      params: {
        id: Schema.String,
      },
      success: Schema.Array(DocumentSummarySchema),
      promptHint: "Get documents associated with or mentioning an entity",
      description:
        "Retrieves summary list of all documents associated with an entity",
      http: [Http.get("/entities/{id}/documents")],
    }),
    getDocument: method({
      params: {
        id: Schema.String,
      },
      success: Schema.NullOr(DocumentResultSchema),
      promptHint: "Retrieve raw content and metadata for a document by its ID",
      description: "Retrieves raw document content and metadata by ID",
      http: [Http.get("/documents/{id}")],
    }),
    graphRag: method({
      params: {
        query: Schema.String,
        topK: Schema.optional(Schema.Number),
        maxHops: Schema.optional(Schema.Number),
        minConfidence: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
      },
      success: GraphRAGContextBundleSchema,
      promptHint:
        "Execute GraphRAG retrieval returning structured context and synthesized prompt",
      description:
        "Executes GraphRAG retrieval pipeline returning structured context and formatted prompt",
      http: [Http.post("/graphrag")],
    }),
    findPaths: method({
      params: {
        sourceEntityId: Schema.String,
        targetEntityId: Schema.String,
        maxDepth: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
        direction: Schema.optional(
          Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"]),
        ),
      },
      success: PathFindingResultSchema,
      promptHint:
        "Find relationship paths connecting two entities in the graph",
      description:
        "Discovers multi-hop relational paths between source and target entities",
      http: [Http.post("/paths")],
    }),
    ask: method({
      params: {
        query: Schema.String,
        topK: Schema.optional(Schema.Number),
        maxHops: Schema.optional(Schema.Number),
        generateAnswer: Schema.optional(Schema.Boolean),
      },
      success: AnswerResponseSchema,
      promptHint:
        "Ask a natural language question to get a synthesized answer with source citations",
      description:
        "Answers natural language questions with GraphRAG context retrieval, synthesis, and source citations",
      http: [Http.post("/ask")],
    }),
    getOverview: method({
      params: {},
      success: KnowledgeBaseOverviewSchema,
      promptHint:
        "Retrieve knowledge base overview statistics including counts of documents, chunks, entities, and relations",
      description:
        "Returns statistical overview of the knowledge base (document count, chunk count, entity count, relationship count)",
      http: [Http.get("/overview")],
    }),
  },
}).implement(() =>
  Effect.gen(function* () {
    const config = yield* AppAgentConfig;
    const pipelineLayer = yield* makeAgentPipelineLayer(config);

    return {
      search: ({ query, limit = 10, searchType = "hybrid" }) =>
        Effect.gen(function* () {
          const chunkRepo = yield* ChunkRepository;
          const embeddingService = yield* EmbeddingService;

          let items: ReadonlyArray<SearchResultItem> = [];

          if (searchType === "vector") {
            const emb = yield* embeddingService.generateEmbedding(query);
            const res = yield* chunkRepo.searchVector({
              embedding: emb,
              topK: limit,
            });
            items = res;
          } else if (searchType === "keyword") {
            const res = yield* chunkRepo.searchKeyword({ query, limit });
            items = res;
          } else {
            // Default: hybrid search
            const emb = yield* embeddingService.generateEmbedding(query);
            const res = yield* chunkRepo.searchHybrid({
              query,
              embedding: emb,
              limit,
            });
            items = res;
          }

          return {
            results: Array.from(items),
            totalResults: items.length,
            query,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      searchEntities: ({ query, limit = 10 }) =>
        Effect.gen(function* () {
          const entityRepo = yield* EntityRepository;
          const trimmed = (query ?? "").trim();
          const matched =
            trimmed.length === 0
              ? yield* entityRepo.getTopConnected(limit)
              : yield* entityRepo.searchByName(trimmed, limit);
          const entities = matched.map(mapEntityToResult);

          return {
            entities,
            total: entities.length,
            query: trimmed,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      getTopEntities: ({ limit = 10 }) =>
        Effect.gen(function* () {
          const entityRepo = yield* EntityRepository;
          const matched = yield* entityRepo.getTopConnected(limit);
          const entities = matched.map(mapEntityToResult);

          return {
            entities,
            total: entities.length,
            query: "",
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      getNeighborhood: ({ entityId, maxDepth, relationTypes, minConfidence }) =>
        Effect.gen(function* () {
          const entityRepo = yield* EntityRepository;
          const graphRepo = yield* GraphRepository;

          const resolvedId = yield* resolveEntityId(entityId, entityRepo);

          const result = yield* graphRepo.getNeighborhood({
            seedEntityIds: [resolvedId],
            depth: maxDepth ?? 1,
            relationTypes,
            minConfidence: minConfidence ?? 0.0,
          });

          const entities = yield* fetchEntitiesByIds(
            result.entityIds,
            entityRepo,
          );

          return {
            entities: Array.from(entities),
            edges: result.edges.map((e) => ({
              sourceId: e.sourceId,
              targetId: e.targetId,
              relationType: e.relationType,
              weight: e.weight,
              confidence: e.confidence,
              properties: e.properties,
            })),
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      getEntity: ({ id }) =>
        Effect.gen(function* () {
          const entityRepo = yield* EntityRepository;
          const opt = yield* entityRepo.findById(id);
          return opt.pipe(Option.map(mapEntityToResult), Option.getOrNull);
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      getEntityDocuments: ({ id }) =>
        Effect.gen(function* () {
          const entityRepo = yield* EntityRepository;
          const docs = yield* entityRepo.getRelatedDocuments(id);
          return docs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            source: doc.source,
            resourceName: doc.resourceName,
            sourceKey: doc.sourceKey,
            sizeBytes: doc.sizeBytes,
            createdAt: new Date(doc.createdAt).toISOString(),
            updatedAt: new Date(doc.updatedAt).toISOString(),
          }));
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      getDocument: ({ id }) =>
        Effect.gen(function* () {
          const docRepo = yield* DocumentRepository;
          const opt = yield* docRepo.findDocumentById(id);
          return opt.pipe(Option.map(mapDocumentToResult), Option.getOrNull);
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      graphRag: (query) =>
        Effect.gen(function* () {
          const service = yield* GraphRAGService;
          const bundle = yield* service.retrieveContext({
            query: query.query,
            topK: query.topK,
            maxHops: query.maxHops,
            minConfidence: query.minConfidence,
            relationTypes: query.relationTypes,
          });

          return {
            query: bundle.query,
            entities: bundle.entities.map(mapEntityToResult),
            relationships: bundle.relationships.map((e) => ({
              sourceId: e.sourceId,
              targetId: e.targetId,
              relationType: e.relationType,
              weight: e.weight,
              confidence: e.confidence,
              properties: e.properties,
            })),
            relevantChunks: bundle.relevantChunks.map((c) => ({
              chunkId: c.chunkId,
              documentId: c.documentId,
              content: c.content,
              score: c.score,
              metadata: c.metadata,
            })),
            formattedContextPrompt: bundle.formattedContextPrompt,
            metadata: bundle.metadata,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      findPaths: (query) =>
        Effect.gen(function* () {
          const entityRepo = yield* EntityRepository;
          const graphRepo = yield* GraphRepository;

          const resolvedSourceId = yield* resolveEntityId(
            query.sourceEntityId,
            entityRepo,
          );
          const resolvedTargetId = yield* resolveEntityId(
            query.targetEntityId,
            entityRepo,
          );

          const result = yield* graphRepo.findPaths({
            sourceEntityId: resolvedSourceId,
            targetEntityId: resolvedTargetId,
            maxDepth: query.maxDepth,
            relationTypes: query.relationTypes,
            direction: query.direction,
          });

          const allEntityIds = Array.from(
            new Set(result.paths.flatMap((p) => Array.from(p.entityIds))),
          );
          const entities = yield* fetchEntitiesByIds(allEntityIds, entityRepo);

          return {
            paths: result.paths.map((p) => ({
              entityIds: Array.from(p.entityIds),
              edges: p.edges.map((e) => ({
                sourceId: e.sourceId,
                targetId: e.targetId,
                relationType: e.relationType,
                weight: e.weight,
                confidence: e.confidence,
                properties: e.properties,
              })),
              totalWeight: p.totalWeight,
            })),
            entities: Array.from(entities),
            shortestPathLength: result.shortestPathLength,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      ask: ({ query, topK = 5, maxHops = 2, generateAnswer = true }) =>
        Effect.gen(function* () {
          const graphRagService = yield* GraphRAGService;
          const bundle = yield* graphRagService.retrieveContext({
            query,
            topK,
            maxHops,
          });

          const citations: Citation[] = bundle.relevantChunks.map((chunk) => {
            const meta =
              chunk.metadata && typeof chunk.metadata === "object"
                ? (chunk.metadata as Record<string, unknown>)
                : {};

            const sourceUri =
              typeof meta.sourceUri === "string"
                ? meta.sourceUri
                : `doc://${chunk.documentId}`;

            const title =
              typeof meta.title === "string"
                ? meta.title
                : `Document ${chunk.documentId}`;

            const excerpt =
              chunk.content.length > 250
                ? `${chunk.content.slice(0, 247)}...`
                : chunk.content;

            return {
              documentId: chunk.documentId,
              chunkId: chunk.chunkId,
              sourceUri,
              title,
              excerpt,
            };
          });

          const groundedEntities = bundle.entities.map(mapEntityToResult);

          const groundedRelationships = bundle.relationships.map((e) => ({
            sourceId: e.sourceId,
            targetId: e.targetId,
            relationType: e.relationType,
            weight: e.weight,
            confidence: e.confidence,
            properties: e.properties,
          }));

          let answer = "";
          if (generateAnswer) {
            if (
              bundle.relevantChunks.length > 0 ||
              bundle.entities.length > 0
            ) {
              const entityList = bundle.entities
                .slice(0, 5)
                .map((e) => `${e.name} (${e.entityType})`)
                .join(", ");
              const entityPart = entityList
                ? ` Key entities: ${entityList}.`
                : "";
              const chunkPart = bundle.relevantChunks[0]
                ? ` Excerpt: "${bundle.relevantChunks[0].content.trim().slice(0, 200)}..."`
                : "";
              answer = `Grounded response for "${query}":${entityPart}${chunkPart}`;
            } else {
              answer = `No matching knowledge graph entities or documents found for query "${query}".`;
            }
          }

          const topScore = bundle.relevantChunks[0]?.score ?? 0.5;
          const confidenceScore = Number(
            Math.max(0.1, Math.min(0.99, topScore)).toFixed(4),
          );

          return {
            question: query,
            answer,
            citations,
            groundedEntities,
            groundedRelationships,
            confidenceScore,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      getOverview: () =>
        Effect.gen(function* () {
          const docRepo = yield* DocumentRepository;
          const chunkRepo = yield* ChunkRepository;
          const entityRepo = yield* EntityRepository;
          const graphRepo = yield* GraphRepository;
          const checkpointRepo = yield* CheckpointRepository;

          const [
            totalDocuments,
            totalChunks,
            totalEntities,
            totalRelationships,
            lastSyncOpt,
          ] = yield* Effect.all(
            [
              docRepo.count(),
              chunkRepo.count(),
              entityRepo.count(),
              graphRepo.countEdges(),
              checkpointRepo.getLatestSyncTime(),
            ],
            { concurrency: 5 },
          );

          const lastSynchronizedAt = Option.map(lastSyncOpt, (d) =>
            d.toISOString(),
          ).pipe(Option.getOrNull);

          const supportedSources = [...SourceTypeSchema.literals];

          return {
            totalDocuments,
            totalChunks,
            totalEntities,
            totalRelationships,
            supportedSources,
            lastSynchronizedAt,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),
    };
  }),
);
