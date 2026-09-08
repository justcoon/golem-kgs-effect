import { Context, Data, Effect, Layer, Redacted, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { type VectorEmbedding } from "../domain/chunk.js";
import { EmbeddingConfigValues } from "../config/schema.js";

export const EMBEDDING_DIMENSION = 768;

export class EmbeddingError extends Data.TaggedError("EmbeddingError")<{
  readonly message: string;
  readonly details?: unknown;
}> {}

const OpenAiEmbeddingItem = Schema.Struct({
  embedding: Schema.Array(Schema.Number),
  index: Schema.optional(Schema.Number),
});

const OpenAiEmbeddingResponse = Schema.Struct({
  data: Schema.Array(OpenAiEmbeddingItem),
});

export interface EmbeddingServiceShape {
  readonly generateEmbedding: (
    text: string,
  ) => Effect.Effect<VectorEmbedding, EmbeddingError>;
  readonly generateEmbeddings: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<VectorEmbedding>, EmbeddingError>;
}

export class EmbeddingService extends Context.Service<
  EmbeddingService,
  EmbeddingServiceShape
>()("app/pipeline/EmbeddingService") {
  /**
   * Live HTTP layer using Golem's FetchHttpClient.layer and EmbeddingConfigValues.
   */
  static readonly Live = Layer.effect(
    EmbeddingService,
    Effect.gen(function* () {
      const config = yield* EmbeddingConfigValues;
      const apiBase = config.api_base;
      const model = config.model;
      const apiKey = Redacted.value(config.apiKey);

      const client = yield* HttpClient.HttpClient;

      const callEmbeddingEndpoint = (
        texts: ReadonlyArray<string>,
      ): Effect.Effect<ReadonlyArray<VectorEmbedding>, EmbeddingError> =>
        Effect.gen(function* () {
          if (texts.length === 0) {
            return [];
          }

          const normalizedBase = apiBase.endsWith("/")
            ? apiBase.slice(0, -1)
            : apiBase;
          const url = `${normalizedBase}/embeddings`;

          let req = HttpClientRequest.post(url).pipe(
            HttpClientRequest.setHeader("Content-Type", "application/json"),
          );

          if (apiKey && apiKey !== "ollama" && apiKey.length > 0) {
            req = HttpClientRequest.setHeader(
              "Authorization",
              `Bearer ${apiKey}`,
            )(req);
          }

          const reqWithBody = yield* HttpClientRequest.bodyJson({
            model,
            input: texts,
          })(req).pipe(
            Effect.mapError(
              (err) =>
                new EmbeddingError({
                  message: `Failed to serialize embedding request body: ${String(err)}`,
                  details: err,
                }),
            ),
          );

          const response = yield* client.execute(reqWithBody).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.mapError(
              (error) =>
                new EmbeddingError({
                  message: `Failed to call embedding endpoint at ${url}: ${String(error)}`,
                  details: error,
                }),
            ),
          );

          const json = yield* response.json.pipe(
            Effect.mapError(
              (err) =>
                new EmbeddingError({
                  message: `Failed to parse embedding response JSON: ${String(err)}`,
                  details: err,
                }),
            ),
          );

          const parsed = yield* Schema.decodeUnknownEffect(
            OpenAiEmbeddingResponse,
          )(json).pipe(
            Effect.mapError(
              (err) =>
                new EmbeddingError({
                  message: `Unexpected embedding response structure: ${String(err)}`,
                  details: err,
                }),
            ),
          );

          const embeddings: VectorEmbedding[] = [];
          for (let i = 0; i < parsed.data.length; i++) {
            const item = parsed.data[i];
            if (!item) continue;
            const vector = item.embedding;
            if (vector.length !== EMBEDDING_DIMENSION) {
              return yield* Effect.fail(
                new EmbeddingError({
                  message: `Expected embedding vector of dimension ${EMBEDDING_DIMENSION}, received ${vector.length}`,
                }),
              );
            }
            embeddings.push(vector as unknown as VectorEmbedding);
          }

          return embeddings;
        });

      return {
        generateEmbedding: (text: string) =>
          callEmbeddingEndpoint([text]).pipe(
            Effect.flatMap((vecs) => {
              const first = vecs[0];
              if (!first) {
                return Effect.fail(
                  new EmbeddingError({ message: "No embedding returned" }),
                );
              }
              return Effect.succeed(first);
            }),
          ),
        generateEmbeddings: (texts: ReadonlyArray<string>) =>
          callEmbeddingEndpoint(texts),
      };
    }),
  );

  /**
   * Deterministic Mock Layer for offline testing, CI, and local test runners.
   * Generates a normalized 768-dimensional vector computed from text string hashes.
   */
  static readonly Mock = Layer.succeed(EmbeddingService, {
    generateEmbedding: (text: string) =>
      Effect.sync(() => createMockEmbedding(text)),
    generateEmbeddings: (texts: ReadonlyArray<string>) =>
      Effect.sync(() => texts.map(createMockEmbedding)),
  });
}

/**
 * Generates a deterministic, normalized 768-dimensional vector from text.
 */
export function createMockEmbedding(text: string): VectorEmbedding {
  const vector: number[] = new Array(EMBEDDING_DIMENSION);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    const val = Math.sin(hash + i * 31);
    vector[i] = val;
    sumSquares += val * val;
  }

  // Normalize to unit vector for cosine similarity
  const norm = Math.sqrt(sumSquares) || 1;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    const val = vector[i];
    vector[i] = Number(((val ?? 0) / norm).toFixed(6));
  }

  return vector as unknown as VectorEmbedding;
}
