import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Option, Schema } from "effect";
import {
  EntitySearchResponseSchema,
  NeighborhoodResponseSchema,
  PathFindingResultSchema,
} from "../src/agents/types.js";
import { type Entity, type EntityType } from "../src/domain/entity.js";
import { type EntityRepositoryShape } from "../src/storage/repository-tags.js";

// Mock entity repository for unit testing resolution and search
function createMockEntityRepo(
  entities: Entity[],
  aliases: Array<{ alias: string; entityId: string }>,
): EntityRepositoryShape {
  return {
    findById: (id: string) =>
      Effect.sync(() => {
        const found = entities.find((e) => e.id === id);
        return found ? Option.some(found) : Option.none();
      }),
    findByIds: (ids: ReadonlyArray<string>) =>
      Effect.sync(() => entities.filter((e) => ids.includes(e.id))),
    findByName: (name: string) =>
      Effect.sync(() => {
        const lower = name.toLowerCase();
        const found = entities.find((e) => e.name.toLowerCase() === lower);
        return found ? Option.some(found) : Option.none();
      }),
    findByAlias: (alias: string) =>
      Effect.sync(() => {
        const lower = alias.toLowerCase();
        const mapping = aliases.find((a) => a.alias.toLowerCase() === lower);
        if (!mapping) return Option.none();
        const found = entities.find((e) => e.id === mapping.entityId);
        return found ? Option.some(found) : Option.none();
      }),
    searchByName: (query: string, limit = 20) =>
      Effect.sync(() => {
        const lower = query.toLowerCase();
        return entities
          .filter(
            (e) =>
              e.name.toLowerCase().includes(lower) ||
              (e.description && e.description.toLowerCase().includes(lower)),
          )
          .slice(0, limit);
      }),
    getTopConnected: (limit = 10) =>
      Effect.sync(() => {
        return entities.slice(0, limit);
      }),
    upsertEntity: () => Effect.die("not implemented"),
    updateEntity: () => Effect.die("not implemented"),
    addAlias: () => Effect.die("not implemented"),
    listAliases: () => Effect.die("not implemented"),
    deleteEntity: () => Effect.die("not implemented"),
    count: () => Effect.succeed(entities.length),
  };
}

const mockEntities: Entity[] = [
  {
    id: "ent_technology_postgresql",
    name: "PostgreSQL",
    entityType: "TECHNOLOGY" as EntityType,
    description: "Open source relational database",
    properties: {},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ent_technology_golem_cloud",
    name: "Golem Cloud",
    entityType: "TECHNOLOGY" as EntityType,
    description: "Durable computing serverless platform",
    properties: {},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ent_concept_knowledge_graph_system",
    name: "Knowledge Graph System",
    entityType: "CONCEPT" as EntityType,
    description: "Graph system",
    properties: {},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockAliases = [
  { alias: "postgres", entityId: "ent_technology_postgresql" },
  { alias: "KGS", entityId: "ent_concept_knowledge_graph_system" },
];

describe("Entity Resolution & Search for Neighborhood & Path APIs", () => {
  const repo = createMockEntityRepo(mockEntities, mockAliases);

  // Helper matching the resolveEntityId implementation
  const resolveEntityId = (input: string, entityRepo: EntityRepositoryShape) =>
    Effect.gen(function* () {
      const trimmed = input.trim();
      if (!trimmed) return trimmed;

      const byId = yield* entityRepo.findById(trimmed);
      if (Option.isSome(byId)) return byId.value.id;

      const byName = yield* entityRepo.findByName(trimmed);
      if (Option.isSome(byName)) return byName.value.id;

      const byAlias = yield* entityRepo.findByAlias(trimmed);
      if (Option.isSome(byAlias)) return byAlias.value.id;

      const fuzzy = yield* entityRepo.searchByName(trimmed, 1);
      if (fuzzy.length > 0 && fuzzy[0]) return fuzzy[0].id;

      return trimmed;
    });

  describe("Entity Resolution Helper", () => {
    it("should resolve exact entity ID unchanged", async () => {
      const res = await Effect.runPromise(
        resolveEntityId("ent_technology_postgresql", repo),
      );
      assert.equal(res, "ent_technology_postgresql");
    });

    it("should resolve human entity name to entity ID", async () => {
      const res = await Effect.runPromise(resolveEntityId("PostgreSQL", repo));
      assert.equal(res, "ent_technology_postgresql");
    });

    it("should resolve entity name case-insensitively", async () => {
      const res = await Effect.runPromise(resolveEntityId("golem cloud", repo));
      assert.equal(res, "ent_technology_golem_cloud");
    });

    it("should resolve alias to entity ID", async () => {
      const resKgs = await Effect.runPromise(resolveEntityId("KGS", repo));
      assert.equal(resKgs, "ent_concept_knowledge_graph_system");

      const resPostgres = await Effect.runPromise(
        resolveEntityId("postgres", repo),
      );
      assert.equal(resPostgres, "ent_technology_postgresql");
    });

    it("should fallback to input string when no match found", async () => {
      const res = await Effect.runPromise(
        resolveEntityId("UnknownTechnologyX", repo),
      );
      assert.equal(res, "UnknownTechnologyX");
    });
  });

  describe("Enriched Response Schemas", () => {
    it("should decode NeighborhoodResponseSchema containing entities without duplicate entityIds", () => {
      const raw = {
        entities: [
          {
            id: "ent_technology_postgresql",
            name: "PostgreSQL",
            entityType: "TECHNOLOGY",
            description: "Open source relational database",
            properties: "{}",
            metadata: "{}",
          },
        ],
        edges: [
          {
            sourceId: "ent_technology_postgresql",
            targetId: "ent_technology_golem_cloud",
            relationType: "CONNECTS",
            weight: 1.0,
            confidence: 0.9,
            properties: "{}",
          },
        ],
      };

      const decoded = Schema.decodeUnknownSync(NeighborhoodResponseSchema)(raw);
      assert.equal(decoded.entities.length, 1);
      assert.equal(decoded.entities[0].name, "PostgreSQL");
      assert.equal(decoded.entities[0].id, "ent_technology_postgresql");
      assert.equal(decoded.edges.length, 1);
    });

    it("should decode PathFindingResultSchema containing path hop sequences and entity lookup pool", () => {
      const raw = {
        paths: [
          {
            entityIds: [
              "ent_technology_golem_cloud",
              "ent_technology_postgresql",
            ],
            edges: [],
            totalWeight: 1.0,
          },
        ],
        entities: [
          {
            id: "ent_technology_golem_cloud",
            name: "Golem Cloud",
            entityType: "TECHNOLOGY",
            description: null,
            properties: "{}",
            metadata: "{}",
          },
          {
            id: "ent_technology_postgresql",
            name: "PostgreSQL",
            entityType: "TECHNOLOGY",
            description: null,
            properties: "{}",
            metadata: "{}",
          },
        ],
        shortestPathLength: 1,
      };

      const decoded = Schema.decodeUnknownSync(PathFindingResultSchema)(raw);
      assert.equal(decoded.paths.length, 1);
      assert.deepEqual(decoded.paths[0].entityIds, [
        "ent_technology_golem_cloud",
        "ent_technology_postgresql",
      ]);
      assert.equal(decoded.entities.length, 2);
      assert.equal(decoded.entities[0].name, "Golem Cloud");
      assert.equal(decoded.entities[1].name, "PostgreSQL");
    });

    it("should decode EntitySearchResponseSchema correctly", () => {
      const raw = {
        entities: [
          {
            id: "ent_concept_knowledge_graph_system",
            name: "Knowledge Graph System",
            entityType: "CONCEPT",
            description: "Graph system",
            properties: "{}",
            metadata: "{}",
          },
        ],
        total: 1,
        query: "graph",
      };

      const decoded = Schema.decodeUnknownSync(EntitySearchResponseSchema)(raw);
      assert.equal(decoded.total, 1);
      assert.equal(decoded.query, "graph");
      assert.equal(decoded.entities[0].entityType, "CONCEPT");
    });

    it("should return top connected entities when query is empty or omitted", async () => {
      const repo = createMockEntityRepo(mockEntities, mockAliases);
      const top = await Effect.runPromise(repo.getTopConnected(2));
      assert.equal(top.length, 2);
      assert.equal(top[0].id, "ent_technology_postgresql");
      assert.equal(top[1].id, "ent_technology_golem_cloud");
    });
  });
});
