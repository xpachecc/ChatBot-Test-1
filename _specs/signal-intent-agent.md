# Spec for Signal Intent Agent

feature_slug: signal-intent-agent

## Intent and Desired Outcomes
- Business intent: Add a fourth signal dimension — intent classification — to detect whether the user is cooperating, rushing, deflecting, challenging, confused, or disengaging. This enables the conversation to adapt its pacing and approach based on user behavior patterns.
- User problem: The current three dimensions (engagement, sentiment, trust) measure tone and participation but cannot distinguish a user who is genuinely engaged from one who is politely rushing through, or a user who is skeptical-but-interested from one who is deflecting.
- Desired outcomes:
  - A new `intent_score` in `relationship_context` that quantifies cooperative vs. disengaged intent on a 0–1 scale
  - Intent classification categories that map to actionable conversation adaptations
  - The composite `overall_conversation_score` incorporates intent alongside the existing three dimensions
- Success metrics (observable):
  - Delegation language ("my team decides that") produces a lower intent score than cooperative language ("we're looking at solutions for...")
  - Minimal acknowledgment responses ("ok", "fine") to open questions produce a lower intent score than elaborated responses
  - Intent scores are bounded [0, 1] and contribute to the composite score

## Summary
This phase introduces `runIntentAgent` as a fourth heuristic agent running in parallel with engagement, sentiment, and trust. It uses a new `extractIntentFeatures` function that analyzes response-to-question length ratio, delegation language, hedging patterns, comparison/challenge language, and minimal acknowledgment detection. The orchestrator is updated to include intent in the EMA smoothing, composite score calculation, and signal history. The `COMPOSITE_WEIGHTS` are rebalanced across four dimensions.

## Scenario Coverage

### Primary Success Scenario
- Given a user provides a detailed, on-topic response to a discovery question
- When the intent agent processes the SignalContext
- Then the intent score is high (cooperating), reflecting genuine participation

### Variation Scenarios
- Scenario A: User responds with "sure, whatever works" or "that's fine I guess" -> intent score is low (rushing/disengaging).
- Scenario B: User responds with "that's more of a team decision, I'd have to check" -> intent score is moderate-low (deflecting).
- Scenario C: User asks "how is this different from what we already have?" -> intent score is moderate-high (challenging but still engaged).
- Scenario D: User says "I'm not sure what you mean" -> intent score reflects confusion, distinct from disengagement.

### Failure / Edge Scenarios
- Scenario E1: Very short text with no identifiable intent patterns -> intent defaults to neutral (0.5) with low confidence.
- Scenario E2: Text matches multiple intent categories simultaneously -> the weighted feature combination produces a blended score rather than choosing one category.
- Scenario E3: SignalContext has no question context -> intent agent falls back to text-only analysis.

## Functional Requirements
- FR-1: The system should provide a `runIntentAgent(ctx: SignalContext): Promise<SignalAgentResult>` function that returns a score on the "intent" dimension.
- FR-2: The system should provide `extractIntentFeatures(ctx: SignalContext): IntentFeatures` with features: `cooperationSignal`, `rushingSignal`, `deflectionSignal`, `challengeSignal`, `confusionSignal`.
- FR-3: `INTENT_WEIGHTS` should be defined in `signal-defaults.ts` with tunable weights for each feature.
- FR-4: The `dimension` enum in `SignalAgentResult` should include `"intent"`.
- FR-5: `SignalTurnRecord` should include an `intent` field.
- FR-6: `RelationshipContextSchema` should include `intent_score` with default 0.5.
- FR-7: `COMPOSITE_WEIGHTS` should be rebalanced for four dimensions (suggested: engagement 0.3, sentiment 0.25, trust 0.25, intent 0.2).
- FR-8: The orchestrator should run `runIntentAgent` in parallel with the other three agents.
- FR-9: Intent features should use `SignalContext.questionPurpose` and response-to-question length ratio when context is available.

## Possible Edge Cases
- User responds in a language other than English (patterns won't match)
- User response is entirely a URL or code snippet (no natural language to analyze)
- Hedging language that is culturally appropriate (e.g., "maybe" as a polite affirmative)
- Multi-sentence responses where intent shifts mid-message

## Acceptance Criteria
- AC-1: `runIntentAgent` returns a valid `SignalAgentResult` with dimension "intent" and score in [0, 1] -> pass
- AC-2: Delegation language produces a lower intent score than cooperative language -> pass
- AC-3: Minimal acknowledgment to an open question produces a lower intent score than to a confirmation question -> pass
- AC-4: The orchestrator's composite score includes the intent dimension -> pass
- AC-5: `relationship_context.intent_score` is populated after signal merge -> pass
- AC-6: All 15 existing fixtures plus new intent fixtures produce valid bounded scores -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success -> "cooperative response scores high intent"
  - Variation A -> "rushing language scores low intent"
  - Variation B -> "delegation language scores moderate-low intent"
  - Variation C -> "challenge language scores moderate-high intent"
  - Variation D -> "confusion language distinct from disengagement"
  - Failure E1 -> "short ambiguous text defaults to 0.5"
- Acceptance traceability:
  - AC-1 -> Unit test: `runIntentAgent` result shape validation
  - AC-2 -> Unit test: compare scores for delegation vs. cooperative text
  - AC-3 -> Unit test: compare scores for "ok" with confirm vs. open questionPurpose
  - AC-4 -> Orchestrator test: composite score uses 4 weights
  - AC-5 -> Integration test: relationship_context has intent_score after merge
  - AC-6 -> Fixture suite: all scores in [0, 1]
- Regression checks:
  - Existing engagement, sentiment, trust scores are not affected by the addition
  - Orchestrator EMA produces valid cumulative scores with 4 dimensions
  - Signal history records include the new intent field

## Dependencies and Constraints
- Dependencies:
  - Phase 2 (conversation context) must be complete — intent detection relies on SignalContext for question-relative analysis
  - `signal-types.ts` dimension enum must support extension
- Constraints:
  - Must run within the same fire-and-forget window as other agents
  - Heuristic-only (no LLM) — LLM-assisted intent is covered by Phase 7
  - Rebalancing COMPOSITE_WEIGHTS may subtly change existing overall_conversation_score values

## Out of Scope
- LLM-based intent classification (Phase 7)
- Mapping intent to conversation flow routing decisions (Phase 6 signal events)
- Multi-language intent detection
- Intent tracking for bot messages (only user messages are assessed)

## Open Questions
- Should COMPOSITE_WEIGHTS rebalancing be a breaking change or should it be feature-flagged?
- Should intent categories (cooperating, rushing, deflecting, etc.) be exposed as a string classification alongside the numeric score, or is the numeric score sufficient?
