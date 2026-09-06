import { Context, Effect, Layer, Option } from "effect";
import { type SqlError } from "effect/unstable/sql/SqlError";
import {
  type CreateEntityInput,
  type Entity,
  type EntityAlias,
} from "../domain/entity.js";
import { type Edge } from "../domain/relationship.js";
import {
  EntityRepository,
  GraphRepository,
} from "../storage/repository-tags.js";
import { type ExtractedKnowledge } from "./extractor.js";

export interface FusionResult {
  readonly resolvedEntities: ReadonlyArray<Entity>;
  readonly resolvedEdges: ReadonlyArray<Edge>;
  readonly newEntitiesCount: number;
  readonly mergedEntitiesCount: number;
  readonly newEdgesCount: number;
  readonly updatedEdgesCount: number;
}

export { fuseConfidence } from "./fusion-utils.js";
import { fuseConfidence } from "./fusion-utils.js";

export interface EntityResolverServiceShape {
  readonly fuseKnowledge: (
    knowledge: ExtractedKnowledge,
  ) => Effect.Effect<FusionResult, SqlError>;

  readonly resolveEntity: (
    candidate: CreateEntityInput,
  ) => Effect.Effect<Entity, SqlError>;
}

export class EntityResolverService extends Context.Service<
  EntityResolverService,
  EntityResolverServiceShape
>()("app/pipeline/EntityResolverService") {
  static readonly Default = Layer.effect(
    EntityResolverService,
    Effect.gen(function* () {
      const entityRepo = yield* EntityRepository;
      const graphRepo = yield* GraphRepository;

      const resolveEntity = (
        candidate: CreateEntityInput,
      ): Effect.Effect<Entity, SqlError> =>
        Effect.gen(function* () {
          // 1. Try finding by exact ID
          const existingById = yield* entityRepo.findById(candidate.id);
          if (Option.isSome(existingById)) {
            const existing = existingById.value;
            const oldConf = Number(existing.metadata?.confidence ?? 0.8);
            const candConf = Number(candidate.metadata?.confidence ?? 0.8);
            const newConf = fuseConfidence(oldConf, candConf);

            const mergedProperties = {
              ...((existing.properties as Record<string, unknown>) ?? {}),
              ...((candidate.properties as Record<string, unknown>) ?? {}),
            };

            const updatedOpt = yield* entityRepo.updateEntity(existing.id, {
              properties: mergedProperties,
              metadata: {
                ...(existing.metadata ?? {}),
                confidence: newConf,
                lastObservedAt: new Date().toISOString(),
              },
            });
            return Option.isSome(updatedOpt) ? updatedOpt.value : existing;
          }

          // 2. Try finding by Alias
          const existingByAlias = yield* entityRepo.findByAlias(candidate.name);
          if (Option.isSome(existingByAlias)) {
            const existing = existingByAlias.value;
            const oldConf = Number(existing.metadata?.confidence ?? 0.8);
            const candConf = Number(candidate.metadata?.confidence ?? 0.8);
            const newConf = fuseConfidence(oldConf, candConf);

            const mergedProperties = {
              ...((existing.properties as Record<string, unknown>) ?? {}),
              ...((candidate.properties as Record<string, unknown>) ?? {}),
            };

            const updatedOpt = yield* entityRepo.updateEntity(existing.id, {
              properties: mergedProperties,
              metadata: {
                ...(existing.metadata ?? {}),
                confidence: newConf,
                lastObservedAt: new Date().toISOString(),
              },
            });
            return Option.isSome(updatedOpt) ? updatedOpt.value : existing;
          }

          // 3. No match found, create/upsert new canonical entity
          return yield* entityRepo.upsertEntity(candidate);
        });

      const fuseKnowledge = (
        knowledge: ExtractedKnowledge,
      ): Effect.Effect<FusionResult, SqlError> =>
        Effect.gen(function* () {
          const idMap = new Map<string, string>(); // candidate ID -> resolved canonical ID
          const resolvedEntities: Entity[] = [];
          let newEntitiesCount = 0;
          let mergedEntitiesCount = 0;

          // 1. Resolve and persist entities
          for (const cand of knowledge.entities) {
            const existing = yield* entityRepo.findById(cand.id);
            if (Option.isSome(existing)) {
              mergedEntitiesCount++;
            } else {
              newEntitiesCount++;
            }

            const resolved = yield* resolveEntity(cand);
            idMap.set(cand.id, resolved.id);
            resolvedEntities.push(resolved);
          }

          // 2. Persist extracted aliases
          for (const alias of knowledge.aliases) {
            const canonicalId = idMap.get(alias.entityId) ?? alias.entityId;
            const aliasInput: EntityAlias = {
              alias: alias.alias,
              entityId: canonicalId,
              source: alias.source,
              confidence: alias.confidence,
            };
            yield* entityRepo.addAlias(aliasInput);
          }

          // 3. Resolve, merge, and persist relationship edges
          const resolvedEdges: Edge[] = [];
          let newEdgesCount = 0;
          let updatedEdgesCount = 0;

          for (const edgeInput of knowledge.edges) {
            const sourceId =
              idMap.get(edgeInput.sourceId) ?? edgeInput.sourceId;
            const targetId =
              idMap.get(edgeInput.targetId) ?? edgeInput.targetId;

            // Check if source and target are known
            if (sourceId === targetId) {
              continue; // Avoid self-loops
            }

            const existingEdgeOpt = yield* graphRepo.findEdge(
              sourceId,
              targetId,
              edgeInput.relationType,
            );

            if (Option.isSome(existingEdgeOpt)) {
              const existing = existingEdgeOpt.value;
              const oldConf = existing.confidence;
              const candConf = edgeInput.confidence ?? 0.8;
              const newConf = fuseConfidence(oldConf, candConf);
              const newWeight = existing.weight + (edgeInput.weight ?? 1.0);

              const merged = yield* graphRepo.upsertEdge({
                id: existing.id,
                sourceId,
                targetId,
                relationType: edgeInput.relationType,
                weight: newWeight,
                confidence: newConf,
                properties: {
                  ...((existing.properties as Record<string, unknown>) ?? {}),
                  ...((edgeInput.properties as Record<string, unknown>) ?? {}),
                  observationCount:
                    (Number(
                      (existing.properties as Record<string, unknown>)
                        ?.observationCount,
                    ) || 1) + 1,
                },
              });
              resolvedEdges.push(merged);
              updatedEdgesCount++;
            } else {
              const created = yield* graphRepo.upsertEdge({
                ...edgeInput,
                sourceId,
                targetId,
              });
              resolvedEdges.push(created);
              newEdgesCount++;
            }
          }

          return {
            resolvedEntities,
            resolvedEdges,
            newEntitiesCount,
            mergedEntitiesCount,
            newEdgesCount,
            updatedEdgesCount,
          };
        });

      return {
        fuseKnowledge,
        resolveEntity,
      };
    }),
  );
}
