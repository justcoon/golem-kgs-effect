import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Pg, parseJsonOr } from "./database-client.js";
import { type RawDocument } from "../domain/provenance.js";

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly metadata: unknown;
  readonly tags: string[];
  readonly source: string;
  readonly resource_name: string;
  readonly source_key: string;
  readonly size_bytes: number | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const mapDocumentRow = (row: DocumentRow): RawDocument => ({
  id: row.id,
  title: row.title,
  content: row.content,
  metadata: parseJsonOr(row.metadata, {}),
  tags: row.tags ?? [],
  source: row.source,
  resourceName: row.resource_name,
  sourceKey: row.source_key,
  sizeBytes: Number(row.size_bytes),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

import {
  DocumentRepository,
  type DocumentRepositoryShape,
} from "./repository-tags.js";
export { DocumentRepository, type DocumentRepositoryShape };

DocumentRepository.Default = Layer.effect(
  DocumentRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const saveDocument = (doc: RawDocument) =>
      Effect.gen(function* () {
        const now = new Date();
        const rows = yield* sql<DocumentRow>`
            INSERT INTO documents (
              id, title, content, metadata, tags, source, resource_name, source_key, size_bytes, created_at, updated_at
            ) VALUES (
              ${doc.id},
              ${doc.title},
              ${doc.content},
              ${Pg.jsonb(doc.metadata)},
              ${Pg.array(doc.tags)},
              ${doc.source},
              ${doc.resourceName},
              ${doc.sourceKey},
              ${doc.sizeBytes},
              ${doc.createdAt ?? now},
              ${doc.updatedAt ?? now}
            )
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              content = EXCLUDED.content,
              metadata = EXCLUDED.metadata,
              tags = EXCLUDED.tags,
              source = EXCLUDED.source,
              resource_name = EXCLUDED.resource_name,
              source_key = EXCLUDED.source_key,
              size_bytes = EXCLUDED.size_bytes,
              updated_at = EXCLUDED.updated_at
            RETURNING *
          `;
        const first = rows[0];
        if (!first) {
          return yield* Effect.die(
            new Error("Document insert failed to return row"),
          );
        }
        return mapDocumentRow(first);
      });

    const findDocumentById = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* sql<DocumentRow>`
            SELECT * FROM documents WHERE id = ${id}
          `;
        const first = rows[0];
        return rows.length > 0 && first
          ? Option.some(mapDocumentRow(first))
          : Option.none();
      });

    const findByResourceKey = (
      source: string,
      resourceName: string,
      sourceKey: string,
    ) =>
      Effect.gen(function* () {
        const rows = yield* sql<DocumentRow>`
            SELECT * FROM documents
            WHERE source = ${source} AND resource_name = ${resourceName} AND source_key = ${sourceKey}
            LIMIT 1
          `;
        const first = rows[0];
        return rows.length > 0 && first
          ? Option.some(mapDocumentRow(first))
          : Option.none();
      });

    const listDocuments = (options?: {
      source?: string;
      resourceName?: string;
      namespace?: string;
      limit?: number;
      offset?: number;
    }) =>
      Effect.gen(function* () {
        const limit = options?.limit ?? 50;
        const offset = options?.offset ?? 0;
        const resName = options?.resourceName ?? options?.namespace;
        let rows: ReadonlyArray<DocumentRow>;
        if (options?.source && resName) {
          rows = yield* sql<DocumentRow>`
              SELECT * FROM documents
              WHERE source = ${options.source} AND resource_name = ${resName}
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `;
        } else if (options?.source) {
          rows = yield* sql<DocumentRow>`
              SELECT * FROM documents
              WHERE source = ${options.source}
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `;
        } else if (resName) {
          rows = yield* sql<DocumentRow>`
              SELECT * FROM documents
              WHERE resource_name = ${resName}
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `;
        } else {
          rows = yield* sql<DocumentRow>`
              SELECT * FROM documents
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `;
        }
        return rows.map(mapDocumentRow);
      });

    const deleteDocument = (id: string) =>
      Effect.gen(function* () {
        const result = yield* sql`
            DELETE FROM documents WHERE id = ${id}
          `;
        return (result.length ?? 0) >= 0;
      });

    const count = () =>
      Effect.gen(function* () {
        const rows = yield* sql<{ count: string | number }>`
            SELECT COUNT(*) AS count FROM documents
          `;
        return Number(rows[0]?.count ?? 0);
      });

    return {
      saveDocument,
      findDocumentById,
      findByResourceKey,
      listDocuments,
      deleteDocument,
      count,
    };
  }),
);
