import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EntityExtractor } from "../src/pipeline/extractor.js";

describe("Cooccurrence Edge Extractor", () => {
  it("does not generate cooccurrence edges when disabled or undefined", () => {
    const text = "Golem integrates with Postgres and uses Effect.";
    const resultDefault = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "golem", canonical: "Golem" },
        { alias: "postgres", canonical: "PostgreSQL" },
        { alias: "effect", canonical: "Effect" },
      ],
    });
    const coocEdges = resultDefault.edges.filter(
      (e) => e.relationType === "CO_OCCURS_WITH",
    );
    assert.equal(coocEdges.length, 0);

    const resultExplicitDisabled = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "golem", canonical: "Golem" },
        { alias: "postgres", canonical: "PostgreSQL" },
      ],
      cooccurrence: {
        enabled: false,
      },
    });
    assert.equal(resultExplicitDisabled.edges.length, 0);
  });

  it("extracts cooccurrence edges within sentence window", () => {
    const text =
      "Alice works on Golem. Meanwhile, Bob configures PostgreSQL and SQLite.";
    const result = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "golem", canonical: "Golem" },
        { alias: "postgresql", canonical: "PostgreSQL" },
        { alias: "sqlite", canonical: "SQLite" },
      ],
      cooccurrence: {
        enabled: true,
        window: "sentence",
        confidence: 0.8,
        relation: "CO_OCCURS_WITH",
      },
    });

    // In sentence 2: Bob (from proper nouns or dictionary? Bob might not be detected if single word unless in dict or proper noun multi-word)
    // Let's check PostgreSQL and SQLite in sentence 2:
    const edges = result.edges.filter(
      (e) => e.relationType === "CO_OCCURS_WITH",
    );
    assert.ok(edges.length >= 1);

    const pgSqliteEdge = edges.find(
      (e) => e.sourceId.includes("postgresql") && e.targetId.includes("sqlite"),
    );
    assert.ok(pgSqliteEdge, "Should find PostgreSQL -> SQLite edge");
    assert.equal(pgSqliteEdge.confidence, 0.8);
    assert.equal(pgSqliteEdge.relationType, "CO_OCCURS_WITH");

    // Ensure no cross-sentence edge between Golem and PostgreSQL
    const crossEdge = edges.find(
      (e) =>
        (e.sourceId.includes("golem") && e.targetId.includes("postgresql")) ||
        (e.sourceId.includes("postgresql") && e.targetId.includes("golem")),
    );
    assert.equal(crossEdge, undefined);
  });

  it("extracts cross-sentence cooccurrence edges when window is chunk", () => {
    const text = "Alice works on Golem. Meanwhile, Bob configures PostgreSQL.";
    const result = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "golem", canonical: "Golem" },
        { alias: "postgresql", canonical: "PostgreSQL" },
      ],
      cooccurrence: {
        enabled: true,
        window: "chunk",
        confidence: 0.75,
      },
    });

    const edges = result.edges.filter(
      (e) => e.relationType === "CO_OCCURS_WITH",
    );
    assert.equal(edges.length, 1);
    assert.ok(edges[0].sourceId.includes("golem"));
    assert.ok(edges[0].targetId.includes("postgresql"));
  });

  it("respects maxEdgesPerChunk limit", () => {
    const text =
      "Alpha System, Beta System, Gamma System, and Delta System are deployed together.";
    const result = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "alpha", canonical: "Alpha System" },
        { alias: "beta", canonical: "Beta System" },
        { alias: "gamma", canonical: "Gamma System" },
        { alias: "delta", canonical: "Delta System" },
      ],
      cooccurrence: {
        enabled: true,
        window: "chunk",
        maxEdgesPerChunk: 2,
      },
    });

    const edges = result.edges.filter(
      (e) => e.relationType === "CO_OCCURS_WITH",
    );
    assert.equal(edges.length, 2);
  });

  it("matches canonical names in dictionary even without alias in text", () => {
    const text =
      "The Knowledge Graph System utilizes Durable Execution for fault tolerance.";
    const result = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "KGS", canonical: "Knowledge Graph System" },
        { alias: "DE", canonical: "Durable Execution" },
      ],
      cooccurrence: {
        enabled: true,
        window: "sentence",
      },
    });

    const kgsEntity = result.entities.find((e) =>
      e.name.includes("Knowledge Graph System"),
    );
    const deEntity = result.entities.find((e) =>
      e.name.includes("Durable Execution"),
    );
    assert.ok(kgsEntity, "Should extract canonical Knowledge Graph System");
    assert.ok(deEntity, "Should extract canonical Durable Execution");

    const edge = result.edges.find((e) => e.relationType === "CO_OCCURS_WITH");
    assert.ok(
      edge,
      "Should create cooccurrence edge between canonical entities",
    );
    assert.equal(edge.sourceId, kgsEntity.id);
    assert.equal(edge.targetId, deEntity.id);
  });

  it("deduplicates identical entity pairs across sentences", () => {
    const text =
      "Golem works well with PostgreSQL. Later in the chapter, Golem and PostgreSQL are discussed again.";
    const result = EntityExtractor.extract(text, "doc_1", 0, {
      dictionary: [
        { alias: "golem", canonical: "Golem" },
        { alias: "postgresql", canonical: "PostgreSQL" },
      ],
      cooccurrence: {
        enabled: true,
        window: "sentence",
      },
    });

    const coocEdges = result.edges.filter(
      (e) => e.relationType === "CO_OCCURS_WITH",
    );
    assert.equal(coocEdges.length, 1);
  });
});
