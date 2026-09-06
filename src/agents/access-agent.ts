import { Effect, Redacted, Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { createPostgresClient } from "../storage/database-client.js";
import {
  AnswerResponseSchema,
  EntityResultSchema,
  GraphRAGContextBundleSchema,
  KnowledgeBaseOverviewSchema,
  NeighborhoodResponseSchema,
  PathFindingResultSchema,
  SearchResponseSchema,
  type Citation,
  type SearchResultItem,
} from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import {
  ChunkRepository,
  EntityRepository,
  GraphRepository,
} from "../storage/index.js";
import { EmbeddingService, GraphRAGService } from "../pipeline/index.js";
import { makeAgentPipelineLayer } from "./agent-pipeline-layer.js";

interface CountRow {
  readonly count: bigint | number | string;
}

interface SyncRow {
  readonly last_sync: Date | string | null;
}

export const KnowledgeAccessAgent = defineAgent({
  name: "KnowledgeAccessAgent",
  description:
    "Stateless ephemeral gateway for high-throughput concurrent search, graph traversal, GraphRAG, and question-answering",
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
      description:
        "Performs hybrid, vector, or keyword search across ingested document chunks",
      http: [Http.post("/search")],
    }),
    getNeighborhood: method({
      params: {
        entityId: Schema.String,
        maxDepth: Schema.optional(Schema.Number),
        relationTypes: Schema.optional(Schema.Array(Schema.String)),
        minConfidence: Schema.optional(Schema.Number),
      },
      success: NeighborhoodResponseSchema,
      description:
        "Traverses graph neighborhood up to maxDepth hops around target entity",
      http: [Http.post("/neighborhood")],
    }),
    getEntity: method({
      params: {
        id: Schema.String,
      },
      success: Schema.NullOr(EntityResultSchema),
      description: "Finds an entity by exact ID",
      http: [Http.get("/entities/{id}")],
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
      description:
        "Answers natural language questions with GraphRAG context retrieval, synthesis, and source citations",
      http: [Http.post("/ask")],
    }),
    getOverview: method({
      params: {},
      success: KnowledgeBaseOverviewSchema,
      description:
        "Returns statistical overview of the knowledge base (document count, chunk count, entity count, relationship count)",
      http: [Http.get("/overview")],
    }),
  },
}).implement(() =>
  Effect.gen(function* () {
    const config = yield* AppAgentConfig;
    const sql = yield* createPostgresClient(config);

    const api_base = yield* config.embedding.api_base;
    const model = yield* config.embedding.model;
    const apiKey = yield* config.embedding.apiKey.get;

    const resourcesVal = Redacted.value(yield* config.resources.get);
    const s3Targets = resourcesVal?.s3 ?? {};

    const pipelineLayer = makeAgentPipelineLayer({
      sql,
      embeddingConfig: { api_base, model, apiKey },
      s3Targets,
    });

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

      getNeighborhood: ({ entityId, maxDepth, relationTypes, minConfidence }) =>
        Effect.gen(function* () {
          const graphRepo = yield* GraphRepository;
          const result = yield* graphRepo.getNeighborhood({
            seedEntityIds: [entityId],
            depth: maxDepth ?? 1,
            relationTypes: relationTypes
              ? Array.from(relationTypes)
              : undefined,
            minConfidence: minConfidence ?? 0.0,
          });

          return {
            entityIds: Array.from(result.entityIds),
            edges: result.edges.map((e) => ({
              id: e.id,
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
          if (opt._tag === "None") {
            return null;
          }
          const entity = opt.value;
          return {
            id: entity.id,
            name: entity.name,
            entityType: entity.entityType,
            description: entity.description ?? null,
            properties: entity.properties,
            metadata: entity.metadata,
          };
        }).pipe(Effect.provide(pipelineLayer), Effect.orDie),

      graphRag: (query) =>
        Effect.gen(function* () {
          const service = yield* GraphRAGService;
          const bundle = yield* service.retrieveContext({
            query: query.query,
            topK: query.topK,
            maxHops: query.maxHops,
            minConfidence: query.minConfidence,
            relationTypes: query.relationTypes
              ? Array.from(query.relationTypes)
              : undefined,
          });

          return {
            query: bundle.query,
            entities: bundle.entities.map((e) => ({
              id: e.id,
              name: e.name,
              entityType: e.entityType,
              description: e.description ?? null,
              properties: e.properties,
              metadata: e.metadata,
            })),
            relationships: bundle.relationships.map((e) => ({
              id: e.id,
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
          const graphRepo = yield* GraphRepository;
          const result = yield* graphRepo.findPaths({
            sourceEntityId: query.sourceEntityId,
            targetEntityId: query.targetEntityId,
            maxDepth: query.maxDepth,
            relationTypes: query.relationTypes
              ? Array.from(query.relationTypes)
              : undefined,
            direction: query.direction,
          });

          return {
            paths: result.paths.map((p) => ({
              entityIds: Array.from(p.entityIds),
              edges: p.edges.map((e) => ({
                id: e.id,
                sourceId: e.sourceId,
                targetId: e.targetId,
                relationType: e.relationType,
                weight: e.weight,
                confidence: e.confidence,
                properties: e.properties,
              })),
              totalWeight: p.totalWeight,
            })),
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

          const groundedEntities = bundle.entities.map((e) => ({
            id: e.id,
            name: e.name,
            entityType: e.entityType,
            description: e.description ?? null,
            properties: e.properties,
            metadata: e.metadata,
          }));

          const groundedRelationships = bundle.relationships.map((e) => ({
            id: e.id,
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
          const docRows = (yield* sql<CountRow>`
            SELECT COUNT(*) AS count FROM documents
          `) as ReadonlyArray<CountRow>;

          const chunkRows = (yield* sql<CountRow>`
            SELECT COUNT(*) AS count FROM chunks
          `) as ReadonlyArray<CountRow>;

          const entityRows = (yield* sql<CountRow>`
            SELECT COUNT(*) AS count FROM entities
          `) as ReadonlyArray<CountRow>;

          const edgeRows = (yield* sql<CountRow>`
            SELECT COUNT(*) AS count FROM edges
          `) as ReadonlyArray<CountRow>;

          const syncRows = (yield* sql<SyncRow>`
            SELECT MAX(last_sync_time) AS last_sync FROM sync_checkpoints
          `) as ReadonlyArray<SyncRow>;

          const totalDocuments = Number(docRows[0]?.count ?? 0);
          const totalChunks = Number(chunkRows[0]?.count ?? 0);
          const totalEntities = Number(entityRows[0]?.count ?? 0);
          const totalRelationships = Number(edgeRows[0]?.count ?? 0);

          const rawSync = syncRows[0]?.last_sync;
          const lastSynchronizedAt = rawSync
            ? new Date(rawSync).toISOString()
            : null;

          const supportedSources =
            Object.keys(s3Targets).length > 0 ? ["s3"] : ["s3"];

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
