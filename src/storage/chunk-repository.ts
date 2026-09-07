import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Pg } from "@golemcloud/effect-golem/postgres";
import {
  type CreateChunkInput,
  type DocumentChunk,
  type EntityChunkMention,
} from "../domain/chunk.js";
import {
  type HybridSearchQuery,
  type KeywordSearchQuery,
  type VectorSearchQuery,
} from "../domain/query.js";
import { type RawDocument } from "../domain/provenance.js";
import { fuseRankings } from "../pipeline/fusion-utils.js";

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly metadata: unknown;
  readonly tags: ReadonlyArray<string>;
  readonly source: string;
  readonly namespace: string;
  readonly size_bytes: number | bigint;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ChunkRow {
  readonly id: string;
  readonly document_id: string;
  readonly chunk_index: number;
  readonly content: string;
  readonly token_count: number;
  readonly embedding: ReadonlyArray<number> | null;
  readonly metadata: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface SearchRow {
  readonly id: string;
  readonly document_id: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: unknown;
}

const mapDocumentRow = (row: DocumentRow): RawDocument => ({
  id: row.id,
  title: row.title,
  content: row.content,
  metadata:
    typeof row.metadata === "string"
      ? JSON.parse(row.metadata)
      : ((row.metadata as Record<string, unknown>) ?? {}),
  tags: Array.from(row.tags ?? []),
  source: row.source,
  namespace: row.namespace,
  sizeBytes: Number(row.size_bytes),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const mapChunkRow = (row: ChunkRow): DocumentChunk => ({
  id: row.id,
  documentId: row.document_id,
  chunkIndex: row.chunk_index,
  content: row.content,
  tokenCount: row.token_count,
  embedding: row.embedding ? Array.from(row.embedding) : null,
  metadata:
    typeof row.metadata === "string"
      ? JSON.parse(row.metadata)
      : ((row.metadata as Record<string, unknown>) ?? {}),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

import {
  ChunkRepository,
  type ChunkRepositoryShape,
} from "./repository-tags.js";
export { ChunkRepository, type ChunkRepositoryShape };

ChunkRepository.Default = Layer.effect(
  ChunkRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const saveRawDocument = (doc: RawDocument) =>
      Effect.gen(function* () {
        const meta = Pg.jsonb(doc.metadata ?? {});
        const tags = Pg.array(doc.tags ?? []);

        const rows = (yield* sql<DocumentRow>`
            INSERT INTO documents (id, title, content, metadata, tags, source, namespace, size_bytes, updated_at)
            VALUES (${doc.id}, ${doc.title}, ${doc.content}, ${meta}, ${tags}, ${doc.source}, ${doc.namespace}, ${doc.sizeBytes}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              content = EXCLUDED.content,
              metadata = EXCLUDED.metadata,
              tags = EXCLUDED.tags,
              source = EXCLUDED.source,
              namespace = EXCLUDED.namespace,
              size_bytes = EXCLUDED.size_bytes,
              updated_at = NOW()
            RETURNING id, title, content, metadata, tags, source, namespace, size_bytes, created_at, updated_at
          `) as ReadonlyArray<DocumentRow>;

        const row = rows[0];
        if (!row) {
          return yield* Effect.die(new Error("Failed to save document"));
        }
        return mapDocumentRow(row);
      });

    const getRawDocument = (id: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<DocumentRow>`
            SELECT id, title, content, metadata, tags, source, namespace, size_bytes, created_at, updated_at
            FROM documents
            WHERE id = ${id}
            LIMIT 1
          `) as ReadonlyArray<DocumentRow>;

        const row = rows[0];
        return row ? Option.some(mapDocumentRow(row)) : Option.none();
      });

    const upsertChunk = (input: CreateChunkInput) =>
      Effect.gen(function* () {
        const meta = Pg.jsonb(input.metadata ?? {});
        const embeddingParam = input.embedding
          ? Pg.vector(input.embedding)
          : null;

        const rows = (yield* sql<ChunkRow>`
            INSERT INTO chunks (id, document_id, chunk_index, content, token_count, embedding, metadata, updated_at)
            VALUES (${input.id}, ${input.documentId}, ${input.chunkIndex}, ${input.content}, ${input.tokenCount ?? 0}, ${embeddingParam}, ${meta}, NOW())
            ON CONFLICT (document_id, chunk_index) DO UPDATE SET
              id = EXCLUDED.id,
              content = EXCLUDED.content,
              token_count = EXCLUDED.token_count,
              embedding = EXCLUDED.embedding,
              metadata = EXCLUDED.metadata,
              updated_at = NOW()
            RETURNING id, document_id, chunk_index, content, token_count, embedding, metadata, created_at, updated_at
          `) as ReadonlyArray<ChunkRow>;

        const row = rows[0];
        if (!row) {
          return yield* Effect.die(new Error("Failed to upsert chunk"));
        }
        return mapChunkRow(row);
      });

    const getChunksByDocument = (documentId: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<ChunkRow>`
            SELECT id, document_id, chunk_index, content, token_count, embedding, metadata, created_at, updated_at
            FROM chunks
            WHERE document_id = ${documentId}
            ORDER BY chunk_index ASC
          `) as ReadonlyArray<ChunkRow>;

        return rows.map(mapChunkRow);
      });

    const linkEntityChunk = (mention: EntityChunkMention) =>
      Effect.gen(function* () {
        const mentionText = mention.mentionText ?? null;
        const confidence = mention.confidence ?? 1.0;

        yield* sql`
            INSERT INTO entity_chunks (entity_id, chunk_id, mention_text, confidence, created_at)
            VALUES (${mention.entityId}, ${mention.chunkId}, ${mentionText}, ${confidence}, NOW())
            ON CONFLICT (entity_id, chunk_id) DO UPDATE SET
              mention_text = EXCLUDED.mention_text,
              confidence = EXCLUDED.confidence
          `;
      });

    const getChunksForEntity = (entityId: string) =>
      Effect.gen(function* () {
        const rows = (yield* sql<ChunkRow>`
            SELECT c.id, c.document_id, c.chunk_index, c.content, c.token_count, c.embedding, c.metadata, c.created_at, c.updated_at
            FROM entity_chunks ec
            JOIN chunks c ON ec.chunk_id = c.id
            WHERE ec.entity_id = ${entityId}
            ORDER BY ec.confidence DESC
          `) as ReadonlyArray<ChunkRow>;

        return rows.map(mapChunkRow);
      });

    const getEntityIdsForChunks = (chunkIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        if (chunkIds.length === 0) {
          return [] as ReadonlyArray<string>;
        }
        const rows = (yield* sql<{ entity_id: string }>`
            SELECT DISTINCT entity_id
            FROM entity_chunks
            WHERE chunk_id = ANY(${chunkIds})
          `) as ReadonlyArray<{ entity_id: string }>;

        return rows.map((r) => r.entity_id);
      });

    const searchVector = (query: VectorSearchQuery) =>
      Effect.gen(function* () {
        const vec = Pg.vector(query.embedding);
        const topK = query.topK ?? 10;
        const threshold = query.threshold ?? 0.0;

        const rows = (
          query.documentId
            ? yield* sql<SearchRow>`
                  SELECT id, document_id, content, metadata,
                         (1 - (embedding <=> ${vec})) AS score
                  FROM chunks
                  WHERE document_id = ${query.documentId}
                    AND (1 - (embedding <=> ${vec})) >= ${threshold}
                  ORDER BY embedding <=> ${vec} ASC
                  LIMIT ${topK}
                `
            : yield* sql<SearchRow>`
                  SELECT id, document_id, content, metadata,
                         (1 - (embedding <=> ${vec})) AS score
                  FROM chunks
                  WHERE embedding IS NOT NULL
                    AND (1 - (embedding <=> ${vec})) >= ${threshold}
                  ORDER BY embedding <=> ${vec} ASC
                  LIMIT ${topK}
                `
        ) as ReadonlyArray<SearchRow>;

        return rows.map((r) => ({
          chunkId: r.id,
          documentId: r.document_id,
          content: r.content,
          score: Number(r.score),
          metadata:
            typeof r.metadata === "string"
              ? JSON.parse(r.metadata)
              : ((r.metadata as Record<string, unknown>) ?? {}),
        }));
      });

    const searchKeyword = (query: KeywordSearchQuery) =>
      Effect.gen(function* () {
        const limit = query.limit ?? 10;

        const rows = (yield* sql<SearchRow>`
            SELECT id, document_id, content, metadata,
                   ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query.query})) AS score
            FROM chunks
            WHERE to_tsvector('english', content) @@ plainto_tsquery('english', ${query.query})
            ORDER BY score DESC
            LIMIT ${limit}
          `) as ReadonlyArray<SearchRow>;

        return rows.map((r) => ({
          chunkId: r.id,
          documentId: r.document_id,
          content: r.content,
          score: Number(r.score),
          metadata:
            typeof r.metadata === "string"
              ? JSON.parse(r.metadata)
              : ((r.metadata as Record<string, unknown>) ?? {}),
        }));
      });

    const searchHybrid = (query: HybridSearchQuery) =>
      Effect.gen(function* () {
        const limit = query.limit ?? 10;
        const rrfK = query.rrfK ?? 60;

        const [vecResults, keyResults] = yield* Effect.all([
          searchVector({
            embedding: query.embedding,
            topK: limit * 2,
          }),
          searchKeyword({
            query: query.query,
            limit: limit * 2,
          }),
        ]);

        const vecRanked = vecResults.map((item) => ({
          id: item.chunkId,
          item,
        }));
        const keyRanked = keyResults.map((item) => ({
          id: item.chunkId,
          item,
        }));

        const fused = fuseRankings([vecRanked, keyRanked], rrfK, limit);
        return fused.map(({ item, score }) => ({
          ...item.item,
          score,
        }));
      });

    const count = () =>
      Effect.gen(function* () {
        const rows = yield* sql<{ count: string | number }>`
            SELECT COUNT(*) AS count FROM chunks
          `;
        return Number(rows[0]?.count ?? 0);
      });

    return {
      saveRawDocument,
      getRawDocument,
      upsertChunk,
      getChunksByDocument,
      linkEntityChunk,
      getChunksForEntity,
      getEntityIdsForChunks,
      searchVector,
      searchKeyword,
      searchHybrid,
      count,
    };
  }),
);
