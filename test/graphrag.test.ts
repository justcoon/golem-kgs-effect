import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Layer, Option, Schema } from "effect";
import {
  AnswerResponseSchema,
  GraphRAGQuerySchema,
  KnowledgeBaseOverviewSchema,
  PathFindingQuerySchema,
  PathFindingResultSchema,
} from "../src/agents/types.js";
import {
  reciprocalRankFusion,
  fuseRankings,
  formatContextPrompt,
  GraphRAGService,
} from "../src/pipeline/index.js";
import {
  ChunkRepository,
  type ChunkRepositoryShape,
  EntityRepository,
  type EntityRepositoryShape,
  GraphRepository,
  type GraphRepositoryShape,
} from "../src/storage/repository-tags.js";
import {
  EmbeddingService,
  createMockEmbedding,
} from "../src/pipeline/embedding-service.js";
import { type Entity } from "../src/domain/entity.js";
import { type Edge } from "../src/domain/relationship.js";
import {
  type GraphPath,
  type NeighborhoodQuery,
  type PathFindingQuery,
  type SearchResultItem,
} from "../src/domain/query.js";

describe("Phase 5 Search Engine & GraphRAG Retrieval", () => {
  describe("Centralized Reciprocal Rank Fusion (RRF)", () => {
    it("should calculate exact RRF scores across multiple rankings with k=60", () => {
      const rankingA = [{ id: "doc1" }, { id: "doc2" }, { id: "doc3" }];
      const rankingB = [{ id: "doc2" }, { id: "doc1" }, { id: "doc4" }];

      const scores = reciprocalRankFusion([rankingA, rankingB], 60);

      // doc1: 1/(60+1) + 1/(60+2) = 1/61 + 1/62
      const expectedDoc1 = 1 / 61 + 1 / 62;
      // doc2: 1/(60+2) + 1/(60+1) = 1/62 + 1/61
      const expectedDoc2 = 1 / 62 + 1 / 61;
      // doc3: 1/(60+3) = 1/63
      const expectedDoc3 = 1 / 63;
      // doc4: 1/(60+3) = 1/63
      const expectedDoc4 = 1 / 63;

      assert.ok(Math.abs(scores.get("doc1")! - expectedDoc1) < 1e-9);
      assert.ok(Math.abs(scores.get("doc2")! - expectedDoc2) < 1e-9);
      assert.ok(Math.abs(scores.get("doc3")! - expectedDoc3) < 1e-9);
      assert.ok(Math.abs(scores.get("doc4")! - expectedDoc4) < 1e-9);
    });

    it("should merge, rank, and limit items correctly with fuseRankings", () => {
      const list1 = [
        { id: "chunk_A", title: "Overview" },
        { id: "chunk_B", title: "Details" },
      ];
      const list2 = [
        { id: "chunk_B", title: "Details" },
        { id: "chunk_C", title: "Appendix" },
      ];

      const fused = fuseRankings([list1, list2], 60, 2);

      assert.equal(fused.length, 2);
      // chunk_B appears in both lists so it should have the highest score
      assert.equal(fused[0]?.item.id, "chunk_B");
      assert.equal(fused[1]?.item.id, "chunk_A");
      assert.ok(fused[0]!.score > fused[1]!.score);
    });
  });

  describe("Multi-Hop Graph Traversal and Path Finding Logic", () => {
    // In-memory graph for testing multi-hop traversal and path finding
    const testEdges: Edge[] = [
      {
        id: "e1",
        sourceId: "ent_A",
        targetId: "ent_B",
        relationType: "CALLS",
        weight: 1.0,
        confidence: 0.95,
        properties: {},
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "e2",
        sourceId: "ent_B",
        targetId: "ent_C",
        relationType: "DEPENDS_ON",
        weight: 0.8,
        confidence: 0.9,
        properties: {},
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "e3",
        sourceId: "ent_A",
        targetId: "ent_C",
        relationType: "USES",
        weight: 0.5,
        confidence: 0.7,
        properties: {},
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Cycle: ent_C -> ent_A
      {
        id: "e4",
        sourceId: "ent_C",
        targetId: "ent_A",
        relationType: "REFERENCES",
        weight: 0.4,
        confidence: 0.6,
        properties: {},
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "e5",
        sourceId: "ent_C",
        targetId: "ent_D",
        relationType: "WRITES_TO",
        weight: 1.2,
        confidence: 0.85,
        properties: {},
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockGraphRepo: GraphRepositoryShape = {
      upsertEdge: (_input) => Effect.die("not implemented"),
      findEdge: (src, tgt, rel) =>
        Effect.sync(() => {
          const edge = testEdges.find(
            (e) =>
              e.sourceId === src &&
              e.targetId === tgt &&
              e.relationType === rel,
          );
          return edge ? Option.some(edge) : Option.none();
        }),
      getOutboundEdges: (src) =>
        Effect.sync(() => testEdges.filter((e) => e.sourceId === src)),
      getInboundEdges: (tgt) =>
        Effect.sync(() => testEdges.filter((e) => e.targetId === tgt)),
      getNeighborhood: (query: NeighborhoodQuery) =>
        Effect.sync(() => {
          const depth = Math.max(1, Math.min(query.depth ?? 1, 5));
          const minConf = query.minConfidence ?? 0.0;
          const limit = query.limit ?? 50;
          const direction = query.direction ?? "BOTH";

          const visited = new Set<string>(query.seedEntityIds);
          let frontier = new Set<string>(query.seedEntityIds);
          const collected = new Map<string, Edge>();

          for (
            let d = 0;
            d < depth && frontier.size > 0 && collected.size < limit;
            d++
          ) {
            const nextFrontier = new Set<string>();
            for (const edge of testEdges) {
              if (edge.confidence < minConf) continue;
              if (
                query.relationTypes &&
                !query.relationTypes.includes(edge.relationType)
              ) {
                continue;
              }

              if (direction === "OUTBOUND") {
                if (frontier.has(edge.sourceId)) {
                  collected.set(edge.id, edge);
                  if (!visited.has(edge.targetId)) {
                    nextFrontier.add(edge.targetId);
                  }
                }
              } else if (direction === "INBOUND") {
                if (frontier.has(edge.targetId)) {
                  collected.set(edge.id, edge);
                  if (!visited.has(edge.sourceId)) {
                    nextFrontier.add(edge.sourceId);
                  }
                }
              } else {
                if (
                  frontier.has(edge.sourceId) ||
                  frontier.has(edge.targetId)
                ) {
                  collected.set(edge.id, edge);
                  if (!visited.has(edge.targetId)) {
                    nextFrontier.add(edge.targetId);
                  }
                  if (!visited.has(edge.sourceId)) {
                    nextFrontier.add(edge.sourceId);
                  }
                }
              }
            }

            for (const id of nextFrontier) visited.add(id);
            frontier = nextFrontier;
          }

          return {
            entityIds: Array.from(visited),
            edges: Array.from(collected.values()).slice(0, limit),
          };
        }),
      findPaths: (query: PathFindingQuery) =>
        Effect.sync(() => {
          const { sourceEntityId, targetEntityId } = query;
          const maxDepth = Math.max(1, Math.min(query.maxDepth ?? 3, 5));
          const direction = query.direction ?? "BOTH";

          if (sourceEntityId === targetEntityId) {
            return {
              paths: [
                {
                  entityIds: [sourceEntityId],
                  edges: [],
                  totalWeight: 0,
                },
              ],
              shortestPathLength: 0,
            };
          }

          interface PartialPath {
            readonly currentEntityId: string;
            readonly entityIds: ReadonlyArray<string>;
            readonly edges: ReadonlyArray<Edge>;
            readonly totalWeight: number;
          }

          let currentPaths: ReadonlyArray<PartialPath> = [
            {
              currentEntityId: sourceEntityId,
              entityIds: [sourceEntityId],
              edges: [],
              totalWeight: 0,
            },
          ];

          const foundPaths: GraphPath[] = [];

          for (
            let depth = 0;
            depth < maxDepth && currentPaths.length > 0;
            depth++
          ) {
            const nextPaths: PartialPath[] = [];

            for (const path of currentPaths) {
              const u = path.currentEntityId;

              const candidateEdges: Array<{ neighbor: string; edge: Edge }> =
                [];
              for (const edge of testEdges) {
                if (
                  query.relationTypes &&
                  !query.relationTypes.includes(edge.relationType)
                ) {
                  continue;
                }
                if (direction === "OUTBOUND") {
                  if (edge.sourceId === u) {
                    candidateEdges.push({ neighbor: edge.targetId, edge });
                  }
                } else if (direction === "INBOUND") {
                  if (edge.targetId === u) {
                    candidateEdges.push({ neighbor: edge.sourceId, edge });
                  }
                } else {
                  if (edge.sourceId === u) {
                    candidateEdges.push({ neighbor: edge.targetId, edge });
                  }
                  if (edge.targetId === u) {
                    candidateEdges.push({ neighbor: edge.sourceId, edge });
                  }
                }
              }

              for (const { neighbor, edge } of candidateEdges) {
                if (path.entityIds.includes(neighbor)) continue; // cycle prevention

                const newPath: PartialPath = {
                  currentEntityId: neighbor,
                  entityIds: [...path.entityIds, neighbor],
                  edges: [...path.edges, edge],
                  totalWeight: path.totalWeight + edge.weight,
                };

                if (neighbor === targetEntityId) {
                  foundPaths.push({
                    entityIds: newPath.entityIds as string[],
                    edges: newPath.edges as Edge[],
                    totalWeight: newPath.totalWeight,
                  });
                } else if (depth + 1 < maxDepth) {
                  nextPaths.push(newPath);
                }
              }
            }

            currentPaths = nextPaths;
          }

          foundPaths.sort((a, b) => {
            if (a.edges.length !== b.edges.length) {
              return a.edges.length - b.edges.length;
            }
            return b.totalWeight - a.totalWeight;
          });

          return {
            paths: foundPaths.slice(0, 10),
            shortestPathLength:
              foundPaths.length > 0 ? foundPaths[0]!.edges.length : null,
          };
        }),
      deleteEdge: (_id) => Effect.sync(() => true),
    };

    it("should discover multi-hop neighborhood up to depth 2", async () => {
      const program = mockGraphRepo.getNeighborhood({
        seedEntityIds: ["ent_A"],
        depth: 2,
        direction: "OUTBOUND",
      });

      const result = await Effect.runPromise(program);

      // ent_A -> (ent_B, ent_C) -> (ent_D)
      assert.ok(result.entityIds.includes("ent_A"));
      assert.ok(result.entityIds.includes("ent_B"));
      assert.ok(result.entityIds.includes("ent_C"));
      assert.ok(result.entityIds.includes("ent_D"));
      assert.ok(result.edges.length >= 3);
    });

    it("should find multiple paths between entities and order by shortest path first", async () => {
      const program = mockGraphRepo.findPaths({
        sourceEntityId: "ent_A",
        targetEntityId: "ent_D",
        maxDepth: 3,
        direction: "OUTBOUND",
      });

      const result = await Effect.runPromise(program);

      // Two paths from A to D:
      // Path 1: ent_A -> ent_C -> ent_D (2 hops)
      // Path 2: ent_A -> ent_B -> ent_C -> ent_D (3 hops)
      assert.equal(result.paths.length, 2);
      assert.equal(result.shortestPathLength, 2);
      assert.deepEqual(result.paths[0]?.entityIds, ["ent_A", "ent_C", "ent_D"]);
      assert.deepEqual(result.paths[1]?.entityIds, [
        "ent_A",
        "ent_B",
        "ent_C",
        "ent_D",
      ]);
    });

    it("should handle source == target as 0-hop path finding", async () => {
      const program = mockGraphRepo.findPaths({
        sourceEntityId: "ent_A",
        targetEntityId: "ent_A",
      });

      const result = await Effect.runPromise(program);
      assert.equal(result.shortestPathLength, 0);
      assert.equal(result.paths.length, 1);
      assert.deepEqual(result.paths[0]?.entityIds, ["ent_A"]);
    });

    it("should return empty paths when no connection exists", async () => {
      const program = mockGraphRepo.findPaths({
        sourceEntityId: "ent_D",
        targetEntityId: "ent_B",
        maxDepth: 2,
        direction: "OUTBOUND",
      });

      const result = await Effect.runPromise(program);
      assert.equal(result.paths.length, 0);
      assert.equal(result.shortestPathLength, null);
    });
  });

  describe("GraphRAG Context Bundle & Prompt Formatting", () => {
    it("should format structured markdown context prompt correctly", () => {
      const sampleChunks: SearchResultItem[] = [
        {
          chunkId: "chunk_101",
          documentId: "doc_arch",
          content: "Golem Cloud provides durable serverless workflows.",
          score: 0.8765,
          metadata: {},
        },
      ];

      const sampleEntities: Entity[] = [
        {
          id: "ent_golem",
          name: "Golem Cloud",
          entityType: "TECHNOLOGY",
          description: "Durable computing platform",
          properties: { language: "Rust" },
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "ent_effect",
          name: "Effect TS",
          entityType: "TECHNOLOGY",
          description: "Functional TypeScript runtime",
          properties: {},
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const sampleEdges: Edge[] = [
        {
          id: "edge_golem_effect",
          sourceId: "ent_golem",
          targetId: "ent_effect",
          relationType: "INTEGRATES_WITH",
          weight: 1.0,
          confidence: 0.95,
          properties: {},
          validFrom: null,
          validUntil: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const formatted = formatContextPrompt(
        "How does Golem work with Effect?",
        sampleChunks,
        sampleEntities,
        sampleEdges,
      );

      assert.ok(
        formatted.includes(
          '# Knowledge Context for Query: "How does Golem work with Effect?"',
        ),
      );
      assert.ok(
        formatted.includes("Excerpt 1 (Score: 0.8765, Document: doc_arch)"),
      );
      assert.ok(
        formatted.includes(
          "Golem Cloud provides durable serverless workflows.",
        ),
      );
      assert.ok(
        formatted.includes(
          "**Golem Cloud** [TECHNOLOGY]: Durable computing platform",
        ),
      );
      assert.ok(formatted.includes('Properties: {"language":"Rust"}'));
      assert.ok(
        formatted.includes(
          "**Golem Cloud** --[INTEGRATES_WITH (confidence: 0.95)]--> **Effect TS**",
        ),
      );
    });

    it("should handle empty retrieval results gracefully", () => {
      const formatted = formatContextPrompt("Empty query", [], [], []);
      assert.ok(formatted.includes("No relevant document excerpts found."));
      assert.ok(formatted.includes("No knowledge graph entities found."));
      assert.ok(formatted.includes("No knowledge graph relationships found."));
    });
  });

  describe("GraphRAGService Orchestration Layer", () => {
    const mockEntities = new Map<string, Entity>([
      [
        "ent_golem",
        {
          id: "ent_golem",
          name: "Golem Cloud",
          entityType: "TECHNOLOGY",
          description: "Durable agent framework",
          properties: {},
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        "ent_postgres",
        {
          id: "ent_postgres",
          name: "PostgreSQL",
          entityType: "DATABASE",
          description: "Relational database with pgvector",
          properties: {},
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    ]);

    const mockEdges: Edge[] = [
      {
        id: "e_g_p",
        sourceId: "ent_golem",
        targetId: "ent_postgres",
        relationType: "STORES_DATA_IN",
        weight: 1.0,
        confidence: 0.92,
        properties: {},
        validFrom: null,
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockChunkRepo: ChunkRepositoryShape = {
      saveRawDocument: () => Effect.die("not implemented"),
      getRawDocument: () => Effect.die("not implemented"),
      upsertChunk: () => Effect.die("not implemented"),
      getChunksByDocument: () => Effect.die("not implemented"),
      linkEntityChunk: () => Effect.void,
      getChunksForEntity: () => Effect.succeed([]),
      getEntityIdsForChunks: (chunkIds) =>
        Effect.succeed(chunkIds.length > 0 ? ["ent_golem"] : []),
      searchVector: () => Effect.die("not implemented"),
      searchKeyword: () => Effect.die("not implemented"),
      searchHybrid: (_query) =>
        Effect.succeed([
          {
            chunkId: "chk_001",
            documentId: "doc_main",
            content: "Golem stores entities and chunks inside PostgreSQL.",
            score: 0.0328,
            metadata: {},
          },
        ]),
      count: () => Effect.succeed(1),
    };

    const mockEntityRepo: EntityRepositoryShape = {
      findById: (id) =>
        Effect.sync(() =>
          mockEntities.has(id)
            ? Option.some(mockEntities.get(id)!)
            : Option.none(),
        ),
      findByName: (name) =>
        Effect.sync(() => {
          const found = Array.from(mockEntities.values()).find(
            (e) => e.name === name,
          );
          return found ? Option.some(found) : Option.none();
        }),
      findByAlias: () => Effect.succeed(Option.none()),
      upsertEntity: (_input) => Effect.die("not implemented"),
      updateEntity: () => Effect.die("not implemented"),
      addAlias: () => Effect.die("not implemented"),
      listAliases: () => Effect.succeed([]),
      searchByName: (query) =>
        Effect.sync(() =>
          Array.from(mockEntities.values()).filter((e) =>
            e.name.toLowerCase().includes(query.toLowerCase()),
          ),
        ),
      deleteEntity: () => Effect.succeed(true),
      count: () => Effect.succeed(mockEntities.size),
    };

    const mockGraphRepo: GraphRepositoryShape = {
      upsertEdge: () => Effect.die("not implemented"),
      findEdge: () => Effect.succeed(Option.none()),
      getOutboundEdges: (src) =>
        Effect.sync(() => mockEdges.filter((e) => e.sourceId === src)),
      getInboundEdges: (tgt) =>
        Effect.sync(() => mockEdges.filter((e) => e.targetId === tgt)),
      getNeighborhood: (_query) =>
        Effect.sync(() => ({
          entityIds: ["ent_golem", "ent_postgres"],
          edges: mockEdges,
        })),
      findPaths: () => Effect.die("not implemented"),
      deleteEdge: () => Effect.succeed(true),
      countEdges: () => Effect.succeed(mockEdges.length),
    };

    it("should retrieve context bundle with chunks, expanded entities, and formatted prompt", async () => {
      const testLayer = Layer.mergeAll(
        Layer.succeed(EmbeddingService, {
          generateEmbedding: (text) =>
            Effect.succeed(createMockEmbedding(text)),
          generateBatchEmbeddings: (texts) =>
            Effect.succeed(texts.map(createMockEmbedding)),
        }),
        Layer.succeed(ChunkRepository, mockChunkRepo),
        Layer.succeed(EntityRepository, mockEntityRepo),
        Layer.succeed(GraphRepository, mockGraphRepo),
      );

      const graphRagServiceLayer = GraphRAGService.Default.pipe(
        Layer.provide(testLayer),
      );

      const program = Effect.gen(function* () {
        const service = yield* GraphRAGService;
        return yield* service.retrieveContext({
          query: "How does Golem use PostgreSQL?",
          topK: 3,
          maxHops: 2,
        });
      }).pipe(Effect.provide(graphRagServiceLayer));

      const bundle = await Effect.runPromise(program);

      assert.equal(bundle.query, "How does Golem use PostgreSQL?");
      assert.equal(bundle.relevantChunks.length, 1);
      assert.equal(bundle.relevantChunks[0]?.chunkId, "chk_001");
      assert.equal(bundle.entities.length, 2);
      assert.equal(bundle.relationships.length, 1);
      assert.ok(bundle.formattedContextPrompt.includes("STORES_DATA_IN"));
      assert.ok(bundle.metadata.retrievalDurationMs >= 0);
      assert.equal(bundle.metadata.totalChunks, 1);
      assert.equal(bundle.metadata.totalEntities, 2);
      assert.equal(bundle.metadata.totalRelationships, 1);
    });
  });

  describe("Agent Schemas and Interface Contracts", () => {
    it("should validate GraphRAG and PathFinding agent schemas", () => {
      const validQuery = {
        query: "What is Golem?",
        topK: 5,
        maxHops: 2,
        minConfidence: 0.8,
      };

      const parsedQuery =
        Schema.decodeUnknownSync(GraphRAGQuerySchema)(validQuery);
      assert.equal(parsedQuery.query, "What is Golem?");
      assert.equal(parsedQuery.topK, 5);

      const validPathQuery = {
        sourceEntityId: "ent_1",
        targetEntityId: "ent_2",
        maxDepth: 3,
        direction: "OUTBOUND",
      };

      const parsedPathQuery = Schema.decodeUnknownSync(PathFindingQuerySchema)(
        validPathQuery,
      );
      assert.equal(parsedPathQuery.sourceEntityId, "ent_1");
      assert.equal(parsedPathQuery.direction, "OUTBOUND");
    });

    it("should validate KnowledgeAccessAgent question answering and overview contracts", () => {
      // Verify KnowledgeBaseOverviewSchema
      const overviewData = {
        totalDocuments: 10,
        totalChunks: 50,
        totalEntities: 35,
        totalRelationships: 80,
        supportedSources: ["s3"],
        lastSynchronizedAt: "2026-09-06T12:00:00.000Z",
      };
      const parsedOverview = Schema.decodeUnknownSync(
        KnowledgeBaseOverviewSchema,
      )(overviewData);
      assert.equal(parsedOverview.totalDocuments, 10);
      assert.equal(parsedOverview.totalChunks, 50);
      assert.equal(parsedOverview.supportedSources[0], "s3");

      // Verify AnswerResponseSchema & CitationSchema
      const answerData = {
        question: "Explain Golem architecture",
        answer: "Golem Cloud uses durable agents with WebAssembly execution.",
        citations: [
          {
            documentId: "doc_arch",
            chunkId: "chunk_1",
            sourceUri: "s3://bucket/docs/arch.md",
            title: "Architecture",
            excerpt: "Golem Cloud uses durable agents...",
          },
        ],
        groundedEntities: [],
        groundedRelationships: [],
        confidenceScore: 0.95,
      };

      const parsedAnswer =
        Schema.decodeUnknownSync(AnswerResponseSchema)(answerData);
      assert.equal(parsedAnswer.question, "Explain Golem architecture");
      assert.equal(parsedAnswer.citations.length, 1);
      assert.equal(parsedAnswer.citations[0]?.documentId, "doc_arch");
      assert.equal(parsedAnswer.confidenceScore, 0.95);
    });

    it("should validate PathFindingResultSchema and GraphPathSchema contracts", () => {
      const pathData = {
        paths: [
          {
            entityIds: ["e1", "e2"],
            edges: [
              {
                id: "edge_1_2",
                sourceId: "e1",
                targetId: "e2",
                relationType: "CONNECTS",
                weight: 1.0,
                confidence: 0.95,
                properties: {},
              },
            ],
            totalWeight: 1.0,
          },
        ],
        shortestPathLength: 1,
      };

      const parsedResult = Schema.decodeUnknownSync(PathFindingResultSchema)(
        pathData,
      );
      assert.equal(parsedResult.paths.length, 1);
      assert.equal(parsedResult.shortestPathLength, 1);
      assert.equal(parsedResult.paths[0]?.entityIds.length, 2);
    });
  });
});
