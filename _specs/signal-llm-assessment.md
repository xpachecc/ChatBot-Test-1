# Spec for Signal LLM-Assisted Assessment

feature_slug: signal-llm-assessment

## Intent and Desired Outcomes
- Business intent: Add an optional LLM-powered assessment mode for signal agents that provides deeper, context-aware analysis of user engagement, sentiment, trust, and intent on strategically important conversation nodes — while maintaining zero user-observable latency through the fire-and-forget architecture.
- User problem: Heuristic agents miss nuance — sarcasm, polite deflection, subtle enthusiasm, implied frustration. For high-value conversation moments (e.g., after discovery answers, before readout), an LLM can provide substantially more accurate assessment.
- Desired outcomes:
  - A single LLM call returns structured scores for all four dimensions with brief justifications
  - LLM assessment runs only on nodes explicitly marked with `signalAgents: true` and when `llmEnabled` is configured
  - LLM results are used with higher confidence when available; heuristic results serve as fallback
  - The model is configurable per flow via the established YAML `config.models` pattern
- Success metrics (observable):
  - LLM agent produces valid 4-dimension scores from a single structured output call
  - LLM assessment is triggered only on nodes with `signalAgents: true`
  - When the LLM call fails or times out, heuristic scores are used seamlessly
  - No measurable increase in user-observed response latency

## Summary
This phase adds `runLlmSignalAgent` — a single GPT-3.5-turbo structured output call that assesses all four signal dimensions from the `SignalContext`. It runs in parallel with heuristic agents inside the orchestrator. The model is configured via the standard two-layer pattern: a `signalAssessment` entry in the flow YAML `config.models` block (flow author control) with a fallback default in `model-factory.ts` (infrastructure default). The `source` field in `SignalAgentResult` is expanded from `"heuristic"` to `"heuristic" | "llm"`. The per-node `signalAgents` boolean flag (already in the YAML schema but currently unwired) is connected to control when LLM assessment runs. The entire LLM call runs within the fire-and-forget orchestrator — results merge on the next turn with zero latency impact.

## Scenario Coverage

### Primary Success Scenario
- Given a node with `signalAgents: true` and `config.signalAgents.llmEnabled: true`
- When the orchestrator fires for that node
- Then the LLM agent runs in parallel with heuristic agents, and its higher-confidence results are preferred in the final aggregation

### Variation Scenarios
- Scenario A: Node has `signalAgents: false` -> LLM agent is not invoked; heuristic-only (or no assessment at all depending on global config).
- Scenario B: Node has `signalAgents: true` but `llmEnabled` is false in config -> heuristic agents only; LLM is not invoked.
- Scenario C: LLM call fails (network error, invalid response) -> heuristic results are used as fallback; no error propagated.
- Scenario D: LLM call exceeds the orchestrator's internal TTL -> heuristic results are used; LLM result is discarded.
- Scenario E: LLM returns a valid response but one dimension score is out of range -> that dimension falls back to the heuristic score; valid dimensions from LLM are kept.

### Failure / Edge Scenarios
- Scenario E1: `OPENAI_API_KEY` is missing -> `getModel("signalAssessment")` throws; caught by orchestrator error handling; heuristic fallback.
- Scenario E2: LLM returns a response that doesn't match the structured output schema -> parse failure caught; heuristic fallback.
- Scenario E3: Model alias "signalAssessment" is not configured in YAML and not in defaults -> `getModel` throws; caught; heuristic fallback.

## Functional Requirements
- FR-1: The system should provide `runLlmSignalAgent(ctx: SignalContext): Promise<SignalAgentResult[]>` that makes a single LLM call and returns results for all four dimensions.
- FR-2: The LLM prompt should include: the last bot message, the user's reply, the question purpose (if available), and instruction to return structured JSON with scores (0–1) and brief justifications for engagement, sentiment, trust, and intent.
- FR-3: The LLM response should be validated against a Zod schema; invalid fields fall back to heuristic values.
- FR-4: The `source` field in `SignalAgentResult` should be expanded to `z.enum(["heuristic", "llm"])`.
- FR-5: LLM results should carry higher confidence (derived from response validity and completeness) than heuristic results.
- FR-6: The orchestrator merge strategy should prefer LLM scores over heuristic scores when both are available, per dimension.
- FR-7: The `signalAgents` per-node boolean flag should be wired from the compiled graph node config through to the orchestrator's `nodeSignalAgents` parameter.
- FR-8: The YAML `SignalAgentConfigSchema` should be extended with `llmEnabled: z.boolean().default(false)`.
- FR-9: The LLM agent should use `getModel("signalAssessment")` — never hardcoding a model name.
- FR-10: A `signalAssessment` default should be added to `defaultConfigs` in `model-factory.ts`: `{ model: "gpt-3.5-turbo", temperature: 0.2, maxRetries: 1 }`.
- FR-11: The CFS flow YAML and template YAML should include a `signalAssessment` entry in `config.models`.
- FR-12: The graph compiler already iterates `dsl.config.models` and calls `setModelConfig()` (lines 783–785 of `graph-compiler.ts`), so no compiler changes are needed for the model config — only YAML and defaults.

## Possible Edge Cases
- LLM returns scores that are valid numbers but semantically unreasonable (e.g., all 1.0 or all 0.0) — accepted as-is; confidence scoring from Phase 4 mitigates influence
- Context is minimal (first turn, no prior messages) — prompt adapts to available context
- LLM response latency varies widely (200ms–2000ms) — fire-and-forget handles this; results merge on next turn regardless
- Multiple nodes with `signalAgents: true` fire in sequence within a single `runTurn` — only the most recent orchestrator result is stored

## Acceptance Criteria
- AC-1: `runLlmSignalAgent` with mocked LLM returns valid `SignalAgentResult[]` with 4 dimensions and source "llm" -> pass
- AC-2: Node with `signalAgents: true` triggers LLM agent; node with `signalAgents: false` does not -> pass
- AC-3: When LLM call fails, orchestrator returns heuristic-only results with no error -> pass
- AC-4: LLM scores are preferred over heuristic scores in aggregation when both available -> pass
- AC-5: `getModel("signalAssessment")` returns valid ChatOpenAI instance -> pass
- AC-6: YAML `setModelConfig("signalAssessment", ...)` override takes precedence over default -> pass
- AC-7: `config.signalAgents.llmEnabled: false` prevents LLM agent invocation even on `signalAgents: true` nodes -> pass
- AC-8: No measurable increase in `runTurn` response time when LLM agent is enabled -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success -> "LLM agent produces valid 4-dimension scores"
  - Variation A -> "signalAgents: false skips LLM"
  - Variation B -> "llmEnabled: false skips LLM"
  - Variation C -> "LLM failure falls back to heuristic"
  - Failure E2 -> "invalid LLM response falls back to heuristic"
- Acceptance traceability:
  - AC-1 -> Unit test with mocked OpenAI (follows jest.setup.ts pattern)
  - AC-2 -> Integration test: two nodes, one true one false, verify LLM invocation count
  - AC-3 -> Unit test: orchestrator with LLM mock that throws
  - AC-4 -> Orchestrator test: both LLM and heuristic results available; verify LLM scores used
  - AC-5 -> Model factory test: `getModel("signalAssessment")` succeeds
  - AC-6 -> Model factory test: `setModelConfig` override verified
  - AC-7 -> Orchestrator test: llmEnabled false with nodeSignalAgents true
  - AC-8 -> Integration test: measure runTurn time with LLM enabled vs. disabled
- Regression checks:
  - All existing signal agent tests pass unchanged
  - Heuristic-only behavior is identical when LLM is disabled
  - Orchestrator output schema is unchanged
  - Per-node signalAgents flag does not affect nodes where it was previously unset (default behavior preserved)

## Dependencies and Constraints
- Dependencies:
  - Phase 1 (deferred merge) — LLM calls can take 200–800ms; fire-and-forget is essential
  - Phase 2 (conversation context) — LLM prompt requires SignalContext
  - Phase 3 (intent agent) — LLM returns 4 dimensions including intent
  - Phase 6 (events/actions) — LLM-sourced scores feed into event detection
  - `model-factory.ts` and graph compiler model config pipeline (existing, no changes needed)
- Constraints:
  - Must not introduce user-observable latency (fire-and-forget only)
  - Must not hardcode model names — use `getModel("signalAssessment")` exclusively
  - LLM mode is opt-in at two levels: global (`llmEnabled`) and per-node (`signalAgents: true`)
  - LLM API costs are incurred only on explicitly enabled nodes
  - Must mock OpenAI in all tests (never make real API calls in tests)

## Out of Scope
- Fine-tuning or custom model training for signal assessment
- Streaming LLM responses (single structured output call is sufficient)
- Caching LLM results across sessions
- Multi-model strategies (e.g., different models per dimension)
- Real-time LLM confidence calibration

## Open Questions
- Should the LLM prompt include signal_history summary (e.g., "engagement has been declining") to give the model conversational trajectory context?
- Should LLM justification strings be stored in signal_history for debugging/observability, or kept out to minimize state size?
- Should there be a cost budget or rate limit on LLM signal calls (e.g., max N per session)?
