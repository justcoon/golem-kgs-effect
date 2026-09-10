import { Context, Effect, Layer } from "effect";
import { type SqlError } from "effect/unstable/sql/SqlError";
import { EmbeddingService, type EmbeddingError } from "./embedding-service.js";
import {
  ChunkRepository,
  EntityRepository,
  GraphRepository,
} from "../storage/repository-tags.js";
import { type Entity } from "../domain/entity.js";
import { type Edge } from "../domain/relationship.js";
import {
  type GraphRAGContextBundle,
  type GraphRAGQuery,
  type SearchResultItem,
} from "../domain/query.js";

export interface GraphRAGServiceShape {
  readonly retrieveContext: (
    query: GraphRAGQuery,
  ) => Effect.Effect<GraphRAGContextBundle, EmbeddingError | SqlError>;
}

export function formatContextPrompt(
  queryText: string,
  chunks: ReadonlyArray<SearchResultItem>,
  entities: ReadonlyArray<Entity>,
  edges: ReadonlyArray<Edge>,
): string {
  const entityMap = new Map<string, string>();
  for (const entity of entities) {
    entityMap.set(entity.id, entity.name);
  }

  const chunkSection =
    chunks.length > 0
      ? chunks
          .map(
            (c, i) =>
              `### Excerpt ${i + 1} (Score: ${c.score.toFixed(4)}, Document: ${c.documentId})\n${c.content.trim()}`,
          )
          .join("\n\n")
      : "No relevant document excerpts found.";

  const entitySection =
    entities.length > 0
      ? entities
          .map((e) => {
            const desc = e.description ? `: ${e.description}` : "";
            const props =
              e.properties && Object.keys(e.properties).length > 0
                ? ` (Properties: ${JSON.stringify(e.properties)})`
                : "";
            return `- **${e.name}** [${e.entityType}]${desc}${props}`;
          })
          .join("\n")
      : "No knowledge graph entities found.";

  const edgeSection =
    edges.length > 0
      ? edges
          .map((edge) => {
            const src = entityMap.get(edge.sourceId) ?? edge.sourceId;
            const tgt = entityMap.get(edge.targetId) ?? edge.targetId;
            return `- **${src}** --[${edge.relationType} (confidence: ${edge.confidence.toFixed(2)})]--> **${tgt}**`;
          })
          .join("\n")
      : "No knowledge graph relationships found.";

  return `# Knowledge Context for Query: "${queryText}"

## Relevant Document Excerpts
${chunkSection}

## Knowledge Graph Entities
${entitySection}

## Knowledge Graph Relationships
${edgeSection}
`;
}

export class GraphRAGService extends Context.Service<
  GraphRAGService,
  GraphRAGServiceShape
>()("app/pipeline/GraphRAGService") {
  static Default = Layer.effect(
    GraphRAGService,
    Effect.gen(function* () {
      const embeddingService = yield* EmbeddingService;
      const chunkRepo = yield* ChunkRepository;
      const entityRepo = yield* EntityRepository;
      const graphRepo = yield* GraphRepository;

      const retrieveContext = (query: GraphRAGQuery) =>
        Effect.gen(function* () {
          const startTime = Date.now();
          const topK = query.topK ?? 5;
          const maxHops = Math.max(1, Math.min(query.maxHops ?? 2, 5));
          const minConfidence = query.minConfidence ?? 0.0;

          // 1. Generate query embedding
          const embedding = yield* embeddingService.generateEmbedding(
            query.query,
          );

          // 2. Hybrid search across document chunks
          const relevantChunks = yield* chunkRepo.searchHybrid({
            query: query.query,
            embedding,
            limit: topK,
          });

          // 3. Extract seed entities (chunk mentions + query name matches)
          const chunkIds = relevantChunks.map((c) => c.chunkId);
          const chunkEntityIds =
            yield* chunkRepo.getEntityIdsForChunks(chunkIds);

          const namedEntities = yield* entityRepo.searchByName(query.query, 5);
          const namedEntityIds = namedEntities.map((e) => e.id);

          const seedEntityIds = Array.from(
            new Set([...chunkEntityIds, ...namedEntityIds]),
          );

          let entities: ReadonlyArray<Entity> = [];
          let relationships: ReadonlyArray<Edge> = [];

          // 4. Multi-hop topological graph traversal if seeds exist
          if (seedEntityIds.length > 0) {
            const neighborhood = yield* graphRepo.getNeighborhood({
              seedEntityIds,
              depth: maxHops,
              relationTypes: query.relationTypes,
              minConfidence,
              limit: 50,
            });

            relationships = neighborhood.edges;

            entities = yield* entityRepo.findByIds(neighborhood.entityIds);
          }

          // 5. Synthesize Markdown context prompt
          const formattedPrompt = formatContextPrompt(
            query.query,
            relevantChunks,
            entities,
            relationships,
          );

          const retrievalDurationMs = Date.now() - startTime;

          const bundle: GraphRAGContextBundle = {
            query: query.query,
            entities,
            relationships,
            relevantChunks,
            formattedContextPrompt: formattedPrompt,
            metadata: {
              totalEntities: entities.length,
              totalRelationships: relationships.length,
              totalChunks: relevantChunks.length,
              retrievalDurationMs,
            },
          };

          return bundle;
        });

      return {
        retrieveContext,
      };
    }),
  );
}
