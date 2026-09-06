import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Pg } from "@golemcloud/effect-golem/postgres";
import {
  type CreateEntityInput,
  type Entity,
  type EntityAlias,
  type EntityType,
  type UpdateEntityInput,
} from "../domain/entity.js";

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly entity_type: string;
  readonly description: string | null;
  readonly properties: unknown;
  readonly metadata: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface AliasRow {
  readonly alias: string;
  readonly entity_id: string;
  readonly source: string;
  readonly confidence: number;
  readonly created_at: Date | string;
}

const mapEntityRow = (row: EntityRow): Entity => ({
  id: row.id,
  name: row.name,
  entityType: row.entity_type as EntityType,
  description: row.description,
  properties:
    typeof row.properties === "string"
      ? JSON.parse(row.properties)
      : ((row.properties as Record<string, unknown>) ?? {}),
  metadata:
    typeof row.metadata === "string"
      ? JSON.parse(row.metadata)
      : ((row.metadata as Record<string, unknown>) ?? {}),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const mapAliasRow = (row: AliasRow): EntityAlias => ({
  alias: row.alias,
  entityId: row.entity_id,
  source: row.source,
  confidence: row.confidence,
  createdAt: new Date(row.created_at),
});

import {
  EntityRepository,
  type EntityRepositoryShape,
} from "./repository-tags.js";
export { EntityRepository, type EntityRepositoryShape };

EntityRepository.Default = Layer.effect(
  EntityRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = (id: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<EntityRow>`
            SELECT id, name, entity_type, description, properties, metadata, created_at, updated_at
            FROM entities
            WHERE id = ${id}
            LIMIT 1
          `) as ReadonlyArray<EntityRow>;

        const row = rows[0];
        return row ? Option.some(mapEntityRow(row)) : Option.none();
      });

    const findByName = (name: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<EntityRow>`
            SELECT id, name, entity_type, description, properties, metadata, created_at, updated_at
            FROM entities
            WHERE name = ${name}
            LIMIT 1
          `) as ReadonlyArray<EntityRow>;

        const row = rows[0];
        return row ? Option.some(mapEntityRow(row)) : Option.none();
      });

    const findByAlias = (alias: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<EntityRow>`
            SELECT e.id, e.name, e.entity_type, e.description, e.properties, e.metadata, e.created_at, e.updated_at
            FROM entity_aliases a
            JOIN entities e ON a.entity_id = e.id
            WHERE a.alias = ${alias}
            ORDER BY a.confidence DESC
            LIMIT 1
          `) as ReadonlyArray<EntityRow>;

        const row = rows[0];
        return row ? Option.some(mapEntityRow(row)) : Option.none();
      });

    const upsertEntity = (input: CreateEntityInput) =>
      Effect.gen(function* () {
        const props = Pg.jsonb(input.properties ?? {});
        const meta = Pg.jsonb(input.metadata ?? {});
        const desc = input.description ?? null;

        const rows = (yield* sql<EntityRow>`
            INSERT INTO entities (id, name, entity_type, description, properties, metadata, updated_at)
            VALUES (${input.id}, ${input.name}, ${input.entityType}, ${desc}, ${props}, ${meta}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              entity_type = EXCLUDED.entity_type,
              description = COALESCE(EXCLUDED.description, entities.description),
              properties = entities.properties || EXCLUDED.properties,
              metadata = entities.metadata || EXCLUDED.metadata,
              updated_at = NOW()
            RETURNING id, name, entity_type, description, properties, metadata, created_at, updated_at
          `) as ReadonlyArray<EntityRow>;

        const row = rows[0];
        if (!row) {
          return yield* Effect.die(
            new Error("Failed to insert or update entity"),
          );
        }
        return mapEntityRow(row);
      });

    const updateEntity = (id: string, input: UpdateEntityInput) =>
      Effect.gen(function* () {
        const existingOpt = yield* findById(id);
        if (Option.isNone(existingOpt)) {
          return Option.none();
        }

        const existing = existingOpt.value;
        const name = input.name ?? existing.name;
        const entityType = input.entityType ?? existing.entityType;
        const desc =
          input.description !== undefined
            ? input.description
            : existing.description;
        const props = Pg.jsonb({
          ...existing.properties,
          ...(input.properties ?? {}),
        });
        const meta = Pg.jsonb({
          ...existing.metadata,
          ...(input.metadata ?? {}),
        });

        const rows = (yield* sql<EntityRow>`
            UPDATE entities
            SET name = ${name},
                entity_type = ${entityType},
                description = ${desc},
                properties = ${props},
                metadata = ${meta},
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING id, name, entity_type, description, properties, metadata, created_at, updated_at
          `) as ReadonlyArray<EntityRow>;

        const row = rows[0];
        return row ? Option.some(mapEntityRow(row)) : Option.none();
      });

    const addAlias = (alias: EntityAlias) =>
      Effect.gen(function* () {
        const rows = (yield* sql<AliasRow>`
            INSERT INTO entity_aliases (alias, entity_id, source, confidence, created_at)
            VALUES (${alias.alias}, ${alias.entityId}, ${alias.source ?? "extracted"}, ${alias.confidence ?? 1.0}, NOW())
            ON CONFLICT (alias, entity_id) DO UPDATE SET
              source = EXCLUDED.source,
              confidence = EXCLUDED.confidence
            RETURNING alias, entity_id, source, confidence, created_at
          `) as ReadonlyArray<AliasRow>;

        const row = rows[0];
        if (!row) {
          return yield* Effect.die(new Error("Failed to insert entity alias"));
        }
        return mapAliasRow(row);
      });

    const listAliases = (entityId: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<AliasRow>`
            SELECT alias, entity_id, source, confidence, created_at
            FROM entity_aliases
            WHERE entity_id = ${entityId}
            ORDER BY confidence DESC
          `) as ReadonlyArray<AliasRow>;

        return rows.map(mapAliasRow);
      });

    const searchByName = (query: string, limit = 20) =>
      Effect.gen(function* () {
        const rows = (yield* sql<EntityRow>`
            SELECT id, name, entity_type, description, properties, metadata, created_at, updated_at
            FROM entities
            WHERE name ILIKE ${`%${query}%`}
               OR to_tsvector('english', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', ${query})
            ORDER BY similarity(name, ${query}) DESC
            LIMIT ${limit}
          `) as ReadonlyArray<EntityRow>;

        return rows.map(mapEntityRow);
      });

    const deleteEntity = (id: string) =>
      Effect.gen(function* () {
        const affected = (yield* sql`
            DELETE FROM entities WHERE id = ${id}
          `.raw) as bigint | number;

        return Number(affected) > 0;
      });

    return {
      findById,
      findByName,
      findByAlias,
      upsertEntity,
      updateEntity,
      addAlias,
      listAliases,
      searchByName,
      deleteEntity,
    };
  }),
);
