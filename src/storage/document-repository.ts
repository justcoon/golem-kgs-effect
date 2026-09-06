import { Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { type SqlError } from "effect/unstable/sql/SqlError";
import { Pg } from "@golemcloud/effect-golem/postgres";
import { type RawDocument } from "../domain/provenance.js";

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly metadata: unknown;
  readonly tags: string[];
  readonly source: string;
  readonly namespace: string;
  readonly size_bytes: number | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const mapDocumentRow = (row: DocumentRow): RawDocument => ({
  id: row.id,
  title: row.title,
  content: row.content,
  metadata:
    typeof row.metadata === "string"
      ? JSON.parse(row.metadata)
      : ((row.metadata as Record<string, unknown>) ?? {}),
  tags: row.tags ?? [],
  source: row.source,
  namespace: row.namespace,
  sizeBytes: Number(row.size_bytes),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export interface DocumentRepositoryShape {
  readonly saveDocument: (
    doc: RawDocument,
  ) => Effect.Effect<RawDocument, SqlError>;
  readonly findDocumentById: (
    id: string,
  ) => Effect.Effect<Option.Option<RawDocument>, SqlError>;
  readonly listDocuments: (options?: {
    source?: string;
    namespace?: string;
    limit?: number;
    offset?: number;
  }) => Effect.Effect<ReadonlyArray<RawDocument>, SqlError>;
  readonly deleteDocument: (id: string) => Effect.Effect<boolean, SqlError>;
}

export class DocumentRepository extends Context.Service<
  DocumentRepository,
  DocumentRepositoryShape
>()("app/storage/DocumentRepository") {
  static readonly Default = Layer.effect(
    DocumentRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const saveDocument = (doc: RawDocument) =>
        Effect.gen(function* () {
          const now = new Date();
          const rows = yield* sql<DocumentRow>`
            INSERT INTO documents (
              id, title, content, metadata, tags, source, namespace, size_bytes, created_at, updated_at
            ) VALUES (
              ${doc.id},
              ${doc.title},
              ${doc.content},
              ${Pg.jsonb(doc.metadata)},
              ${Pg.array(doc.tags)},
              ${doc.source},
              ${doc.namespace},
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
              namespace = EXCLUDED.namespace,
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

      const listDocuments = (options?: {
        source?: string;
        namespace?: string;
        limit?: number;
        offset?: number;
      }) =>
        Effect.gen(function* () {
          const limit = options?.limit ?? 50;
          const offset = options?.offset ?? 0;
          let rows: ReadonlyArray<DocumentRow>;
          if (options?.source && options?.namespace) {
            rows = yield* sql<DocumentRow>`
              SELECT * FROM documents
              WHERE source = ${options.source} AND namespace = ${options.namespace}
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
          } else if (options?.namespace) {
            rows = yield* sql<DocumentRow>`
              SELECT * FROM documents
              WHERE namespace = ${options.namespace}
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

      return {
        saveDocument,
        findDocumentById,
        listDocuments,
        deleteDocument,
      };
    }),
  );
}
