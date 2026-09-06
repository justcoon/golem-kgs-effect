import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Redacted, Schema } from "effect";
import {
  CreateEntityInput,
  Entity,
  EntityAlias,
  EntityType,
} from "../src/domain/entity.js";
import {
  CreateEdgeInput,
  Edge,
  RelationType,
} from "../src/domain/relationship.js";
import {
  CreateChunkInput,
  DocumentChunk,
  EntityChunkMention,
  VectorEmbedding,
} from "../src/domain/chunk.js";
import { ProvenanceRecord, RawDocument } from "../src/domain/provenance.js";
import {
  HybridSearchQuery,
  NeighborhoodQuery,
  VectorSearchQuery,
} from "../src/domain/query.js";
import {
  SaveCheckpointInput,
  SyncCheckpoint,
  SyncStatus,
} from "../src/domain/connector.js";
import { DatabaseConfigSchema } from "../src/config/schema.js";

describe("Domain Schemas", () => {
  describe("Entity Schemas", () => {
    it("should validate and parse a valid Entity", () => {
      const now = new Date();
      const raw = {
        id: "ent_golem_1",
        name: "Golem Cloud",
        entityType: "TECHNOLOGY",
        description: "Durable Computing Platform",
        properties: { version: "1.5.0", openSource: true },
        metadata: { confidence: 0.95 },
        createdAt: now,
        updatedAt: now,
      };

      const entity = Schema.decodeUnknownSync(Entity)(raw);
      assert.equal(entity.id, "ent_golem_1");
      assert.equal(entity.name, "Golem Cloud");
      assert.equal(entity.entityType, "TECHNOLOGY");
      assert.equal(
        (entity.properties as Record<string, unknown>).version,
        "1.5.0",
      );
    });

    it("should validate CreateEntityInput with optional properties", () => {
      const raw = {
        id: "ent_kg_1",
        name: "Knowledge Graph",
        entityType: "CONCEPT",
      };

      const parsed = Schema.decodeUnknownSync(CreateEntityInput)(raw);
      assert.equal(parsed.id, "ent_kg_1");
      assert.equal(parsed.name, "Knowledge Graph");
      assert.equal(parsed.properties, undefined);
      assert.equal(parsed.metadata, undefined);
    });

    it("should reject invalid EntityType", () => {
      assert.throws(() => {
        Schema.decodeUnknownSync(EntityType)("INVALID_TYPE");
      });
    });

    it("should validate EntityAlias", () => {
      const alias = Schema.decodeUnknownSync(EntityAlias)({
        alias: "GC",
        entityId: "ent_golem_1",
        source: "manual",
        confidence: 0.9,
      });

      assert.equal(alias.alias, "GC");
      assert.equal(alias.source, "manual");
      assert.equal(alias.confidence, 0.9);
    });
  });

  describe("Relationship & Edge Schemas", () => {
    it("should parse an Edge", () => {
      const now = new Date();
      const raw = {
        id: "edge_1",
        sourceId: "ent_person_1",
        targetId: "ent_doc_1",
        relationType: "AUTHORED_BY",
        weight: 1.0,
        confidence: 0.9,
        properties: { role: "lead" },
        validFrom: null,
        validUntil: null,
        createdAt: now,
        updatedAt: now,
      };

      const edge = Schema.decodeUnknownSync(Edge)(raw);
      assert.equal(edge.relationType, "AUTHORED_BY");
      assert.equal(edge.confidence, 0.9);
    });

    it("should parse CreateEdgeInput with optional fields", () => {
      const input = Schema.decodeUnknownSync(CreateEdgeInput)({
        sourceId: "ent_a",
        targetId: "ent_b",
        relationType: "DEPENDS_ON",
        weight: 1.0,
      });

      assert.equal(input.sourceId, "ent_a");
      assert.equal(input.targetId, "ent_b");
      assert.equal(input.relationType, "DEPENDS_ON");
      assert.equal(input.weight, 1.0);
      assert.equal(input.properties, undefined);
    });

    it("should validate RelationType literals", () => {
      assert.equal(Schema.decodeUnknownSync(RelationType)("OWNS"), "OWNS");
      assert.throws(() =>
        Schema.decodeUnknownSync(RelationType)("INVALID_REL"),
      );
    });
  });

  describe("Chunk and Vector Schemas", () => {
    it("should validate DocumentChunk with vector embedding", () => {
      const now = new Date();
      const dummyVector = new Array(768).fill(0.123);
      const raw = {
        id: "chunk_doc1_0",
        documentId: "doc_1",
        chunkIndex: 0,
        content: "This is a document segment about Golem durable execution.",
        tokenCount: 10,
        embedding: dummyVector,
        metadata: { page: 1 },
        createdAt: now,
        updatedAt: now,
      };

      const chunk = Schema.decodeUnknownSync(DocumentChunk)(raw);
      assert.equal(chunk.chunkIndex, 0);
      assert.equal(chunk.embedding?.length, 768);
    });

    it("should validate CreateChunkInput and VectorEmbedding", () => {
      const vec = Schema.decodeUnknownSync(VectorEmbedding)([0.1, 0.2, 0.3]);
      assert.equal(vec.length, 3);

      const chunkInput = Schema.decodeUnknownSync(CreateChunkInput)({
        id: "chunk_2",
        documentId: "doc_1",
        chunkIndex: 1,
        content: "More content",
      });
      assert.equal(chunkInput.id, "chunk_2");
    });

    it("should validate EntityChunkMention", () => {
      const mention = Schema.decodeUnknownSync(EntityChunkMention)({
        entityId: "ent_1",
        chunkId: "chunk_1",
        mentionText: "Golem Cloud",
        confidence: 1.0,
      });

      assert.equal(mention.confidence, 1.0);
      assert.equal(mention.mentionText, "Golem Cloud");
    });
  });

  describe("Provenance and Document Schemas", () => {
    it("should validate RawDocument and ProvenanceRecord", () => {
      const now = new Date();
      const raw = {
        id: "doc_123",
        title: "Architecture Spec",
        content: "# Spec content",
        metadata: { author: "Agent" },
        tags: ["architecture", "spec"],
        source: "s3",
        namespace: "default",
        sizeBytes: 1024,
        createdAt: now,
        updatedAt: now,
      };

      const doc = Schema.decodeUnknownSync(RawDocument)(raw);
      assert.equal(doc.source, "s3");
      assert.equal(doc.sizeBytes, 1024);
      assert.equal(doc.tags.length, 2);

      const prov = Schema.decodeUnknownSync(ProvenanceRecord)({
        source: "s3",
        documentId: "doc_123",
        timestamp: now,
        author: "Agent",
      });
      assert.equal(prov.source, "s3");
      assert.equal(prov.author, "Agent");
    });
  });

  describe("Query Schemas", () => {
    it("should parse NeighborhoodQuery", () => {
      const query = Schema.decodeUnknownSync(NeighborhoodQuery)({
        seedEntityIds: ["ent_1", "ent_2"],
        depth: 2,
        direction: "BOTH",
      });

      assert.equal(query.depth, 2);
      assert.equal(query.direction, "BOTH");
      assert.equal(query.seedEntityIds.length, 2);
    });

    it("should parse VectorSearchQuery and HybridSearchQuery", () => {
      const vecQuery = Schema.decodeUnknownSync(VectorSearchQuery)({
        embedding: [0.1, 0.2, 0.3],
        topK: 5,
      });
      assert.equal(vecQuery.topK, 5);

      const query = Schema.decodeUnknownSync(HybridSearchQuery)({
        query: "durable workflows",
        embedding: [0.1, 0.2, 0.3],
        limit: 10,
        vectorWeight: 0.5,
      });

      assert.equal(query.limit, 10);
      assert.equal(query.vectorWeight, 0.5);
      assert.equal(query.query, "durable workflows");
    });
  });

  describe("Connector Schemas", () => {
    it("should parse SaveCheckpointInput and SyncCheckpoint", () => {
      const now = new Date();
      const input = Schema.decodeUnknownSync(SaveCheckpointInput)({
        connectorId: "s3-docs-bucket",
        cursorData: { lastEtag: "abc123etag", continuationToken: "tok_xyz" },
        status: "RUNNING",
      });

      assert.equal(input.connectorId, "s3-docs-bucket");
      assert.equal(input.status, "RUNNING");
      assert.equal(
        (input.cursorData as Record<string, unknown>).lastEtag,
        "abc123etag",
      );

      assert.equal(
        Schema.decodeUnknownSync(SyncStatus)("COMPLETED"),
        "COMPLETED",
      );

      const checkpoint = Schema.decodeUnknownSync(SyncCheckpoint)({
        connectorId: "s3-docs-bucket",
        cursorData: { etag: "123" },
        lastSyncTime: now,
        status: "IDLE",
        metrics: { processed: 5 },
        updatedAt: now,
      });
      assert.equal(checkpoint.status, "IDLE");
    });
  });

  describe("Configuration Schemas", () => {
    it("should verify DatabaseConfigSchema decoding", () => {
      const parsed = Schema.decodeUnknownSync(DatabaseConfigSchema)({
        db: {
          host: "localhost",
          db: "golem_kgs",
          port: "5432",
          user: Redacted.make("postgres"),
          password: Redacted.make("password123"),
        },
      });
      assert.equal(parsed.db.host, "localhost");
      assert.equal(parsed.db.db, "golem_kgs");
      assert.equal(Redacted.value(parsed.db.user), "postgres");
    });
  });
});
