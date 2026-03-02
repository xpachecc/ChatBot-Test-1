import type { SignalAgentResult } from "./signal-types.js";
import { ENGAGEMENT_WEIGHTS } from "./signal-defaults.js";
import { extractEngagementFeatures } from "./extractors.js";

/**
 * Heuristic-only engagement agent. No LLM calls.
 */
export async function runEngagementAgent(text: string): Promise<SignalAgentResult> {
  const features = extractEngagementFeatures(text);
  const score =
    features.followUpRatio * ENGAGEMENT_WEIGHTS.followUpRatio +
    features.elaborationDepth * ENGAGEMENT_WEIGHTS.elaborationDepth +
    features.backChanneling * ENGAGEMENT_WEIGHTS.backChanneling +
    features.topicContinuity * ENGAGEMENT_WEIGHTS.topicContinuity;
  const clamped = Math.max(0, Math.min(1, score));
  const confidence = 0.8;
  return {
    dimension: "engagement",
    score: clamped,
    confidence,
    source: "heuristic",
    timestamp: Date.now(),
  };
}
