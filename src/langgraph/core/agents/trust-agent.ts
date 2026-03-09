import type { SignalAgentResult } from "./signal-types.js";
import type { SignalContext } from "./signal-types.js";
import { TRUST_WEIGHTS } from "./signal-defaults.js";
import { extractTrustFeatures } from "./extractors.js";
import { computeConfidence } from "./confidence.js";

/**
 * Heuristic-only trust agent. No LLM calls.
 */
export async function runTrustAgent(ctx: SignalContext): Promise<SignalAgentResult> {
  const features = extractTrustFeatures(ctx);
  const score =
    features.pronounShift * TRUST_WEIGHTS.pronounShift +
    features.vulnerabilityTransparency * TRUST_WEIGHTS.vulnerabilityTransparency +
    features.specificityDetail * TRUST_WEIGHTS.specificityDetail +
    features.consistencyAlignment * TRUST_WEIGHTS.consistencyAlignment;
  const clamped = Math.max(0, Math.min(1, score));
  const confidence = computeConfidence(
    { pronounShift: features.pronounShift, vulnerabilityTransparency: features.vulnerabilityTransparency, specificityDetail: features.specificityDetail, consistencyAlignment: features.consistencyAlignment },
    ctx.userText.length
  );
  return {
    dimension: "trust",
    score: clamped,
    confidence,
    source: "heuristic",
    timestamp: Date.now(),
  };
}
