# Implementation Walkthrough: Secret-Backed LLM Configuration for Ask Endpoint

- **Feature ID**: `ask-llm-configuration`
- **Date**: 2026-09-13
- **Status**: Completed

---

## 1. Summary of Changes

Configured whether the `/api/knowledge/ask` endpoint uses LLM synthesis by introducing a Golem Secret `llm.useForAsk` (defaulting to `false` in configuration).

### Key Additions & Updates

1. **Secret Configuration in Schema ([src/config/schema.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/config/schema.ts))**:
   - Added `BooleanSecretSchema` (`Schema.Redacted(Schema.Union([Schema.Boolean, Schema.String]))`) and `parseBooleanSecret` helper.
   - Added `useForAsk: BooleanSecretSchema` to `LlmConfigFields` and `LlmConfigShape`.
2. **Secret Defaults & Environment Variables ([golem.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml), [.env.example](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.example), [.env](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env))**:
   - Mapped `secretDefaults.local.llm.useForAsk: "{{ LLM_USE_FOR_ASK }}"`.
   - Set `LLM_USE_FOR_ASK=false` by default.
3. **Endpoint Routing & Dynamic Secret Evaluation ([src/agents/access-agent.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/src/agents/access-agent.ts))**:
   - When generating an answer (`generateAnswer: true`), dynamically reads `config.llm.useForAsk.get` on each invocation.
   - If `useForAsk` is `true`, synthesizes using `LlmSynthesisService` (with resilient fallback to deterministic template).
   - If `useForAsk` is `false`, directly uses `synthesizeAnswerText` without calling the LLM.
4. **Testing & Documentation ([test/llm-service.test.ts](file:///Users/coon/workspace-zv/git/golem-kgs-effect/test/llm-service.test.ts), [README.md](file:///Users/coon/workspace-zv/git/golem-kgs-effect/README.md))**:
   - Unit tests covering `LlmConfigSchema` decoding with redacted boolean/string values and `parseBooleanSecret` logic.
   - Updated documentation for `LLM_USE_FOR_ASK` and CLI dynamic updates (`golem secret update-value llm.useForAsk --secret-value 'true'`).

---

## 2. Validation Results

| Check | Command | Result |
| :--- | :--- | :--- |
| **Formatting** | `npm run format:check` | PASSED (All files formatted) |
| **Typecheck** | `npm run typecheck` | PASSED (Zero TypeScript errors) |
| **Lint** | `npm run lint` | PASSED (Zero ESLint issues) |
| **Automated Tests** | `npm test` | PASSED (141 tests pass) |
| **Golem Component Build** | `npm run build` | PASSED (WASM pre-initialized cleanly) |

---

## 3. Dynamic Runtime Usage (CLI)

Because the flag is declared as a secret, you can toggle LLM answer synthesis in real time without redeploying:

```bash
# Switch ask endpoint to use LLM:
golem secret update-value llm.useForAsk --secret-value 'true'

# Switch ask endpoint to fast deterministic generation:
golem secret update-value llm.useForAsk --secret-value 'false'
```
