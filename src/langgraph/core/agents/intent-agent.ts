import type { SignalAgentResult } from "./signal-types.js";
import type { SignalContext } from "./signal-types.js";
import { INTENT_WEIGHTS } from "./signal-defaults.js";
import { extractIntentFeatures } from "./extractors.js";
import { computeConfidence } from "./confidence.js";

/**
 * Heuristic-only intent agent. No LLM calls.
 * Scores cooperative vs. disengaged intent.
 */
export async function runIntentAgent(ctx: SignalContext): Promise<SignalAgentResult> {
  const features = extractIntentFeatures(ctx);
  const score =
    features.cooperationSignal * INTENT_WEIGHTS.cooperationSignal +
    (1 - features.rushingSignal) * INTENT_WEIGHTS.rushingSignal +
    (1 - features.deflectionSignal) * INTENT_WEIGHTS.deflectionSignal +
    features.challengeSignal * INTENT_WEIGHTS.challengeSignal +
    (1 - features.confusionSignal) * INTENT_WEIGHTS.confusionSignal;
  const clamped = Math.max(0, Math.min(1, score));
  const confidence = computeConfidence(
    { cooperationSignal: features.cooperationSignal, rushingSignal: features.rushingSignal, deflectionSignal: features.deflectionSignal, challengeSignal: features.challengeSignal, confusionSignal: features.confusionSignal },
    ctx.userText.length
  );
  return {
    dimension: "intent",
    score: clamped,
    confidence,
    source: "heuristic",
    timestamp: Date.now(),
  };
}
