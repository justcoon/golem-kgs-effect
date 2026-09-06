import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Pg } from "@golemcloud/effect-golem/postgres";
import { type CreateEdgeInput, type Edge } from "../domain/relationship.js";
import { type NeighborhoodQuery } from "../domain/query.js";

interface EdgeRow {
  readonly id: string;
  readonly source_id: string;
  readonly target_id: string;
  readonly relation_type: string;
  readonly weight: number;
  readonly confidence: number;
  readonly properties: unknown;
  readonly valid_from: Date | string | null;
  readonly valid_until: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const mapEdgeRow = (row: EdgeRow): Edge => ({
  id: row.id,
  sourceId: row.source_id,
  targetId: row.target_id,
  relationType: row.relation_type,
  weight: row.weight,
  confidence: row.confidence,
  properties:
    typeof row.properties === "string"
      ? JSON.parse(row.properties)
      : ((row.properties as Record<string, unknown>) ?? {}),
  validFrom: row.valid_from ? new Date(row.valid_from) : null,
  validUntil: row.valid_until ? new Date(row.valid_until) : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

import {
  GraphRepository,
  type GraphRepositoryShape,
} from "./repository-tags.js";
export { GraphRepository, type GraphRepositoryShape };

GraphRepository.Default = Layer.effect(
  GraphRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsertEdge = (input: CreateEdgeInput) =>
      Effect.gen(function* () {
        const edgeId =
          input.id ??
          `edge_${input.sourceId}_${input.relationType}_${input.targetId}`;
        const props = Pg.jsonb(input.properties ?? {});
        const weight = input.weight ?? 1.0;
        const confidence = input.confidence ?? 1.0;
        const validFrom = input.validFrom ? new Date(input.validFrom) : null;
        const validUntil = input.validUntil ? new Date(input.validUntil) : null;

        const rows = (yield* sql<EdgeRow>`
            INSERT INTO edges (id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, updated_at)
            VALUES (${edgeId}, ${input.sourceId}, ${input.targetId}, ${input.relationType}, ${weight}, ${confidence}, ${props}, ${validFrom}, ${validUntil}, NOW())
            ON CONFLICT (source_id, target_id, relation_type) DO UPDATE SET
              weight = EXCLUDED.weight,
              confidence = EXCLUDED.confidence,
              properties = edges.properties || EXCLUDED.properties,
              valid_from = EXCLUDED.valid_from,
              valid_until = EXCLUDED.valid_until,
              updated_at = NOW()
            RETURNING id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
          `) as ReadonlyArray<EdgeRow>;

        const row = rows[0];
        if (!row) {
          return yield* Effect.die(new Error("Failed to upsert edge"));
        }
        return mapEdgeRow(row);
      });

    const findEdge = (
      sourceId: string,
      targetId: string,
      relationType: string,
    ) =>
      Effect.gen(function* () {
        const rows = (yield* sql<EdgeRow>`
            SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
            FROM edges
            WHERE source_id = ${sourceId} AND target_id = ${targetId} AND relation_type = ${relationType}
            LIMIT 1
          `) as ReadonlyArray<EdgeRow>;

        const row = rows[0];
        return row ? Option.some(mapEdgeRow(row)) : Option.none();
      });

    const getOutboundEdges = (sourceId: string, relationType?: string) =>
      Effect.gen(function* () {
        const rows = (
          relationType
            ? yield* sql<EdgeRow>`
                  SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                  FROM edges
                  WHERE source_id = ${sourceId} AND relation_type = ${relationType}
                `
            : yield* sql<EdgeRow>`
                  SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                  FROM edges
                  WHERE source_id = ${sourceId}
                `
        ) as ReadonlyArray<EdgeRow>;

        return rows.map(mapEdgeRow);
      });

    const getInboundEdges = (targetId: string, relationType?: string) =>
      Effect.gen(function* () {
        const rows = (
          relationType
            ? yield* sql<EdgeRow>`
                  SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                  FROM edges
                  WHERE target_id = ${targetId} AND relation_type = ${relationType}
                `
            : yield* sql<EdgeRow>`
                  SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                  FROM edges
                  WHERE target_id = ${targetId}
                `
        ) as ReadonlyArray<EdgeRow>;

        return rows.map(mapEdgeRow);
      });

    const getNeighborhood = (query: NeighborhoodQuery) =>
      Effect.gen(function* () {
        const minConf = query.minConfidence ?? 0.0;
        const limit = query.limit ?? 50;

        const rows = (yield* sql<EdgeRow>`
            SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
            FROM edges
            WHERE (source_id = ANY(${query.seedEntityIds}) OR target_id = ANY(${query.seedEntityIds}))
              AND confidence >= ${minConf}
            LIMIT ${limit}
          `) as ReadonlyArray<EdgeRow>;

        const edges = rows.map(mapEdgeRow);
        const entityIdSet = new Set<string>(query.seedEntityIds);
        for (const edge of edges) {
          entityIdSet.add(edge.sourceId);
          entityIdSet.add(edge.targetId);
        }

        return {
          entityIds: Array.from(entityIdSet),
          edges,
        };
      });

    const deleteEdge = (id: string) =>
      Effect.gen(function* () {
        const affected = (yield* sql`
            DELETE FROM edges WHERE id = ${id}
          `.raw) as bigint | number;

        return Number(affected) > 0;
      });

    return {
      upsertEdge,
      findEdge,
      getOutboundEdges,
      getInboundEdges,
      getNeighborhood,
      deleteEdge,
    };
  }),
);
