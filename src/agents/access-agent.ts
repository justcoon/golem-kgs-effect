import { Effect, Redacted, Schema } from "effect";
import { defineAgent, method } from "@golemcloud/effect-golem";
import { PgClient } from "@golemcloud/effect-golem/postgres";
import {
  EntityResultSchema,
  NeighborhoodResponseSchema,
  SearchResponseSchema,
  type SearchResultItem,
} from "./types.js";
import { AppAgentConfig } from "../config/agent-config.js";
import {
  ChunkRepository,
  EntityRepository,
  GraphRepository,
} from "../storage/index.js";
import { EmbeddingService } from "../pipeline/embedding-service.js";
import { makeAgentPipelineLayer } from "./agent-pipeline-layer.js";

export const KnowledgeAccessAgent = defineAgent({
  name: "KnowledgeAccessAgent",
  description:
    "Stateless ephemeral gateway for high-throughput concurrent search and graph traversal",
  mode: "ephemeral",
  config: AppAgentConfig,
  constructorParams: {},
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
    }),
    getEntity: method({
      params: {
        id: Schema.String,
      },
      success: Schema.NullOr(EntityResultSchema),
      description: "Finds an entity by exact ID",
    }),
  },
}).implement(() =>
  Effect.gen(function* () {
    const config = yield* AppAgentConfig;
    const host = yield* config.db.host;
    const db = yield* config.db.db;
    const port = yield* config.db.port;
    const user = Redacted.value(yield* config.db.user.get);
    const password = Redacted.value(yield* config.db.password.get);

    const connectionAddress = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
    const sql = yield* PgClient.make({
      connectionAddress,
      decodeTemporal: "date",
    });

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
    };
  }),
);
