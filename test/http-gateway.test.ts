import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import {
  AnswerResponseSchema,
  CoordinatorStateSchema,
  EntityResultSchema,
  EntitySearchRequestSchema,
  EntitySearchResponseSchema,
  KnowledgeBaseOverviewSchema,
  NeighborhoodResponseSchema,
  PathFindingResultSchema,
  SearchResponseSchema,
  SyncScheduleSchema,
  TaskRunSummarySchema,
  WebhookIngestPayloadSchema,
  type WebhookIngestPayload,
} from "../src/agents/types.js";

describe("Phase 6: Golem Native HTTP Gateway & Agent Mounts", () => {
  describe("golem.yaml Application Manifest HTTP Deployments", () => {
    it("should correctly configure httpApi.deployments.local with domain and all 3 core agents", () => {
      const manifestPath = path.resolve(process.cwd(), "golem.yaml");
      assert.ok(fs.existsSync(manifestPath), "golem.yaml must exist");

      const manifestContent = fs.readFileSync(manifestPath, "utf-8");

      assert.ok(
        manifestContent.includes("httpApi:"),
        "httpApi must be defined in golem.yaml",
      );
      assert.ok(
        manifestContent.includes("deployments:"),
        "deployments must be defined",
      );
      assert.ok(
        manifestContent.includes("local:"),
        "local environment deployment must be defined",
      );
      assert.ok(
        manifestContent.includes("domain: golem-kgs-effect.localhost:9006") ||
          manifestContent.includes("domain: localhost:9006"),
        "local domain must be configured for localhost:9006",
      );
      assert.ok(
        manifestContent.includes("KnowledgeAccessAgent:"),
        "KnowledgeAccessAgent must be deployed",
      );
      assert.ok(
        manifestContent.includes("IngestionCoordinatorAgent:"),
        "IngestionCoordinatorAgent must be deployed",
      );
      assert.ok(
        manifestContent.includes("S3IngestorTaskAgent:"),
        "S3IngestorTaskAgent must be deployed",
      );
      assert.ok(
        manifestContent.includes("WebIngestorTaskAgent:"),
        "WebIngestorTaskAgent must be deployed",
      );
      assert.ok(
        !manifestContent.includes("Counter:"),
        "Counter must not be deployed",
      );
    });
  });

  describe("Webhook Schemas & Contracts", () => {
    describe("WebhookIngestPayloadSchema", () => {
      it("should decode a full push webhook payload", () => {
        const raw = {
          action: "s3:ObjectCreated:Put",
          force: true,
        };

        const decoded: WebhookIngestPayload = Schema.decodeUnknownSync(
          WebhookIngestPayloadSchema,
        )(raw);
        assert.equal(decoded.action, "s3:ObjectCreated:Put");
        assert.equal(decoded.force, true);
      });

      it("should decode an empty or partial push webhook payload with defaults", () => {
        const raw = {};
        const decoded = Schema.decodeUnknownSync(WebhookIngestPayloadSchema)(
          raw,
        );
        assert.equal(decoded.action, undefined);
        assert.equal(decoded.force, undefined);
      });

      it("should reject payload with invalid types", () => {
        const raw = { force: "not-a-boolean" };
        assert.throws(() => {
          Schema.decodeUnknownSync(WebhookIngestPayloadSchema)(raw);
        });
      });
    });
  });

  describe("HTTP Gateway Route Routing & Parameter Extraction", () => {
    // Helper to simulate URL matching against Golem mount/endpoint patterns
    function matchRoute(
      pattern: string,
      urlPath: string,
    ): Record<string, string> | null {
      const paramNames: string[] = [];
      const regexPattern = pattern.replace(
        /\{([a-zA-Z0-9_-]+)\}/g,
        (_, name) => {
          paramNames.push(name);
          return "([^/]+)";
        },
      );
      const regex = new RegExp(`^${regexPattern}$`);
      const match = urlPath.match(regex);
      if (!match) return null;

      const params: Record<string, string> = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return params;
    }

    it("should match KnowledgeAccessAgent entity lookup route: /api/knowledge/entities/{id}", () => {
      const pattern = "/api/knowledge/entities/{id}";
      const params = matchRoute(pattern, "/api/knowledge/entities/ent_golem_1");

      assert.ok(params !== null);
      assert.equal(params?.id, "ent_golem_1");
    });

    it("should match KnowledgeAccessAgent document lookup route: /api/knowledge/documents/{id}", () => {
      const pattern = "/api/knowledge/documents/{id}";
      const params = matchRoute(
        pattern,
        "/api/knowledge/documents/doc_rfc_101",
      );

      assert.ok(params !== null);
      assert.equal(params?.id, "doc_rfc_101");
    });

    it("should match KnowledgeAccessAgent overview route: /api/knowledge/overview", () => {
      const pattern = "/api/knowledge/overview";
      const params = matchRoute(pattern, "/api/knowledge/overview");
      assert.ok(params !== null);
    });

    it("should match KnowledgeAccessAgent entity search route: /api/knowledge/entities/search", () => {
      const pattern = "/api/knowledge/entities/search";
      const params = matchRoute(pattern, "/api/knowledge/entities/search");
      assert.ok(params !== null);
    });

    it("should match KnowledgeAccessAgent top entities route: /api/knowledge/entities/top", () => {
      const pattern = "/api/knowledge/entities/top";
      const params = matchRoute(pattern, "/api/knowledge/entities/top");
      assert.ok(params !== null);
    });

    it("should match IngestionCoordinatorAgent webhook ingress: /api/coordinator/webhook/{sourceType}/{resourceName}", () => {
      const pattern = "/api/coordinator/webhook/{sourceType}/{resourceName}";
      const params = matchRoute(
        pattern,
        "/api/coordinator/webhook/s3/main-docs",
      );

      assert.ok(params !== null);
      assert.equal(params?.sourceType, "s3");
      assert.equal(params?.resourceName, "main-docs");
    });

    it("should match IngestionCoordinatorAgent status route: /api/coordinator/status", () => {
      const pattern = "/api/coordinator/status";
      const params = matchRoute(pattern, "/api/coordinator/status");
      assert.ok(params !== null);
    });

    it("should match S3IngestorTaskAgent sync route: /api/ingestion/s3/{resourceName}/sync", () => {
      const pattern = "/api/ingestion/s3/{resourceName}/sync";
      const params = matchRoute(pattern, "/api/ingestion/s3/technical/sync");

      assert.ok(params !== null);
      assert.equal(params?.resourceName, "technical");
    });

    it("should match WebIngestorTaskAgent sync route: /api/ingestion/web/{resourceName}/sync", () => {
      const pattern = "/api/ingestion/web/{resourceName}/sync";
      const params = matchRoute(pattern, "/api/ingestion/web/golem-docs/sync");

      assert.ok(params !== null);
      assert.equal(params?.resourceName, "golem-docs");
    });

    it("should match WebIngestorTaskAgent status route: /api/ingestion/web/{resourceName}/status", () => {
      const pattern = "/api/ingestion/web/{resourceName}/status";
      const params = matchRoute(
        pattern,
        "/api/ingestion/web/golem-docs/status",
      );

      assert.ok(params !== null);
      assert.equal(params?.resourceName, "golem-docs");
    });
  });

  describe("HTTP Response Mapping & Schema Verification", () => {
    it("should correctly handle Schema.NullOr for 200 vs 404 response conventions", () => {
      const NullableEntitySchema = Schema.NullOr(EntityResultSchema);

      // Found case (HTTP 200)
      const foundRaw = {
        id: "ent_42",
        name: "Vector Search",
        entityType: "TECHNOLOGY",
        description: "High-dimensional similarity indexing",
        properties: "{}",
        metadata: JSON.stringify({ confidence: 0.98 }),
        createdAt: "2026-09-06T12:00:00.000Z",
        updatedAt: "2026-09-06T12:00:00.000Z",
      };
      const foundDecoded =
        Schema.decodeUnknownSync(NullableEntitySchema)(foundRaw);
      assert.notEqual(foundDecoded, null);
      assert.equal(foundDecoded?.name, "Vector Search");
      assert.deepEqual(foundDecoded?.properties, {});
      assert.deepEqual(foundDecoded?.metadata, { confidence: 0.98 });

      // Not Found case (HTTP 404)
      const notFoundDecoded =
        Schema.decodeUnknownSync(NullableEntitySchema)(null);
      assert.equal(notFoundDecoded, null);
    });

    it("should validate KnowledgeBaseOverviewSchema structure for GET /api/knowledge/overview", () => {
      const overviewRaw = {
        totalDocuments: 120,
        totalChunks: 580,
        totalEntities: 340,
        totalRelationships: 610,
        supportedSources: ["s3", "gdrive"],
        lastSynchronizedAt: "2026-09-06T18:00:00.000Z",
      };

      const decoded = Schema.decodeUnknownSync(KnowledgeBaseOverviewSchema)(
        overviewRaw,
      );
      assert.equal(decoded.totalDocuments, 120);
      assert.equal(decoded.totalChunks, 580);
      assert.deepEqual(decoded.supportedSources, ["s3", "gdrive"]);
    });

    it("should validate CoordinatorStateSchema for GET /api/coordinator/status", () => {
      const coordinatorRaw = {
        schedules: {
          "s3:main": {
            sourceType: "s3",
            resourceName: "main",
            intervalSeconds: 3600,
            lastScheduledAt: "2026-09-06T19:00:00.000Z",
            lastRunAt: "2026-09-06T18:00:00.000Z",
            status: "ACTIVE",
          },
        },
        aggregatedMetrics: {
          totalRunsTriggered: 15,
          totalSuccesses: 14,
          totalFailures: 1,
        },
      };

      const decoded = Schema.decodeUnknownSync(CoordinatorStateSchema)(
        coordinatorRaw,
      );
      assert.equal(decoded.aggregatedMetrics.totalRunsTriggered, 15);
      assert.equal(decoded.aggregatedMetrics.totalSuccesses, 14);
      assert.equal(decoded.schedules["s3:main"].status, "ACTIVE");
    });

    it("should validate SearchResponseSchema for POST /api/knowledge/search", () => {
      const searchRaw = {
        query: "distributed transactions",
        totalResults: 1,
        results: [
          {
            chunkId: "chk_tx_1",
            documentId: "doc_tx_1",
            content: "Sagas provide eventual consistency across microservices.",
            score: 0.92,
            metadata: "{}",
          },
        ],
      };

      const decoded = Schema.decodeUnknownSync(SearchResponseSchema)(searchRaw);
      assert.equal(decoded.query, "distributed transactions");
      assert.equal(decoded.results.length, 1);
      assert.equal(decoded.results[0].score, 0.92);
      assert.deepEqual(decoded.results[0].metadata, {});
    });

    it("should validate AnswerResponseSchema for POST /api/knowledge/ask", () => {
      const answerRaw = {
        question: "How does Golem achieve durability?",
        answer:
          "Golem persists all host operations and component inputs to a durable oplog.",
        confidenceScore: 0.95,
        citations: [
          {
            chunkId: "chk_golem_durability",
            documentId: "doc_golem_arch",
            sourceUri: "s3://specs/architecture.md",
            title: "Architecture",
            excerpt: "Operation log records every invocation.",
          },
        ],
        groundedEntities: [],
        groundedRelationships: [],
      };

      const decoded = Schema.decodeUnknownSync(AnswerResponseSchema)(answerRaw);
      assert.equal(decoded.confidenceScore, 0.95);
      assert.equal(decoded.citations.length, 1);
      assert.equal(
        decoded.citations[0].sourceUri,
        "s3://specs/architecture.md",
      );
    });

    it("should validate EntitySearchResponseSchema for POST /api/knowledge/entities/search", () => {
      const entitySearchRaw = {
        entities: [
          {
            id: "ent_technology_postgresql",
            name: "PostgreSQL",
            entityType: "TECHNOLOGY",
            description: "Relational database",
            properties: "{}",
            metadata: "{}",
          },
        ],
        total: 1,
        query: "postgres",
      };

      const decoded = Schema.decodeUnknownSync(EntitySearchResponseSchema)(
        entitySearchRaw,
      );
      assert.equal(decoded.total, 1);
      assert.equal(decoded.query, "postgres");
      assert.equal(decoded.entities[0].name, "PostgreSQL");
    });

    it("should validate EntitySearchRequestSchema for optional query and limit", () => {
      const emptyReq = {};
      const decodedEmpty = Schema.decodeUnknownSync(EntitySearchRequestSchema)(
        emptyReq,
      );
      assert.equal(decodedEmpty.query, undefined);
      assert.equal(decodedEmpty.limit, undefined);

      const filledReq = { query: "golem", limit: 5 };
      const decodedFilled = Schema.decodeUnknownSync(EntitySearchRequestSchema)(
        filledReq,
      );
      assert.equal(decodedFilled.query, "golem");
      assert.equal(decodedFilled.limit, 5);
    });

    it("should validate NeighborhoodResponseSchema for POST /api/knowledge/neighborhood", () => {
      const neighborhoodRaw = {
        entities: [
          {
            id: "ent_golem_1",
            name: "Golem",
            entityType: "TECHNOLOGY",
            description: "Durable computing platform",
            properties: "{}",
            metadata: "{}",
          },
          {
            id: "ent_golem_2",
            name: "Effect",
            entityType: "TECHNOLOGY",
            description: null,
            properties: "{}",
            metadata: "{}",
          },
        ],
        edges: [
          {
            sourceId: "ent_golem_1",
            targetId: "ent_golem_2",
            relationType: "CONNECTS",
            weight: 1.0,
            confidence: 0.9,
            properties: "{}",
          },
        ],
      };

      const decoded = Schema.decodeUnknownSync(NeighborhoodResponseSchema)(
        neighborhoodRaw,
      );
      assert.equal(decoded.entities.length, 2);
      assert.equal(decoded.entities[0].name, "Golem");
      assert.equal(decoded.edges.length, 1);
      assert.deepEqual(decoded.edges[0].properties, {});
    });

    it("should validate PathFindingResultSchema for POST /api/knowledge/paths", () => {
      const pathsRaw = {
        paths: [
          {
            entityIds: ["ent_a", "ent_b"],
            edges: [],
            totalWeight: 1.0,
          },
        ],
        entities: [
          {
            id: "ent_a",
            name: "Entity A",
            entityType: "CONCEPT",
            description: null,
            properties: "{}",
            metadata: "{}",
          },
        ],
        shortestPathLength: 1,
      };

      const decoded = Schema.decodeUnknownSync(PathFindingResultSchema)(
        pathsRaw,
      );
      assert.equal(decoded.paths.length, 1);
      assert.equal(decoded.entities.length, 1);
      assert.equal(decoded.entities[0].name, "Entity A");
      assert.equal(decoded.shortestPathLength, 1);
    });

    it("should validate SyncScheduleSchema for POST /api/coordinator/schedules", () => {
      const scheduleRaw = {
        sourceType: "s3",
        resourceName: "main-docs",
        intervalSeconds: 1800,
        lastScheduledAt: null,
        lastRunAt: null,
        status: "ACTIVE",
      };

      const decoded = Schema.decodeUnknownSync(SyncScheduleSchema)(scheduleRaw);
      assert.equal(decoded.sourceType, "s3");
      assert.equal(decoded.intervalSeconds, 1800);
      assert.equal(decoded.status, "ACTIVE");
    });

    it("should validate TaskRunSummarySchema for POST /api/coordinator/sync", () => {
      const runRaw = {
        sourceType: "s3",
        resourceName: "main-docs",
        status: "COMPLETED",
        syncedCount: 5,
        failedCount: 0,
        durationMs: 250,
        errorMessage: null,
      };

      const decoded = Schema.decodeUnknownSync(TaskRunSummarySchema)(runRaw);
      assert.equal(decoded.sourceType, "s3");
      assert.equal(decoded.status, "COMPLETED");
      assert.equal(decoded.syncedCount, 5);
    });
  });
});
