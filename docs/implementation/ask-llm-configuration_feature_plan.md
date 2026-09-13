# Feature Plan: Secret-Backed LLM Configuration for the Ask Endpoint

- **Feature ID / Slug**: `ask-llm-configuration`
- **Date**: 2026-09-13
- **Status**: Approved <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

The `ask` endpoint on `KnowledgeAccessAgent` supports synthesizing answers using an LLM (`LlmSynthesisService`) or falling back to deterministic template generation (`synthesizeAnswerText`). Currently, if `generateAnswer: true` is passed, it always attempts LLM synthesis.

This feature adds a secret-backed configuration flag `llm.useForAsk` (defaulting to `false` in `.env`) so operators can:
1. Control whether `/ask` should use the LLM by default or use fast deterministic generation when `generateAnswer: true`.
2. Dynamically update the setting at runtime via the Golem CLI (`golem secret update-value llm.useForAsk --secret-value 'true'`) without restarting or redeploying agents.

### Goals
1. Add `useForAsk` under `LlmConfigFields` in `src/config/schema.ts` as a `Schema.Redacted(...)` secret field.
2. Configure `useForAsk: "{{ LLM_USE_FOR_ASK }}"` under `secretDefaults.local.llm` in `golem.yaml`.
3. Set `LLM_USE_FOR_ASK=false` default in `.env.example` and `.env`.
4. Update `KnowledgeAccessAgent.ask` in `src/agents/access-agent.ts` to:
   - Dynamically read `config.llm.useForAsk.get` on each invocation when `generateAnswer: true`.
   - When generating an answer: if `useForAsk` is true, invoke `LlmSynthesisService`; if false, directly invoke `synthesizeAnswerText`.
5. Update tests in `test/llm-service.test.ts` and ensure full test suite passes.
6. Update `README.md` documentation.

---

## 2. Proposed Changes & File Impact

| Action | File Path | Description |
| :--- | :--- | :--- |
| `[MODIFY]` | [`src/config/schema.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts) | Add `useForAsk: Schema.Redacted(...)` to `LlmConfigFields` and `LlmConfigShape`. |
| `[MODIFY]` | [`golem.yaml`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml) | Add `useForAsk: "{{ LLM_USE_FOR_ASK }}"` to `secretDefaults.local.llm`. |
| `[MODIFY]` | [`.env.example`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.example) | Add `LLM_USE_FOR_ASK=false`. |
| `[MODIFY]` | [`.env`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env) | Add `LLM_USE_FOR_ASK=false`. |
| `[MODIFY]` | [`src/agents/access-agent.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts) | Evaluate `config.llm.useForAsk.get` when `generateAnswer: true`. |
| `[MODIFY]` | [`test/llm-service.test.ts`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/llm-service.test.ts) | Add tests for secret configuration decoding. |
| `[MODIFY]` | [`README.md`](file:///Users/coon/workspace-zv/git/golem-kgs-effect/README.md) | Document `LLM_USE_FOR_ASK` and secret update CLI commands. |

---

## 3. Verification Plan

1. `npm test` - Run automated test suite.
2. `npm run typecheck` - Verify TypeScript compiles cleanly.
3. `npm run lint` - Verify no ESLint errors.
4. `npm run format:check` - Verify code formatting.
5. `npm run build` - Verify Golem component WASM builds successfully.
