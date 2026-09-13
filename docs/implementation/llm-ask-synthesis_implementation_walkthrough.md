# Feature Implementation Walkthrough: LLM-Powered Ask Endpoint Answer Synthesis

- **Feature ID / Slug**: `llm-ask-synthesis`
- **Date**: 2026-09-12
- **Status**: Completed

---

## 1. Executive Summary

This feature replaces the previous heuristic string-concatenation approach in the `/api/knowledge/ask` endpoint on `KnowledgeAccessAgent` with true natural language question answering powered by a lightweight local Large Language Model (e.g. `llama3.2:3b` or `qwen2.5:3b`) running within the existing Docker `ollama` container.

All implementation tasks have been delivered and strictly validated:

1. **Lightweight Docker Infrastructure**: Reused the existing `ollama` service in [docker-compose.yml](../../docker-compose.yml) to pull and serve `llama3.2:3b` (~2.0 GB RAM) via Ollama's OpenAI-compatible `/v1/chat/completions` API alongside `nomic-embed-text`.
2. **Golem SDK Alignment**: Integrated `@effect/ai-openai@4.0.0-beta.98` (exact pinned version matching `effect: 4.0.0-beta.98`), providing `LanguageModel.LanguageModel` from `effect/unstable/ai` over `FetchHttpClient.layer`.
3. **GraphRAG Prompt Synthesis**: Implemented `LlmSynthesisService` in [src/pipeline/llm-service.ts](../../src/pipeline/llm-service.ts) using the existing `formatContextPrompt` to supply grounded document excerpts and graph relationships with explicit anti-hallucination and citation instructions.
4. **Resilient Fallback**: Configured `KnowledgeAccessAgent.ask` to catch `LlmSynthesisError` and fall back to deterministic `synthesizeAnswerText` if Ollama is unreachable, ensuring continuous uptime.
5. **Configuration & Secrets**: Added `llm` config fields (`api_base`, `model`, `apiKey`) to [src/config/schema.ts](../../src/config/schema.ts), [src/config/agent-config.ts](../../src/config/agent-config.ts), [golem.yaml](../../golem.yaml), and [.env.example](../../.env.example).
6. **Documentation**: Updated [README.md](../../README.md) with prerequisites, environment variables, and GraphRAG QA details.
7. **Strict Quality Gates**: Verified with zero TypeScript errors (`npm run typecheck`), zero ESLint warnings (`npm run lint`), compliant Prettier formatting (`npm run format:check`), 139 passing unit tests (`npm test`), and a successful WASM compilation (`npm run build` / `golem build --yes`).

---

## 2. Changes Implemented

### File Modifications & Creations

| Action     | File Path                                                                        | Summary of Changes                                                                                                              |
| :--------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`package.json`](../../package.json)                                             | Added `@effect/ai-openai: 4.0.0-beta.98` exact dependency.                                                                      |
| `[MODIFY]` | [`docker-compose.yml`](../../docker-compose.yml)                                 | Configured `ollama-setup` to pull `${LLM_MODEL}` alongside `${OLLAMA_MODEL}`.                                                   |
| `[MODIFY]` | [`.env.example`](../../.env.example) and [`.env`](../../.env)                   | Added `LLM_MODEL=llama3.2:3b`, `LLM_API_BASE=http://localhost:11434/v1`, `LLM_API_KEY=ollama`.                                  |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                 | Added `llm` config section and `secretDefaults.local.llm.apiKey`.                                                               |
| `[MODIFY]` | [`src/config/schema.ts`](../../src/config/schema.ts)                             | Added `LlmConfigFields`, `LlmConfigSchema`, `LlmConfigShape`, and `LlmConfigValues` context service.                            |
| `[MODIFY]` | [`src/config/agent-config.ts`](../../src/config/agent-config.ts)                 | Merged `LlmConfigFields` into `AppAgentConfig`.                                                                                 |
| `[NEW]`    | [`src/pipeline/llm-service.ts`](../../src/pipeline/llm-service.ts)               | Implemented `LlmSynthesisService` with GraphRAG prompt formatting and `LanguageModel` integration.                              |
| `[MODIFY]` | [`src/pipeline/index.ts`](../../src/pipeline/index.ts)                           | Barrel export for `llm-service.js`.                                                                                            |
| `[MODIFY]` | [`src/agents/agent-pipeline-layer.ts`](../../src/agents/agent-pipeline-layer.ts) | Implemented `makeLlmLayer` with `OpenAiClient.layer` + `OpenAiLanguageModel.layer`, merged into `makeAccessAgentLayer`.         |
| `[MODIFY]` | [`src/agents/access-agent.ts`](../../src/agents/access-agent.ts)                 | Updated `ask` method to synthesize with `LlmSynthesisService` and fall back gracefully on `LlmSynthesisError`.                  |
| `[NEW]`    | [`test/llm-service.test.ts`](../../test/llm-service.test.ts)                     | Added automated unit tests covering prompt grounding, mocked LLM generation, blank-text fallback, error handling, and schemas.|
| `[MODIFY]` | [`README.md`](../../README.md)                                                   | Added LLM prerequisites, environment variable definitions, and updated GraphRAG QA documentation.                              |

---

## 3. Verification & Validation Results

### 1. Code Formatting
```bash
npm run format:check
```
*Result*: `All matched files use Prettier code style!` (Passed)

### 2. Type Checking
```bash
npm run typecheck
```
*Result*: Zero errors (`tsc --noEmit` exited with code 0). (Passed)

### 3. Linter Verification
```bash
npm run lint
```
*Result*: Zero lint warnings or errors (`eslint src/ test/` exited with code 0). (Passed)

### 4. Automated Unit Tests
```bash
npm test
```
*Result*:
```
ℹ tests 139
ℹ suites 50
ℹ pass 139
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
All 139 tests passed, including the new tests in `test/llm-service.test.ts`.

### 5. Golem Component WASM Build
```bash
npm run build # golem build --yes
```
*Result*:
```
Building components
  Building golem-kgs-effect:effect-main
    Executing external command 'npx --no rollup -- -c "/Users/coon/workspace-zv/git/golem-kgs-effect/golem-temp/common/effect/rollup.config.component.mjs"' in directory /Users/coon/workspace-zv/git/golem-kgs-effect
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
    Done! Input: 13668.5 KB, Output: 48564.3 KB
Adding metadata to components
  Adding metadata to golem-kgs-effect:effect-main

Finished building [OK]
```
WASM compilation and pre-initialization succeeded cleanly.

---

## 4. Usage Instructions

1. **Pull the model in Ollama**:
   ```bash
   ollama pull llama3.2:3b
   # Or via Docker:
   docker exec -it golem-kg-ollama ollama pull llama3.2:3b
   ```
2. **Deploy and run queries**:
   ```bash
   curl -s --url 'http://localhost:9006/api/knowledge/ask' \
     -H 'Content-Type: application/json' \
     -d '{
       "query": "What is Golem Cloud and how does it achieve durable execution?",
       "topK": 5,
       "maxHops": 2,
       "generateAnswer": true
     }'
   ```
   The `answer` field in the response now provides a synthesized natural language answer grounded in the retrieved chunks and knowledge graph relations, with source attribution.
