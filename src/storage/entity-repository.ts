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
import { type DocumentSummary } from "../domain/provenance.js";

interface DocumentSummaryRow {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly resource_name: string;
  readonly source_key: string;
  readonly size_bytes: string | number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const mapDocumentSummaryRow = (row: DocumentSummaryRow): DocumentSummary => ({
  id: row.id,
  title: row.title,
  source: row.source,
  resourceName: row.resource_name,
  sourceKey: row.source_key,
  sizeBytes: Number(row.size_bytes),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

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

    const getTopConnected = (limit = 10) =>
      Effect.gen(function* () {
        const rows = (yield* sql<EntityRow>`
            SELECT e.id, e.name, e.entity_type, e.description, e.properties, e.metadata, e.created_at, e.updated_at
            FROM entities e
            LEFT JOIN edges ed ON (e.id = ed.source_id OR e.id = ed.target_id)
            GROUP BY e.id, e.name, e.entity_type, e.description, e.properties, e.metadata, e.created_at, e.updated_at
            ORDER BY COUNT(ed.source_id) DESC, e.updated_at DESC
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

    const count = () =>
      Effect.gen(function* () {
        const rows = yield* sql<{ count: string | number }>`
            SELECT COUNT(*) AS count FROM entities
          `;
        return Number(rows[0]?.count ?? 0);
      });

    const getRelatedDocuments = (entityId: string, limit = 50) =>
      Effect.gen(function* () {
        const rows = (yield* sql<DocumentSummaryRow>`
            SELECT DISTINCT
                d.id,
                d.title,
                d.source,
                d.resource_name,
                d.source_key,
                d.size_bytes,
                d.created_at,
                d.updated_at
            FROM documents d
            WHERE d.id IN (
                SELECT c.document_id
                FROM entity_chunks ec
                JOIN chunks c ON ec.chunk_id = c.id
                WHERE ec.entity_id = ${entityId}

                UNION

                SELECT (e.properties->>'extractedFromDocument')::varchar
                FROM entities e
                WHERE e.id = ${entityId}
                  AND e.properties ? 'extractedFromDocument'

                UNION

                SELECT jsonb_array_elements_text(e.properties->'documents')::varchar
                FROM entities e
                WHERE e.id = ${entityId}
                  AND jsonb_typeof(e.properties->'documents') = 'array'
            )
            ORDER BY d.updated_at DESC
            LIMIT ${limit}
          `) as ReadonlyArray<DocumentSummaryRow>;

        return rows.map(mapDocumentSummaryRow);
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
      getTopConnected,
      deleteEntity,
      count,
      getRelatedDocuments,
    };
  }),
);
