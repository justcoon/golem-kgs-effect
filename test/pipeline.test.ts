import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Redacted, Schema } from "effect";
import {
  CooccurrenceConfigSchema,
  EmbeddingConfigSchema,
  ExtractionConfigSchema,
  RelationPatternRuleSchema,
} from "../src/config/schema.js";
import { DocumentChunker } from "../src/pipeline/chunker.js";
import {
  EMBEDDING_DIMENSION,
  EmbeddingService,
  createMockEmbedding,
} from "../src/pipeline/embedding-service.js";
import { EntityExtractor } from "../src/pipeline/extractor.js";
import { fuseConfidence } from "../src/pipeline/fusion-utils.js";
import { type RawDocument } from "../src/domain/provenance.js";

describe("Phase 2 Processing Pipeline & Semantic Services", () => {
  describe("Embedding Configuration Schema", () => {
    it("should decode valid EmbeddingConfigSchema with Redacted apiKey", () => {
      const parsed = Schema.decodeUnknownSync(EmbeddingConfigSchema)({
        embedding: {
          api_base: "http://localhost:11434/v1",
          model: "nomic-embed-text",
          apiKey: Redacted.make("ollama"),
        },
      });

      assert.equal(parsed.embedding.api_base, "http://localhost:11434/v1");
      assert.equal(parsed.embedding.model, "nomic-embed-text");
      assert.equal(Redacted.value(parsed.embedding.apiKey), "ollama");
    });
  });

  describe("Document Chunker", () => {
    const sampleMarkdown = `
# System Architecture

The Knowledge Graph System provides enterprise knowledge modeling.
Built on Golem's durable computing runtime, it ensures high reliability.

## Storage Substrate

PostgreSQL provides ACID persistence for graph entities.
It stores entities, relationships, and document chunks with vector embeddings.

### Indexing Mechanisms

HNSW indexes enable fast approximate nearest neighbor search.
Lexical full-text search indexes provide keyword recall.
`;

    it("should chunk markdown documents and preserve heading breadcrumbs", () => {
      const result = DocumentChunker.chunkText("doc_arch_1", sampleMarkdown, {
        maxChunkSize: 300,
        chunkOverlap: 50,
      });

      assert.ok(result.totalChunks >= 2);
      assert.equal(result.documentId, "doc_arch_1");

      // Verify that heading breadcrumbs are present in the chunks
      const hasHeadingContext = result.chunks.some((c) =>
        c.content.includes("[Context: System Architecture"),
      );
      assert.ok(hasHeadingContext, "Expected chunk to include section context");

      // Verify chunk metadata
      const firstChunk = result.chunks[0];
      assert.equal(firstChunk.chunkIndex, 0);
      assert.ok((firstChunk.tokenCount ?? 0) > 0);
      assert.ok(firstChunk.metadata?.charCount);
    });

    it("should chunk RawDocument domain model with Effect", async () => {
      const now = new Date();
      const rawDoc: RawDocument = {
        id: "doc_spec_1",
        title: "Technical Specification",
        content: sampleMarkdown,
        metadata: { category: "architecture" },
        tags: ["design", "golem"],
        source: "s3",
        resourceName: "engineering",
        sourceKey: "specs/v1.md",
        sizeBytes: Buffer.byteLength(sampleMarkdown, "utf8"),
        createdAt: now,
        updatedAt: now,
      };

      const result = await Effect.runPromise(
        DocumentChunker.chunkDocument(rawDoc, { maxChunkSize: 400 }),
      );

      assert.equal(result.documentId, "doc_spec_1");
      assert.ok(result.totalChunks >= 1);
      assert.equal(
        result.chunks[0].metadata?.documentTitle,
        "Technical Specification",
      );
      assert.equal(result.chunks[0].metadata?.resourceName, "engineering");
      assert.equal(result.chunks[0].metadata?.sourceKey, "specs/v1.md");
    });

    it("should handle empty or whitespace-only documents cleanly", () => {
      const result = DocumentChunker.chunkText("doc_empty", "   \n\n  ");
      assert.equal(result.totalChunks, 0);
      assert.equal(result.chunks.length, 0);
    });
  });

  describe("Embedding Service & Vector Math", () => {
    it("should create deterministic normalized 768-dimensional mock embeddings", () => {
      const text = "Golem durable computing with Effect TypeScript";
      const vec1 = createMockEmbedding(text);
      const vec2 = createMockEmbedding(text);

      assert.equal(vec1.length, EMBEDDING_DIMENSION);
      assert.equal(vec1.length, 768);

      // Verify determinism
      assert.deepEqual(vec1, vec2);

      // Verify normalization (L2 norm should be approximately 1.0)
      let sumSquares = 0;
      for (const val of vec1) {
        sumSquares += val * val;
      }
      assert.ok(
        Math.abs(sumSquares - 1.0) < 0.05,
        `Expected norm close to 1.0, got ${sumSquares}`,
      );

      // Different text yields different vector
      const vecDiff = createMockEmbedding("Completely different topic");
      assert.notDeepEqual(vec1, vecDiff);
    });

    it("should generate embeddings via EmbeddingService.Mock layer", async () => {
      const program = Effect.gen(function* () {
        const service = yield* EmbeddingService;
        const single = yield* service.generateEmbedding("Test sentence");
        const batch = yield* service.generateEmbeddings([
          "Sentence A",
          "Sentence B",
        ]);
        return { single, batch };
      }).pipe(Effect.provide(EmbeddingService.Mock));

      const { single, batch } = await Effect.runPromise(program);

      assert.equal(single.length, 768);
      assert.equal(batch.length, 2);
      assert.equal(batch[0].length, 768);
      assert.equal(batch[1].length, 768);
    });
  });

  describe("Entity & Relation Extraction", () => {
    it("should extract acronyms as entities and aliases", () => {
      const text =
        "The Knowledge Graph System (KGS) stores interconnected organizational facts.";
      const extracted = EntityExtractor.extract(text, "doc_test_1", 0);

      assert.ok(
        extracted.entities.some((e) => e.name === "Knowledge Graph System"),
      );
      assert.ok(
        extracted.aliases.some(
          (a) =>
            a.alias === "KGS" && a.entityId.includes("knowledge_graph_system"),
        ),
      );
    });

    const sampleTechRules = {
      dictionary: {
        "golem cloud": "Golem Cloud",
        golem: "Golem Cloud",
        postgresql: "PostgreSQL",
        postgres: "PostgreSQL",
        pgvector: "pgvector",
        webassembly: "WebAssembly",
        docker: "Docker",
      },
      relationPatterns: [
        {
          relation: "DEPENDS_ON",
          phrases: ["utilizes", "requires", "uses", "depends on"],
          confidence: 0.85,
        },
      ],
    };

    it("should extract known technologies and documents", () => {
      const text =
        "Golem Cloud components run on WebAssembly and use PostgreSQL with pgvector for persistence. See `golem.yaml`.";
      const extracted = EntityExtractor.extract(
        text,
        "doc_test_2",
        1,
        sampleTechRules,
      );

      const names = extracted.entities.map((e) => e.name);
      assert.ok(names.includes("Golem Cloud"));
      assert.ok(names.includes("PostgreSQL"));
      assert.ok(names.includes("pgvector"));
      assert.ok(names.includes("WebAssembly"));
      assert.ok(names.includes("golem.yaml"));
    });

    it("should extract relational triples based on linguistic patterns", () => {
      const text =
        "Golem Cloud utilizes PostgreSQL for storage and requires Docker for deployment.";
      const extracted = EntityExtractor.extract(
        text,
        "doc_test_3",
        0,
        sampleTechRules,
      );

      assert.ok(extracted.edges.length >= 1);
      const edge = extracted.edges[0];
      assert.equal(edge.relationType, "DEPENDS_ON");
      assert.ok(edge.sourceId.includes("golem_cloud"));
      assert.ok(edge.targetId.includes("postgresql"));
    });

    it("should extract custom domain entities and relations when custom rules are provided", () => {
      const customRules = {
        dictionary: {
          gdpr: "General Data Protection Regulation",
          ccpa: "California Consumer Privacy Act",
        },
        relationPatterns: [
          {
            relation: "GOVERNED_BY",
            phrases: ["is governed by", "governed by", "subject to"],
            confidence: 0.92,
          },
        ],
        stopwords: ["Legal Notice", "Article"],
      };

      const text =
        "Customer Data is governed by GDPR and must comply with CCPA.";
      const extracted = EntityExtractor.extract(
        text,
        "doc_legal_1",
        0,
        customRules,
      );

      const names = extracted.entities.map((e) => e.name);
      assert.ok(names.includes("General Data Protection Regulation"));
      assert.ok(names.includes("California Consumer Privacy Act"));

      assert.ok(extracted.edges.length >= 1);
      const edge = extracted.edges.find(
        (e) => e.relationType === "GOVERNED_BY",
      );
      assert.ok(edge);
      assert.equal(edge?.confidence, 0.92);
    });

    it("should respect custom stopwords to filter false-positive proper nouns", () => {
      const customRules = {
        stopwords: ["Legal Notice", "Table Of Contents"],
      };

      const text = "Legal Notice: The System Architecture requires review.";
      const extracted = EntityExtractor.extract(
        text,
        "doc_legal_2",
        0,
        customRules,
      );

      const names = extracted.entities.map((e) => e.name);
      assert.ok(!names.includes("Legal Notice"));
      assert.ok(names.includes("System Architecture"));
    });

    it("should not match default technologies when empty dictionary is provided", () => {
      const emptyRules = {
        dictionary: {},
        relationPatterns: [],
      };

      const text = "We run Postgres and Docker in production.";
      const extracted = EntityExtractor.extract(
        text,
        "doc_clean_1",
        0,
        emptyRules,
      );

      const names = extracted.entities.map((e) => e.name);
      assert.ok(!names.includes("PostgreSQL"));
      assert.ok(!names.includes("Docker"));
      assert.equal(extracted.edges.length, 0);
    });

    it("should validate ExtractionConfigSchema and RelationPatternRuleSchema", () => {
      const parsedRule = Schema.decodeUnknownSync(RelationPatternRuleSchema)({
        relation: "MANAGES",
        phrases: ["manages", "supervises"],
        confidence: 0.88,
      });
      assert.equal(parsedRule.relation, "MANAGES");
      assert.equal(parsedRule.confidence, 0.88);

      const parsedCooccurrence = Schema.decodeUnknownSync(
        CooccurrenceConfigSchema,
      )({
        enabled: true,
        window: "sentence",
        confidence: 0.75,
        relation: "CO_OCCURS_WITH",
        maxEdgesPerChunk: 25,
      });
      assert.equal(parsedCooccurrence.enabled, true);
      assert.equal(parsedCooccurrence.window, "sentence");
      assert.equal(parsedCooccurrence.confidence, 0.75);
      assert.equal(parsedCooccurrence.relation, "CO_OCCURS_WITH");
      assert.equal(parsedCooccurrence.maxEdgesPerChunk, 25);

      const parsedConfig = Schema.decodeUnknownSync(ExtractionConfigSchema)({
        dictionary: [{ alias: "k8s", canonical: "Kubernetes" }],
        relationPatterns: [parsedRule],
        stopwords: ["Notice"],
        cooccurrence: parsedCooccurrence,
      });
      assert.equal(parsedConfig.dictionary?.[0]?.alias, "k8s");
      assert.equal(parsedConfig.dictionary?.[0]?.canonical, "Kubernetes");
      assert.equal(parsedConfig.relationPatterns?.length, 1);
      assert.equal(parsedConfig.stopwords?.[0], "Notice");
      assert.equal(parsedConfig.cooccurrence?.enabled, true);
      assert.equal(parsedConfig.cooccurrence?.relation, "CO_OCCURS_WITH");
    });
  });

  describe("Entity Resolution & Confidence Fusion", () => {
    it("should compute Bayesian confidence updates correctly", () => {
      // Two 0.80 observations should fuse to: 1 - (1 - 0.8) * (1 - 0.8) = 1 - 0.04 = 0.96
      const fused1 = fuseConfidence(0.8, 0.8);
      assert.equal(fused1, 0.96);

      // Low confidence + high confidence
      const fused2 = fuseConfidence(0.5, 0.9);
      assert.equal(fused2, 0.95);

      // Boundary handling
      const maxFused = fuseConfidence(0.99, 0.99);
      assert.ok(maxFused <= 0.999);
      assert.ok(maxFused >= 0.99);
    });
  });
});
