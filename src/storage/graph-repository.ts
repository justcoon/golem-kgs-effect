import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Pg } from "@golemcloud/effect-golem/postgres";
import { type CreateEdgeInput, type Edge } from "../domain/relationship.js";
import {
  type GraphPath,
  type NeighborhoodQuery,
  type PathFindingQuery,
  type PathFindingResult,
} from "../domain/query.js";

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

    const queryEdgesForFrontier = (
      frontier: ReadonlyArray<string>,
      direction: "OUTBOUND" | "INBOUND" | "BOTH",
      relationTypes: ReadonlyArray<string> | undefined,
      minConfidence: number,
      limit: number,
    ) =>
      Effect.gen(function* () {
        if (frontier.length === 0 || limit <= 0) {
          return [] as ReadonlyArray<EdgeRow>;
        }
        const frontierParam = Pg.array(frontier);
        const hasTypes = relationTypes && relationTypes.length > 0;
        const typesParam = hasTypes ? Pg.array(relationTypes) : null;
        if (direction === "OUTBOUND") {
          return hasTypes
            ? ((yield* sql<EdgeRow>`
                SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                FROM edges
                WHERE source_id = ANY(${frontierParam})
                  AND relation_type = ANY(${typesParam})
                  AND confidence >= ${minConfidence}
                ORDER BY confidence DESC, weight DESC
                LIMIT ${limit}
              `) as ReadonlyArray<EdgeRow>)
            : ((yield* sql<EdgeRow>`
                SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                FROM edges
                WHERE source_id = ANY(${frontierParam})
                  AND confidence >= ${minConfidence}
                ORDER BY confidence DESC, weight DESC
                LIMIT ${limit}
              `) as ReadonlyArray<EdgeRow>);
        } else if (direction === "INBOUND") {
          return hasTypes
            ? ((yield* sql<EdgeRow>`
                SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                FROM edges
                WHERE target_id = ANY(${frontierParam})
                  AND relation_type = ANY(${typesParam})
                  AND confidence >= ${minConfidence}
                ORDER BY confidence DESC, weight DESC
                LIMIT ${limit}
              `) as ReadonlyArray<EdgeRow>)
            : ((yield* sql<EdgeRow>`
                SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                FROM edges
                WHERE target_id = ANY(${frontierParam})
                  AND confidence >= ${minConfidence}
                ORDER BY confidence DESC, weight DESC
                LIMIT ${limit}
              `) as ReadonlyArray<EdgeRow>);
        } else {
          return hasTypes
            ? ((yield* sql<EdgeRow>`
                SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                FROM edges
                WHERE (source_id = ANY(${frontierParam}) OR target_id = ANY(${frontierParam}))
                  AND relation_type = ANY(${typesParam})
                  AND confidence >= ${minConfidence}
                ORDER BY confidence DESC, weight DESC
                LIMIT ${limit}
              `) as ReadonlyArray<EdgeRow>)
            : ((yield* sql<EdgeRow>`
                SELECT id, source_id, target_id, relation_type, weight, confidence, properties, valid_from, valid_until, created_at, updated_at
                FROM edges
                WHERE (source_id = ANY(${frontierParam}) OR target_id = ANY(${frontierParam}))
                  AND confidence >= ${minConfidence}
                ORDER BY confidence DESC, weight DESC
                LIMIT ${limit}
              `) as ReadonlyArray<EdgeRow>);
        }
      });

    const getNeighborhood = (query: NeighborhoodQuery) =>
      Effect.gen(function* () {
        const depth = Math.max(1, Math.min(query.depth ?? 1, 5));
        const minConf = query.minConfidence ?? 0.0;
        const limit = query.limit ?? 50;
        const direction = query.direction ?? "BOTH";

        const visitedEntityIds = new Set<string>(query.seedEntityIds);
        let currentFrontier = new Set<string>(query.seedEntityIds);
        const collectedEdges = new Map<string, Edge>();

        for (
          let step = 0;
          step < depth &&
          currentFrontier.size > 0 &&
          collectedEdges.size < limit;
          step++
        ) {
          const remainingLimit = limit - collectedEdges.size;
          const rows = yield* queryEdgesForFrontier(
            Array.from(currentFrontier),
            direction,
            query.relationTypes,
            minConf,
            remainingLimit,
          );

          const nextFrontier = new Set<string>();
          for (const row of rows) {
            const edge = mapEdgeRow(row);
            collectedEdges.set(edge.id, edge);

            if (direction === "OUTBOUND") {
              if (!visitedEntityIds.has(edge.targetId)) {
                nextFrontier.add(edge.targetId);
              }
            } else if (direction === "INBOUND") {
              if (!visitedEntityIds.has(edge.sourceId)) {
                nextFrontier.add(edge.sourceId);
              }
            } else {
              if (!visitedEntityIds.has(edge.targetId)) {
                nextFrontier.add(edge.targetId);
              }
              if (!visitedEntityIds.has(edge.sourceId)) {
                nextFrontier.add(edge.sourceId);
              }
            }
          }

          for (const id of nextFrontier) {
            visitedEntityIds.add(id);
          }
          currentFrontier = nextFrontier;
        }

        return {
          entityIds: Array.from(visitedEntityIds),
          edges: Array.from(collectedEdges.values()),
        };
      });

    const findPaths = (query: PathFindingQuery) =>
      Effect.gen(function* () {
        const { sourceEntityId, targetEntityId } = query;
        const maxDepth = Math.max(1, Math.min(query.maxDepth ?? 3, 5));
        const direction = query.direction ?? "BOTH";

        if (sourceEntityId === targetEntityId) {
          const singleNodeResult: PathFindingResult = {
            paths: [
              {
                entityIds: [sourceEntityId],
                edges: [],
                totalWeight: 0,
              },
            ],
            shortestPathLength: 0,
          };
          return singleNodeResult;
        }

        interface PartialPath {
          readonly currentEntityId: string;
          readonly entityIds: ReadonlyArray<string>;
          readonly edges: ReadonlyArray<Edge>;
          readonly totalWeight: number;
        }

        const visitedNodeIds = new Set<string>([sourceEntityId]);
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
          const frontierIds = Array.from(
            new Set(currentPaths.map((p) => p.currentEntityId)),
          );

          const rows = yield* queryEdgesForFrontier(
            frontierIds,
            direction,
            query.relationTypes,
            0.0,
            200,
          );

          const edges = rows.map(mapEdgeRow);

          // Build adjacency for frontier
          const nextPaths: PartialPath[] = [];

          for (const path of currentPaths) {
            const u = path.currentEntityId;

            // Find valid outgoing/traversable edges from u
            const candidateEdges: Array<{ neighbor: string; edge: Edge }> = [];
            for (const edge of edges) {
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
              // Cycle detection within the active path
              if (path.entityIds.includes(neighbor)) {
                continue;
              }

              const newPath: PartialPath = {
                currentEntityId: neighbor,
                entityIds: [...path.entityIds, neighbor],
                edges: [...path.edges, edge],
                totalWeight: path.totalWeight + edge.weight,
              };

              visitedNodeIds.add(neighbor);

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

        // Sort by shortest path (fewest edges), then highest totalWeight
        foundPaths.sort((a, b) => {
          if (a.edges.length !== b.edges.length) {
            return a.edges.length - b.edges.length;
          }
          return b.totalWeight - a.totalWeight;
        });

        const shortestPathLength =
          foundPaths.length > 0 ? (foundPaths[0]?.edges.length ?? null) : null;

        const result: PathFindingResult = {
          paths: foundPaths.slice(0, 10),
          shortestPathLength,
        };
        return result;
      });

    const deleteEdge = (id: string) =>
      Effect.gen(function* () {
        const affected = (yield* sql`
            DELETE FROM edges WHERE id = ${id}
          `.raw) as bigint | number;

        return Number(affected) > 0;
      });

    const countEdges = () =>
      Effect.gen(function* () {
        const rows = yield* sql<{ count: string | number }>`
            SELECT COUNT(*) AS count FROM edges
          `;
        return Number(rows[0]?.count ?? 0);
      });

    return {
      upsertEdge,
      findEdge,
      getOutboundEdges,
      getInboundEdges,
      getNeighborhood,
      findPaths,
      deleteEdge,
      countEdges,
    };
  }),
);
