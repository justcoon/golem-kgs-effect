import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Layer, Redacted, Schema } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import {
  LlmSynthesisService,
  LlmSynthesisError,
} from "../src/pipeline/llm-service.js";
import { synthesizeAnswerText } from "../src/pipeline/graphrag-service.js";
import { type GraphRAGContextBundle } from "../src/domain/query.js";
import { LlmConfigSchema } from "../src/config/schema.js";

const createMockContextBundle = (
  overrides?: Partial<GraphRAGContextBundle>,
): GraphRAGContextBundle => ({
  query: "What is Golem Cloud?",
  relevantChunks: [
    {
      chunkId: "chunk-1",
      documentId: "doc-1",
      content:
        "Golem Cloud is a durable computing platform that runs WebAssembly components reliably.",
      score: 0.95,
      metadata: {
        title: "Golem Overview",
        sourceUri: "https://learn.golem.cloud",
      },
    },
  ],
  entities: [
    {
      id: "ent-1",
      name: "Golem Cloud",
      entityType: "Technology",
      description: "Durable computing platform",
      aliases: ["golem"],
      properties: {},
      createdAt: 1000,
      updatedAt: 1000,
    },
  ],
  relationships: [
    {
      id: "edge-1",
      sourceId: "ent-1",
      targetId: "ent-2",
      relationType: "USES",
      weight: 1.0,
      confidence: 0.9,
      properties: {},
      createdAt: 1000,
      updatedAt: 1000,
    },
  ],
  subgraph: {
    nodes: [],
    edges: [],
  },
  ...overrides,
});

describe("LlmSynthesisService", () => {
  it("should return empty notice immediately if context bundle is empty", async () => {
    const emptyBundle: GraphRAGContextBundle = {
      query: "Nonexistent topic",
      relevantChunks: [],
      entities: [],
      relationships: [],
      subgraph: { nodes: [], edges: [] },
    };

    const mockLlmLayer = Layer.succeed(LanguageModel.LanguageModel, {
      generateText: () =>
        Effect.dieMessage("Should not be called for empty context"),
    } as unknown as typeof LanguageModel.LanguageModel.Service);

    const program = Effect.gen(function* () {
      const service = yield* LlmSynthesisService;
      return yield* service.synthesizeAnswer("Nonexistent topic", emptyBundle);
    }).pipe(
      Effect.provide(LlmSynthesisService.Default),
      Effect.provide(mockLlmLayer),
    );

    const result = await Effect.runPromise(program);
    assert.match(
      result,
      /No matching knowledge graph entities or documents found/,
    );
  });

  it("should synthesize answer using LanguageModel when context is present", async () => {
    const bundle = createMockContextBundle();
    let capturedPrompt = "";

    const mockLlmLayer = Layer.succeed(LanguageModel.LanguageModel, {
      generateText: (options: { prompt: string }) => {
        capturedPrompt = options.prompt;
        return Effect.succeed(
          new LanguageModel.GenerateTextResponse([
            {
              type: "text",
              text: "Golem Cloud enables developers to build durable WebAssembly applications with automatic checkpointing.",
            },
          ]),
        );
      },
    } as unknown as typeof LanguageModel.LanguageModel.Service);

    const program = Effect.gen(function* () {
      const service = yield* LlmSynthesisService;
      return yield* service.synthesizeAnswer(bundle.query, bundle);
    }).pipe(
      Effect.provide(LlmSynthesisService.Default),
      Effect.provide(mockLlmLayer),
    );

    const result = await Effect.runPromise(program);
    assert.strictEqual(
      result,
      "Golem Cloud enables developers to build durable WebAssembly applications with automatic checkpointing.",
    );

    // Verify prompt grounding contains the chunks and graph entities
    assert.ok(
      capturedPrompt.includes("Golem Cloud is a durable computing platform"),
    );
    assert.ok(capturedPrompt.includes("Document: doc-1"));
    assert.ok(capturedPrompt.includes("User Question: What is Golem Cloud?"));
  });

  it("should fallback to synthesizeAnswerText if LanguageModel returns blank text", async () => {
    const bundle = createMockContextBundle();

    const mockLlmLayer = Layer.succeed(LanguageModel.LanguageModel, {
      generateText: () =>
        Effect.succeed(
          new LanguageModel.GenerateTextResponse([
            {
              type: "text",
              text: "   \n  ",
            },
          ]),
        ),
    } as unknown as typeof LanguageModel.LanguageModel.Service);

    const program = Effect.gen(function* () {
      const service = yield* LlmSynthesisService;
      return yield* service.synthesizeAnswer(bundle.query, bundle);
    }).pipe(
      Effect.provide(LlmSynthesisService.Default),
      Effect.provide(mockLlmLayer),
    );

    const result = await Effect.runPromise(program);
    const expectedFallback = synthesizeAnswerText(bundle.query, bundle);
    assert.strictEqual(result, expectedFallback);
  });

  it("should fail with LlmSynthesisError when LanguageModel fails", async () => {
    const bundle = createMockContextBundle();

    const mockLlmLayer = Layer.succeed(LanguageModel.LanguageModel, {
      generateText: () =>
        Effect.fail(
          new Error("Connection refused to Ollama /v1/chat/completions"),
        ),
    } as unknown as typeof LanguageModel.LanguageModel.Service);

    const program = Effect.gen(function* () {
      const service = yield* LlmSynthesisService;
      return yield* service.synthesizeAnswer(bundle.query, bundle);
    }).pipe(
      Effect.provide(LlmSynthesisService.Default),
      Effect.provide(mockLlmLayer),
    );

    await assert.rejects(
      Effect.runPromise(program),
      (err: unknown) => err instanceof LlmSynthesisError,
    );
  });

  describe("LlmConfigSchema", () => {
    it("should decode valid LlmConfigSchema with Redacted apiKey", () => {
      const raw = {
        llm: {
          api_base: "http://localhost:11434/v1",
          model: "qwen2.5:1.5b",
          apiKey: Redacted.make("ollama"),
        },
      };

      const decoded = Schema.decodeUnknownSync(LlmConfigSchema)(raw);
      assert.ok(decoded.llm);
      assert.strictEqual(decoded.llm.api_base, "http://localhost:11434/v1");
      assert.strictEqual(decoded.llm.model, "qwen2.5:1.5b");
      assert.strictEqual(Redacted.value(decoded.llm.apiKey), "ollama");
    });

    it("should reject when llm is missing", () => {
      assert.throws(() => Schema.decodeUnknownSync(LlmConfigSchema)({}));
    });
  });
});
