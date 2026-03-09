import type { SignalAgentResult } from "./signal-types.js";
import type { SignalContext } from "./signal-types.js";
import { SENTIMENT_WEIGHTS } from "./signal-defaults.js";
import { extractSentimentFeatures } from "./extractors.js";
import { computeConfidence } from "./confidence.js";

/**
 * Heuristic-only sentiment agent. Uses existing detectSentiment().
 * No LLM calls.
 */
export async function runSentimentAgent(ctx: SignalContext): Promise<SignalAgentResult> {
  const features = extractSentimentFeatures(ctx);
  const score =
    features.baseValence * SENTIMENT_WEIGHTS.baseValence +
    features.intensifierMagnitude * SENTIMENT_WEIGHTS.intensifierMagnitude +
    features.pivotClause * SENTIMENT_WEIGHTS.pivotClause +
    features.futureOrientation * SENTIMENT_WEIGHTS.futureOrientation;
  const clamped = Math.max(0, Math.min(1, score));
  const confidence = computeConfidence(
    { baseValence: features.baseValence, intensifierMagnitude: features.intensifierMagnitude, pivotClause: features.pivotClause, futureOrientation: features.futureOrientation },
    ctx.userText.length
  );
  return {
    dimension: "sentiment",
    score: clamped,
    confidence,
    source: "heuristic",
    timestamp: Date.now(),
  };
}
