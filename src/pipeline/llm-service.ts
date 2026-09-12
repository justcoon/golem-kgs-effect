import { Context, Data, Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { type GraphRAGContextBundle } from "../domain/query.js";
import {
  formatContextPrompt,
  synthesizeAnswerText,
} from "./graphrag-service.js";

export class LlmSynthesisError extends Data.TaggedError("LlmSynthesisError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface LlmSynthesisServiceShape {
  readonly synthesizeAnswer: (
    query: string,
    bundle: GraphRAGContextBundle,
  ) => Effect.Effect<string, LlmSynthesisError>;
}

export class LlmSynthesisService extends Context.Service<
  LlmSynthesisService,
  LlmSynthesisServiceShape
>()("app/pipeline/LlmSynthesisService") {
  static readonly Default = Layer.effect(
    LlmSynthesisService,
    Effect.gen(function* () {
      const languageModel = yield* LanguageModel.LanguageModel;

      return {
        synthesizeAnswer: (query: string, bundle: GraphRAGContextBundle) =>
          Effect.gen(function* () {
            // If there's no context found at all, return the empty-context notice directly
            if (
              bundle.relevantChunks.length === 0 &&
              bundle.entities.length === 0
            ) {
              return `No matching knowledge graph entities or documents found for query "${query}".`;
            }

            const contextPrompt = formatContextPrompt(
              query,
              bundle.relevantChunks,
              bundle.entities,
              bundle.relationships,
            );

            const prompt = `You are a knowledgeable AI assistant answering questions grounded in a Knowledge Graph and document excerpts.

Instructions:
1. Synthesize a direct, concise, and well-structured natural language answer in clean GitHub-Flavored Markdown.
2. Ground your answer strictly in the provided document excerpts and knowledge graph relationships.
3. Cite sources (e.g. [Document <id>] or source title) when referencing facts from excerpts.
4. If the provided context does not contain enough information to answer the question, state that clearly and accurately. Do not fabricate facts.

${contextPrompt}

User Question: ${query}

Synthesized Answer:`;

            const response = yield* LanguageModel.generateText({
              prompt,
              toolChoice: "none",
            }).pipe(
              Effect.mapError(
                (err) =>
                  new LlmSynthesisError({
                    message: `LLM generation failed: ${String(err)}`,
                    cause: err,
                  }),
              ),
            );

            const trimmed = response.text.trim();
            if (trimmed.length === 0) {
              return synthesizeAnswerText(query, bundle);
            }
            return trimmed;
          }).pipe(
            Effect.provideService(LanguageModel.LanguageModel, languageModel),
          ),
      };
    }),
  );
}
