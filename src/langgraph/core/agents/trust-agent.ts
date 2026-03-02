import type { SignalAgentResult } from "./signal-types.js";
import { TRUST_WEIGHTS } from "./signal-defaults.js";
import { extractTrustFeatures } from "./extractors.js";

/**
 * Heuristic-only trust agent. No LLM calls.
 */
export async function runTrustAgent(text: string): Promise<SignalAgentResult> {
  const features = extractTrustFeatures(text);
  const score =
    features.pronounShift * TRUST_WEIGHTS.pronounShift +
    features.vulnerabilityTransparency * TRUST_WEIGHTS.vulnerabilityTransparency +
    features.specificityDetail * TRUST_WEIGHTS.specificityDetail +
    features.consistencyAlignment * TRUST_WEIGHTS.consistencyAlignment;
  const clamped = Math.max(0, Math.min(1, score));
  const confidence = 0.8;
  return {
    dimension: "trust",
    score: clamped,
    confidence,
    source: "heuristic",
    timestamp: Date.now(),
  };
}
