import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Layer, Option, Schema } from "effect";
import {
  calculateScheduledAt,
  CoordinatorStateSchema,
  DocumentResultSchema,
  EdgeResultSchema,
  EntityResultSchema,
  NeighborhoodResponseSchema,
  S3TaskStateSchema,
  SearchResponseSchema,
  SearchResultItemSchema,
  SyncScheduleSchema,
  TaskRunSummarySchema,
  toScheduleKey,
  parseScheduleKey,
  type S3TaskState,
} from "../src/agents/types.js";
import { S3ConnectorService } from "../src/connectors/s3-connector.js";
import {
  DocumentRepository,
  type DocumentRepositoryShape,
  ChunkRepository,
  type ChunkRepositoryShape,
  CheckpointRepository,
  type CheckpointRepositoryShape,
  EntityRepository,
  type EntityRepositoryShape,
  GraphRepository,
  type GraphRepositoryShape,
} from "../src/storage/repository-tags.js";
import {
  EmbeddingService,
  EntityResolverService,
  ExtractionService,
} from "../src/pipeline/index.js";
import { runS3Ingestion } from "../src/pipeline/s3-ingestion-pipeline.js";
import { type RawDocument } from "../src/domain/provenance.js";
import { type CreateChunkInput } from "../src/domain/chunk.js";
import {
  type SaveCheckpointInput,
  type SyncCheckpoint,
} from "../src/domain/connector.js";

import {
  type CreateEntityInput,
  type Entity,
  type EntityAlias,
  type UpdateEntityInput,
} from "../src/domain/entity.js";
import { type CreateEdgeInput, type Edge } from "../src/domain/relationship.js";

describe("Phase 4 Durable Agents & Orchestration", () => {
  describe("Agent State & Contract Schemas", () => {
    it("should validate and parse S3TaskStateSchema in various lifecycle states", () => {
      const idleState: S3TaskState = {
        resourceName: "main",
        status: "IDLE",
        lastSyncTimestamp: null,
        processedKeys: {},
        cursor: null,
        metrics: {
          totalDiscovered: 0,
          totalSynced: 0,
          totalFailed: 0,
          lastDurationMs: 0,
        },
        errorMessage: null,
      };

      const parsedIdle = Schema.decodeUnknownSync(S3TaskStateSchema)(idleState);
      assert.equal(parsedIdle.resourceName, "main");
      assert.equal(parsedIdle.status, "IDLE");
      assert.equal(parsedIdle.lastSyncTimestamp, null);

      const completedState = {
        ...idleState,
        status: "COMPLETED" as const,
        lastSyncTimestamp: "2026-09-06T12:00:00.000Z",
        processedKeys: { "rfcs/rfc-001.md": "etag123" },
        metrics: {
          totalDiscovered: 1,
          totalSynced: 1,
          totalFailed: 0,
          lastDurationMs: 450,
        },
      };

      const parsedCompleted =
        Schema.decodeUnknownSync(S3TaskStateSchema)(completedState);
      assert.equal(parsedCompleted.status, "COMPLETED");
      assert.equal(parsedCompleted.processedKeys["rfcs/rfc-001.md"], "etag123");
    });

    it("should validate CoordinatorStateSchema, SyncScheduleSchema, and TaskRunSummarySchema", () => {
      const schedule = {
        sourceType: "s3" as const,
        resourceName: "main",
        intervalSeconds: 300,
        lastScheduledAt: "2026-09-06T12:00:00.000Z",
        lastRunAt: "2026-09-06T11:55:00.000Z",
        status: "ACTIVE" as const,
      };

      const parsedSched =
        Schema.decodeUnknownSync(SyncScheduleSchema)(schedule);
      assert.equal(parsedSched.sourceType, "s3");
      assert.equal(parsedSched.resourceName, "main");
      assert.equal(parsedSched.intervalSeconds, 300);
      assert.equal(parsedSched.status, "ACTIVE");

      const key = toScheduleKey("s3", "main");
      assert.equal(key, "s3:main");
      assert.deepEqual(parseScheduleKey(key), {
        sourceType: "s3",
        resourceName: "main",
      });

      const coordinatorState = {
        schedules: {
          [key]: parsedSched,
          "s3:archive": {
            sourceType: "s3" as const,
            resourceName: "archive",
            intervalSeconds: 600,
            lastScheduledAt: null,
            lastRunAt: null,
            status: "ACTIVE" as const,
          },
        },
        aggregatedMetrics: {
          totalRunsTriggered: 10,
          totalSuccesses: 9,
          totalFailures: 1,
        },
      };

      const parsedCoord = Schema.decodeUnknownSync(CoordinatorStateSchema)(
        coordinatorState,
      );
      assert.equal(parsedCoord.aggregatedMetrics.totalRunsTriggered, 10);
      assert.ok(parsedCoord.schedules["s3:main"]);
      assert.ok(parsedCoord.schedules["s3:archive"]);
      assert.equal(parsedCoord.schedules["s3:main"]?.resourceName, "main");
      assert.equal(
        parsedCoord.schedules["s3:archive"]?.resourceName,
        "archive",
      );

      const runSummary = {
        sourceType: "s3" as const,
        resourceName: "main",
        status: "COMPLETED" as const,
        syncedCount: 5,
        failedCount: 0,
        durationMs: 1200,
        errorMessage: null,
      };
      const parsedSummary =
        Schema.decodeUnknownSync(TaskRunSummarySchema)(runSummary);
      assert.equal(parsedSummary.status, "COMPLETED");
      assert.equal(parsedSummary.syncedCount, 5);
    });

    it("should validate KnowledgeAccessAgent response schemas", () => {
      const searchItem = {
        chunkId: "chunk_1",
        documentId: "doc_1",
        content:
          "Golem Cloud durable agents provide persistent virtual compute",
        score: 0.95,
        metadata: JSON.stringify({ source: "s3" }),
      };

      const parsedItem = Schema.decodeUnknownSync(SearchResultItemSchema)(
        searchItem,
      );
      assert.equal(parsedItem.chunkId, "chunk_1");
      assert.deepEqual(parsedItem.metadata, { source: "s3" });

      const searchResp = {
        results: [searchItem],
        totalResults: 1,
        query: "durable agents",
      };

      const parsedSearch =
        Schema.decodeUnknownSync(SearchResponseSchema)(searchResp);
      assert.equal(parsedSearch.totalResults, 1);
      assert.equal(parsedSearch.results[0]?.score, 0.95);

      const edgeItem = {
        sourceId: "ent_golem",
        targetId: "ent_effect",
        relationType: "USES",
        weight: 1.0,
        confidence: 0.9,
        properties: "{}",
      };

      const parsedEdge = Schema.decodeUnknownSync(EdgeResultSchema)(edgeItem);
      assert.equal(parsedEdge.relationType, "USES");
      assert.deepEqual(parsedEdge.properties, {});

      const neighborhoodResp = {
        entities: [
          {
            id: "ent_golem",
            name: "Golem Cloud",
            entityType: "TECHNOLOGY",
            description: "Durable computing platform",
            properties: "{}",
            metadata: "{}",
          },
        ],
        edges: [edgeItem],
      };

      const parsedNeighborhood = Schema.decodeUnknownSync(
        NeighborhoodResponseSchema,
      )(neighborhoodResp);
      assert.equal(parsedNeighborhood.entities.length, 1);
      assert.equal(parsedNeighborhood.entities[0]?.name, "Golem Cloud");
      assert.equal(parsedNeighborhood.edges[0]?.relationType, "USES");

      const entityItem = {
        id: "ent_golem",
        name: "Golem Cloud",
        entityType: "TECHNOLOGY",
        description: "Durable computing platform",
        properties: "{}",
        metadata: "{}",
      };

      const parsedEntity =
        Schema.decodeUnknownSync(EntityResultSchema)(entityItem);
      assert.equal(parsedEntity.name, "Golem Cloud");
      assert.deepEqual(parsedEntity.properties, {});
      assert.deepEqual(parsedEntity.metadata, {});

      const docItem = {
        id: "doc_1",
        title: "Golem Overview",
        content: "Complete documentation for Golem Cloud",
        metadata: JSON.stringify({ author: "Alice" }),
        tags: ["guide", "docs"],
        source: "s3_main",
        resourceName: "default",
        sourceKey: "overview.md",
        sizeBytes: 1024,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const parsedDoc = Schema.decodeUnknownSync(DocumentResultSchema)(docItem);
      assert.equal(parsedDoc.title, "Golem Overview");
      assert.equal(parsedDoc.sizeBytes, 1024);
      assert.deepEqual(parsedDoc.metadata, { author: "Alice" });
    });

    it("should calculate correct WIT wall-clock scheduledAt record for Golem native host scheduler", () => {
      const baseTime = 1757160000123; // Fixed reference timestamp
      const intervalSeconds = 60;

      const scheduled = calculateScheduledAt(intervalSeconds, baseTime);

      const expectedTargetMillis = baseTime + 60_000;
      const expectedSeconds = BigInt(Math.floor(expectedTargetMillis / 1000));
      const expectedNanos = (expectedTargetMillis % 1000) * 1_000_000;

      assert.equal(scheduled.seconds, expectedSeconds);
      assert.equal(scheduled.nanoseconds, expectedNanos);
      assert.ok(typeof scheduled.seconds === "bigint");
      assert.ok(typeof scheduled.nanoseconds === "number");
    });
  });

  describe("S3 Ingestion Pipeline Execution", () => {
    // In-memory mock repositories for test verification
    const savedDocs = new Map<string, RawDocument>();
    const savedChunks: CreateChunkInput[] = [];
    const savedCheckpoints = new Map<string, SyncCheckpoint>();
    const savedEntities = new Map<string, Entity>();
    const savedAliases: EntityAlias[] = [];
    const savedEdges: Edge[] = [];

    const mockDocRepo: DocumentRepositoryShape = {
      saveDocument: (doc) =>
        Effect.sync(() => {
          savedDocs.set(doc.id, doc);
          return doc;
        }),
      findDocumentById: (id) =>
        Effect.sync(() =>
          savedDocs.has(id) ? Option.some(savedDocs.get(id)!) : Option.none(),
        ),
      findByResourceKey: (source, resourceName, sourceKey) =>
        Effect.sync(() => {
          const match = Array.from(savedDocs.values()).find(
            (d) =>
              d.source === source &&
              d.resourceName === resourceName &&
              d.sourceKey === sourceKey,
          );
          return match ? Option.some(match) : Option.none();
        }),
      listDocuments: () => Effect.sync(() => Array.from(savedDocs.values())),
      deleteDocument: (id) =>
        Effect.sync(() => {
          return savedDocs.delete(id);
        }),
      count: () => Effect.sync(() => savedDocs.size),
    };

    const mockChunkRepo: ChunkRepositoryShape = {
      saveRawDocument: (doc) => Effect.succeed(doc),
      getRawDocument: () => Effect.succeed(Option.none()),
      upsertChunk: (chunk) =>
        Effect.sync(() => {
          savedChunks.push(chunk);
          return {
            id: chunk.id,
            documentId: chunk.documentId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount ?? 10,
            embedding: chunk.embedding ?? null,
            metadata: chunk.metadata ?? {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }),
      getChunksByDocument: (docId) =>
        Effect.sync(() =>
          savedChunks
            .filter((c) => c.documentId === docId)
            .map((c) => ({
              id: c.id,
              documentId: c.documentId,
              chunkIndex: c.chunkIndex,
              content: c.content,
              tokenCount: c.tokenCount ?? 10,
              embedding: c.embedding ?? null,
              metadata: c.metadata ?? {},
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
        ),
      linkEntityChunk: () => Effect.void,
      getChunksForEntity: () => Effect.succeed([]),
      getEntityIdsForChunks: () => Effect.succeed([]),
      searchVector: () => Effect.succeed([]),
      searchKeyword: () => Effect.succeed([]),
      searchHybrid: () => Effect.succeed([]),
      count: () => Effect.sync(() => savedChunks.length),
    };

    const mockCheckpointRepo: CheckpointRepositoryShape = {
      saveCheckpoint: (input: SaveCheckpointInput) =>
        Effect.sync(() => {
          const cp: SyncCheckpoint = {
            connectorId: input.connectorId,
            cursorData: input.cursorData as Record<string, unknown>,
            lastSyncTime: new Date(),
            status: input.status,
            metrics: input.metrics ?? {},
            updatedAt: new Date(),
          };
          savedCheckpoints.set(input.connectorId, cp);
          return cp;
        }),
      getCheckpoint: (id) =>
        Effect.sync(() =>
          savedCheckpoints.has(id)
            ? Option.some(savedCheckpoints.get(id)!)
            : Option.none(),
        ),
      listCheckpoints: () =>
        Effect.sync(() => Array.from(savedCheckpoints.values())),
      deleteCheckpoint: (id) => Effect.sync(() => savedCheckpoints.delete(id)),
      getLatestSyncTime: () => Effect.sync(() => Option.none()),
    };

    const mockEntityRepo: EntityRepositoryShape = {
      findById: (id) =>
        Effect.sync(() =>
          savedEntities.has(id)
            ? Option.some(savedEntities.get(id)!)
            : Option.none(),
        ),
      findByIds: (ids) =>
        Effect.sync(() =>
          ids
            .map((id) => savedEntities.get(id))
            .filter((e): e is Entity => e !== undefined),
        ),
      findByName: (name) =>
        Effect.sync(() => {
          const match = Array.from(savedEntities.values()).find(
            (e) => e.name === name,
          );
          return match ? Option.some(match) : Option.none();
        }),
      findByAlias: (alias) =>
        Effect.sync(() => {
          const aliasEntry = savedAliases.find((a) => a.alias === alias);
          if (!aliasEntry) return Option.none();
          const match = savedEntities.get(aliasEntry.entityId);
          return match ? Option.some(match) : Option.none();
        }),
      upsertEntity: (input: CreateEntityInput) =>
        Effect.sync(() => {
          const entity: Entity = {
            id: input.id,
            name: input.name,
            entityType: input.entityType,
            description: input.description ?? null,
            properties: input.properties ?? {},
            metadata: input.metadata ?? {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          savedEntities.set(entity.id, entity);
          return entity;
        }),
      updateEntity: (id: string, input: UpdateEntityInput) =>
        Effect.sync(() => {
          const existing = savedEntities.get(id);
          if (!existing) return Option.none();
          const updated: Entity = {
            ...existing,
            description: input.description ?? existing.description,
            properties: input.properties ?? existing.properties,
            metadata: input.metadata ?? existing.metadata,
            updatedAt: new Date(),
          };
          savedEntities.set(id, updated);
          return Option.some(updated);
        }),
      addAlias: (alias) =>
        Effect.sync(() => {
          savedAliases.push(alias);
          return alias;
        }),
      listAliases: (entityId) =>
        Effect.sync(() => savedAliases.filter((a) => a.entityId === entityId)),
      searchByName: () => Effect.succeed([]),
      getTopConnected: (limit = 10) =>
        Effect.sync(() => Array.from(savedEntities.values()).slice(0, limit)),
      deleteEntity: (id) => Effect.sync(() => savedEntities.delete(id)),
      count: () => Effect.sync(() => savedEntities.size),
      getRelatedDocuments: () => Effect.succeed([]),
    };

    const mockGraphRepo: GraphRepositoryShape = {
      upsertEdge: (input: CreateEdgeInput) =>
        Effect.sync(() => {
          const edge: Edge = {
            sourceId: input.sourceId,
            targetId: input.targetId,
            relationType: input.relationType,
            weight: input.weight ?? 1.0,
            confidence: input.confidence ?? 0.8,
            properties: input.properties ?? {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          savedEdges.push(edge);
          return edge;
        }),
      findEdge: (sourceId, targetId, relationType) =>
        Effect.sync(() => {
          const found = savedEdges.find(
            (e) =>
              e.sourceId === sourceId &&
              e.targetId === targetId &&
              e.relationType === relationType,
          );
          return found ? Option.some(found) : Option.none();
        }),
      getOutboundEdges: (sourceId) =>
        Effect.sync(() => savedEdges.filter((e) => e.sourceId === sourceId)),
      getInboundEdges: (targetId) =>
        Effect.sync(() => savedEdges.filter((e) => e.targetId === targetId)),
      getNeighborhood: () => Effect.succeed({ entityIds: [], edges: [] }),
      deleteEdge: (sourceId, targetId, relationType) =>
        Effect.sync(() => {
          const idx = savedEdges.findIndex(
            (e) =>
              e.sourceId === sourceId &&
              e.targetId === targetId &&
              e.relationType === relationType,
          );
          if (idx >= 0) {
            savedEdges.splice(idx, 1);
            return true;
          }
          return false;
        }),
      countEdges: () => Effect.sync(() => savedEdges.length),
    };

    const mockFiles = {
      "rfcs/rfc-001.md": {
        content: `# RFC 001: Durable State

Golem Cloud provides durable agents built with Effect-TS and WebAssembly.
PostgreSQL stores the persistent relational graph entities.
`,
        etag: "etag_rfc_1",
      },
      "specs/spec-001.md": {
        content: `# Architecture Specification

Docker containerizes the development environment for Ollama and PostgreSQL.
`,
        etag: "etag_spec_1",
      },
      "ignored/notes.txt": {
        content: `This file is outside configured prefixes and should be ignored.`,
        etag: "etag_ignored",
      },
    };

    const testMockLayers = Layer.mergeAll(
      Layer.succeed(DocumentRepository, mockDocRepo),
      Layer.succeed(ChunkRepository, mockChunkRepo),
      Layer.succeed(CheckpointRepository, mockCheckpointRepo),
      Layer.succeed(EntityRepository, mockEntityRepo),
      Layer.succeed(GraphRepository, mockGraphRepo),
      EntityResolverService.Default.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(EntityRepository, mockEntityRepo),
            Layer.succeed(GraphRepository, mockGraphRepo),
          ),
        ),
      ),
      EmbeddingService.Mock,
      ExtractionService.Default,
      S3ConnectorService.Mock(mockFiles, {
        main: { prefixes: ["rfcs/", "specs/"] },
      }),
    );

    it("should execute full ingestion pipeline across multiple prefixes", async () => {
      const initialState: S3TaskState = {
        resourceName: "main",
        status: "IDLE",
        lastSyncTimestamp: null,
        processedKeys: {},
        cursor: null,
        metrics: {
          totalDiscovered: 0,
          totalSynced: 0,
          totalFailed: 0,
          lastDurationMs: 0,
        },
        errorMessage: null,
      };

      const result = await Effect.runPromise(
        runS3Ingestion("main", initialState).pipe(
          Effect.provide(testMockLayers),
        ),
      );

      assert.equal(result.status, "COMPLETED");
      assert.equal(result.metrics.totalDiscovered, 2); // rfcs/rfc-001.md and specs/spec-001.md
      assert.equal(result.metrics.totalSynced, 2);
      assert.equal(result.metrics.totalFailed, 0);
      assert.ok(result.lastSyncTimestamp !== null);
      assert.equal(result.processedKeys["rfcs/rfc-001.md"], "etag_rfc_1");
      assert.equal(result.processedKeys["specs/spec-001.md"], "etag_spec_1");
      assert.equal(result.processedKeys["ignored/notes.txt"], undefined);

      // Verify documents were saved
      assert.equal(savedDocs.size, 2);

      // Verify chunks were created with embeddings
      assert.ok(savedChunks.length >= 2);
      for (const chunk of savedChunks) {
        assert.ok(chunk.embedding);
        assert.equal(chunk.embedding.length, 768);
      }

      // Verify entities were extracted and saved into EntityRepository
      assert.ok(savedEntities.size > 0);
      const entityNames = Array.from(savedEntities.values()).map((e) => e.name);
      assert.ok(
        entityNames.includes("Golem Cloud") ||
          entityNames.includes("Effect-TS") ||
          entityNames.includes("PostgreSQL"),
      );

      // Verify checkpoint was saved
      assert.ok(savedCheckpoints.has("s3_main"));
      const checkpoint = savedCheckpoints.get("s3_main")!;
      assert.equal(checkpoint.status, "COMPLETED");
    });

    it("should skip unmodified documents on incremental sync", async () => {
      const stateAfterFirstRun: S3TaskState = {
        resourceName: "main",
        status: "COMPLETED",
        lastSyncTimestamp: new Date().toISOString(),
        processedKeys: {
          "rfcs/rfc-001.md": "etag_rfc_1",
          "specs/spec-001.md": "etag_spec_1",
        },
        cursor: null,
        metrics: {
          totalDiscovered: 2,
          totalSynced: 2,
          totalFailed: 0,
          lastDurationMs: 100,
        },
        errorMessage: null,
      };

      const result = await Effect.runPromise(
        runS3Ingestion("main", stateAfterFirstRun).pipe(
          Effect.provide(testMockLayers),
        ),
      );

      assert.equal(result.status, "COMPLETED");
      // Discover returns 0 new items because ETags match and timestamp didn't change
      assert.equal(result.metrics.totalSynced, 2); // 2 total from before, 0 added
    });

    it("should re-scan all documents when force is enabled", async () => {
      const stateWithCursor: S3TaskState = {
        resourceName: "main",
        status: "COMPLETED",
        lastSyncTimestamp: new Date().toISOString(),
        processedKeys: {
          "rfcs/rfc-001.md": "etag_rfc_1",
          "specs/spec-001.md": "etag_spec_1",
        },
        cursor: null,
        metrics: {
          totalDiscovered: 2,
          totalSynced: 2,
          totalFailed: 0,
          lastDurationMs: 100,
        },
        errorMessage: null,
      };

      const result = await Effect.runPromise(
        runS3Ingestion("main", stateWithCursor, { force: true }).pipe(
          Effect.provide(testMockLayers),
        ),
      );

      assert.equal(result.status, "COMPLETED");
      // Force causes re-discovery of all 2 prefix items
      assert.equal(result.metrics.totalDiscovered, 4); // 2 previous + 2 new
      assert.equal(result.metrics.totalSynced, 4);
    });
  });
});
