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

/**
 * Strips internal chunking artifacts such as "[Context: ...]" while preserving
 * Markdown formatting (headings, bold, lists, quotes, code).
 */
export function cleanContentChunk(content: string): string {
  return content.replace(/^\[Context:\s*[^\]]+\]\s*\n?/i, "").trim();
}

/**
 * Checks whether a paragraph extracted from a chunk is clean prose/markdown
 * rather than a broken syntax fragment (e.g. truncated type definitions or dangling brackets).
 */
export function isUsableParagraph(para: string): boolean {
  const trimmed = para.trim();
  if (trimmed.length < 25) return false;

  // Reject snippets that start with truncated syntax fragments:
  // e.g. ": bigint;", "};", "},", ");", "): void"
  if (/^[:;,\]\}\)]/.test(trimmed)) return false;

  // Reject type field fragments without context, e.g. "environmentId: EnvironmentId;"
  if (
    /^[A-Za-z0-9_$]+\s*:\s*[A-Za-z0-9_$<>, ]+;\s*(\/\*|\/\/|\n|$)/.test(trimmed)
  ) {
    return false;
  }

  // Reject dangling closing braces or export artifacts
  if (/^(\s*[\}\]\);,]+)+$/.test(trimmed)) return false;

  return true;
}

/**
 * Ensures code fences and inline backticks are properly balanced in a markdown snippet.
 */
export function sanitizeMarkdownBlock(text: string): string {
  let cleaned = text.trim();

  // Strip leading stray bracket/semicolon lines
  cleaned = cleaned.replace(/^[\s;,\}\]\)]+\n+/, "");

  // Check code fence balance (```)
  const tripleMatches = cleaned.match(/```/g);
  const tripleCount = tripleMatches ? tripleMatches.length : 0;
  if (tripleCount % 2 !== 0) {
    cleaned += "\n```";
  }

  // Check inline backtick balance outside of code fences
  const withoutFences = cleaned.replace(/```[\s\S]*?```/g, "");
  const singleMatches = withoutFences.match(/`/g);
  const singleCount = singleMatches ? singleMatches.length : 0;
  if (singleCount % 2 !== 0) {
    if (cleaned.endsWith("`")) {
      cleaned = cleaned.slice(0, -1).trimEnd();
    } else if (cleaned.startsWith("`")) {
      cleaned = cleaned.slice(1).trimStart();
    } else {
      cleaned += "`";
    }
  }

  return cleaned;
}

/**
 * Synthesizes a structured Markdown answer from the GraphRAG retrieval context bundle.
 * Formats evidence paragraphs, key entities, and graph relationships as clean Markdown
 * for rich display in the frontend (rendered via marked) and REST/MCP clients.
 */
export function synthesizeAnswerText(
  query: string,
  bundle: GraphRAGContextBundle,
): string {
  if (bundle.relevantChunks.length === 0 && bundle.entities.length === 0) {
    return `No matching knowledge graph entities or documents found for query "${query}".`;
  }

  const sections: string[] = [];

  // 1. Relevant Document Evidence / Synthesized Answer Content
  const usefulParagraphs: string[] = [];
  const seenParagraphs = new Set<string>();

  for (const chunk of bundle.relevantChunks.slice(0, 5)) {
    const rawContent = cleanContentChunk(chunk.content);
    if (!rawContent) continue;

    // Split paragraphs on blank lines while preserving markdown formatting
    const paragraphs = rawContent
      .split(/\n\s*\n/)
      .map((p) => sanitizeMarkdownBlock(p.trim()))
      .filter((p) => isUsableParagraph(p));

    for (const para of paragraphs) {
      const signature = para.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
      if (!seenParagraphs.has(signature)) {
        seenParagraphs.add(signature);
        usefulParagraphs.push(para);
      }
      if (usefulParagraphs.length >= 3) break;
    }
    if (usefulParagraphs.length >= 3) break;
  }

  if (usefulParagraphs.length > 0) {
    sections.push(usefulParagraphs.join("\n\n"));
  } else if (bundle.relevantChunks[0]?.content) {
    const fallback = sanitizeMarkdownBlock(
      cleanContentChunk(bundle.relevantChunks[0].content),
    );
    if (fallback) {
      sections.push(fallback);
    }
  }

  // 2. Key Entities Grounded in Query
  if (bundle.entities.length > 0) {
    const topEntities = bundle.entities.slice(0, 5);
    const entityLines = topEntities.map((e) => {
      // Suppress extraction provenance placeholders like "Extracted from <uuid>" or raw UUIDs
      const isProvenanceOrUuid =
        !e.description ||
        /^Extracted from\s+[0-9a-f-]+/i.test(e.description.trim()) ||
        /^[0-9a-f-]{30,}$/i.test(e.description.trim());
      const desc = !isProvenanceOrUuid ? ` — ${e.description!.trim()}` : "";
      const typeBadge = e.entityType ? ` (*${e.entityType}*)` : "";
      return `- **${e.name}**${typeBadge}${desc}`;
    });
    if (entityLines.length > 0) {
      sections.push(`### Key Entities\n${entityLines.join("\n")}`);
    }
  }

  // 3. Grounded Relationship Insights
  if (bundle.relationships.length > 0) {
    const entityMap = new Map<string, string>();
    for (const e of bundle.entities) {
      entityMap.set(e.id, e.name);
    }
    const seenRels = new Set<string>();
    const relLines: string[] = [];

    for (const rel of bundle.relationships) {
      const src = entityMap.get(rel.sourceId) ?? rel.sourceId;
      const tgt = entityMap.get(rel.targetId) ?? rel.targetId;

      // Skip self loops or unresolved raw UUID pairs
      if (!src || !tgt || src === tgt) continue;
      if (/^[0-9a-f-]{32,}$/i.test(src) || /^[0-9a-f-]{32,}$/i.test(tgt))
        continue;

      const relVerb =
        rel.relationType.toUpperCase() === "CO_OCCURS_WITH"
          ? "associated with"
          : rel.relationType.toLowerCase().replace(/_/g, " ");

      // Deduplicate bidirectional or repeated relationships
      const pairKey =
        [src.toLowerCase(), tgt.toLowerCase()].sort().join("<->") +
        `::${relVerb}`;
      if (seenRels.has(pairKey)) continue;
      seenRels.add(pairKey);

      relLines.push(`- **${src}** *${relVerb}* **${tgt}**`);
      if (relLines.length >= 5) break;
    }

    if (relLines.length > 0) {
      sections.push(`### Knowledge Graph Insights\n${relLines.join("\n")}`);
    }
  }

  return (
    sections.join("\n\n") ||
    `Retrieved ${bundle.entities.length} related entities and ${bundle.relevantChunks.length} documents matching "${query}".`
  );
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
