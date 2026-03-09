# Spec for Signal Dynamic Confidence

feature_slug: signal-dynamic-confidence

## Intent and Desired Outcomes
- Business intent: Replace the hardcoded confidence value (0.8) in all signal agents with a computed score that reflects how much evidence the analysis has to work with, making EMA-smoothed cumulative scores more reliable by weighting high-evidence turns more heavily.
- User problem: All turns are currently treated with equal confidence regardless of input quality. A single "ok" is weighted the same as a multi-paragraph response in the EMA, producing noisy cumulative scores that don't reflect actual signal strength.
- Desired outcomes:
  - Confidence is computed per agent based on text length, pattern density, and feature agreement
  - The EMA smoothing in the orchestrator weights turns proportionally to their confidence
  - Low-confidence turns (short, ambiguous inputs) have less influence on cumulative scores
- Success metrics (observable):
  - A 2-word response produces lower confidence than a 50-word response
  - A response where all features agree (all high or all low) produces higher confidence than one with conflicting features
  - Consecutive low-confidence turns shift cumulative scores less than consecutive high-confidence turns

## Summary
Every signal agent currently returns a fixed `confidence: 0.8` regardless of input characteristics. This phase introduces a `computeConfidence` utility that derives confidence from text length (more text = more evidence), pattern match density (more matches = stronger signal), and feature agreement (features pointing in the same direction = less ambiguity). The EMA formula in the orchestrator is updated to weight the smoothing factor by confidence, so high-evidence turns have more influence on running scores.

## Scenario Coverage

### Primary Success Scenario
- Given a user provides a detailed 60-word response with multiple follow-up questions and elaboration
- When the engagement agent computes confidence
- Then confidence is high (e.g., 0.85–0.95) because text length is substantial and features are concordant

### Variation Scenarios
- Scenario A: User sends "ok" (2 characters, no patterns match) -> confidence is low (e.g., 0.3–0.4).
- Scenario B: User sends a message with conflicting signals (positive words + pivot clauses + hedging) -> confidence is moderate because features disagree.
- Scenario C: User sends a long message but with no recognizable patterns -> confidence is moderate (length provides evidence, but no features fired).

### Failure / Edge Scenarios
- Scenario E1: Empty or whitespace-only text -> confidence is 0 or near-0; orchestrator has already-existing null/empty guard.
- Scenario E2: Extremely long text (1000+ words) -> confidence is capped at 1.0.

## Functional Requirements
- FR-1: The system should provide `computeConfidence(features: Record<string, number>, textLength: number): number` returning a value in [0, 1].
- FR-2: Confidence should increase with text length (more text = more evidence), following a logarithmic or asymptotic curve capped at 1.0.
- FR-3: Confidence should increase with pattern density (number of non-zero features / total features).
- FR-4: Confidence should increase with feature agreement (low variance among feature values = less ambiguity).
- FR-5: All four agents (engagement, sentiment, trust, intent) should call `computeConfidence` instead of returning 0.8.
- FR-6: The orchestrator's EMA formula should incorporate confidence: `effectiveAlpha = EMA_ALPHA * avgConfidence`, so low-confidence turns shift scores less.
- FR-7: The `confidence` field in `SignalTurnRecord` should reflect the computed value (no schema change needed — field already exists).
- FR-8: The system should not change confidence semantics for the `SignalAgentResult` type (still 0–1, still per-agent).

## Possible Edge Cases
- All features are exactly 0 (no patterns found) — confidence should be low, not zero (text length still provides some evidence)
- All features are exactly 1 (maximum matches) — confidence should be high
- One feature is 1.0 and all others are 0 — high variance, lower confidence despite one strong signal
- Text is entirely numeric or special characters (low natural language content)

## Acceptance Criteria
- AC-1: 2-word input produces lower confidence than 50-word input (same content type) -> pass
- AC-2: Input with all features > 0.5 produces higher confidence than input with features split 0.9/0.1/0.8/0.0 -> pass
- AC-3: EMA shift from a low-confidence turn is smaller than EMA shift from a high-confidence turn with the same raw score -> pass
- AC-4: Confidence values are always in [0, 1] -> pass
- AC-5: Existing score clamping and boundary behavior is preserved -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success -> "long detailed text produces high confidence"
  - Variation A -> "very short text produces low confidence"
  - Variation B -> "conflicting features produce moderate confidence"
  - Edge: all-zero features -> "low but non-zero confidence from text length"
- Acceptance traceability:
  - AC-1 -> Unit test: `computeConfidence` with short vs. long text
  - AC-2 -> Unit test: `computeConfidence` with concordant vs. discordant features
  - AC-3 -> Orchestrator test: two turns with same raw score but different confidence; verify different EMA outcomes
  - AC-4 -> Unit test: boundary values (empty text, max-length text)
  - AC-5 -> Regression: existing fixture suite produces valid bounded scores
- Regression checks:
  - All agent tests produce valid results (scores still in [0, 1])
  - Orchestrator aggregation produces valid cumulative scores
  - Signal history records have confidence values in valid range

## Dependencies and Constraints
- Dependencies:
  - Phase 2 (conversation context) should be complete so confidence can incorporate context richness
  - All four agents must exist (Phase 3 intent agent) before applying confidence uniformly
- Constraints:
  - Must not change the `SignalTurnRecord` or `SignalAgentResult` schemas (confidence field already exists)
  - `computeConfidence` must be deterministic and fast (pure math, no I/O)
  - The EMA formula change must be backward-compatible: when confidence = 0.8, behavior should approximate the current fixed-alpha behavior

## Out of Scope
- LLM-derived confidence (Phase 7 may assign its own confidence)
- Per-feature confidence (only aggregate confidence per agent)
- Historical confidence trending (confidence is per-turn, not cumulative)

## Open Questions
- Should the confidence formula weight text length vs. feature agreement equally, or should one dominate?
- When confidence is very low (e.g., < 0.2), should the EMA skip the turn entirely or apply a minimal shift?
