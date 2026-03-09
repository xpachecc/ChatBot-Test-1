import type { SignalAgentResult } from "./signal-types.js";
import type { SignalContext } from "./signal-types.js";
import { ENGAGEMENT_WEIGHTS } from "./signal-defaults.js";
import { extractEngagementFeatures } from "./extractors.js";
import { computeConfidence } from "./confidence.js";

/**
 * Heuristic-only engagement agent. No LLM calls.
 */
export async function runEngagementAgent(ctx: SignalContext): Promise<SignalAgentResult> {
  const features = extractEngagementFeatures(ctx);
  const score =
    features.followUpRatio * ENGAGEMENT_WEIGHTS.followUpRatio +
    features.elaborationDepth * ENGAGEMENT_WEIGHTS.elaborationDepth +
    features.backChanneling * ENGAGEMENT_WEIGHTS.backChanneling +
    features.topicContinuity * ENGAGEMENT_WEIGHTS.topicContinuity;
  const clamped = Math.max(0, Math.min(1, score));
  const confidence = computeConfidence(
    { followUpRatio: features.followUpRatio, elaborationDepth: features.elaborationDepth, backChanneling: features.backChanneling, topicContinuity: features.topicContinuity },
    ctx.userText.length
  );
  return {
    dimension: "engagement",
    score: clamped,
    confidence,
    source: "heuristic",
    timestamp: Date.now(),
  };
}
