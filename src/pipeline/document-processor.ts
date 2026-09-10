import { Effect } from "effect";
import { type SqlError } from "effect/unstable/sql/SqlError";
import { type RawDocument } from "../domain/provenance.js";
import { DocumentChunker } from "./chunker.js";
import { EmbeddingService, type EmbeddingError } from "./embedding-service.js";
import { EntityResolverService } from "./entity-resolver.js";
import { ExtractionService } from "./extractor.js";
import {
  ChunkRepository,
  DocumentRepository,
} from "../storage/repository-tags.js";

/**
 * Shared document indexing pipeline.
 * Persists raw document, chunks text, creates vector embeddings,
 * extracts entities/relations, fuses them into the knowledge graph,
 * and records provenance in the entity_chunks junction table.
 */
export function processAndIndexDocument(
  document: RawDocument,
): Effect.Effect<
  void,
  SqlError | EmbeddingError,
  | DocumentRepository
  | ChunkRepository
  | EntityResolverService
  | EmbeddingService
  | ExtractionService
> {
  return Effect.gen(function* () {
    const docRepo = yield* DocumentRepository;
    const chunkRepo = yield* ChunkRepository;
    const entityResolver = yield* EntityResolverService;
    const embeddingService = yield* EmbeddingService;
    const extractionService = yield* ExtractionService;

    yield* docRepo.saveDocument(document);

    const chunkResult = yield* DocumentChunker.chunkDocument(document);
    if (chunkResult.chunks.length === 0) {
      return;
    }

    const texts = chunkResult.chunks.map((c) => c.content);
    const embeddings = yield* embeddingService.generateEmbeddings(texts);

    for (let i = 0; i < chunkResult.chunks.length; i++) {
      const chunk = chunkResult.chunks[i]!;
      const emb = embeddings[i];
      yield* chunkRepo.upsertChunk({
        ...chunk,
        embedding: emb,
      });

      const knowledge = yield* extractionService.extractFromChunk(chunk);
      yield* entityResolver.fuseKnowledge(knowledge);

      for (const entity of knowledge.entities) {
        yield* chunkRepo.linkEntityChunk({
          entityId: entity.id,
          chunkId: chunk.id,
          mentionText: entity.name,
          confidence: Number(entity.metadata?.confidence ?? 1.0),
        });
      }
    }
  });
}
