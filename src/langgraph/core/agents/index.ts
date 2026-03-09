export { runSignalOrchestrator, type SignalAgentConfig } from "./signal-orchestrator.js";
export type {
  SignalAgentResult,
  SignalTurnRecord,
  SignalOrchestratorResult,
  SignalContext,
} from "./signal-types.js";
export { buildSignalContext } from "./signal-context.js";
export {
  COMPOSITE_WEIGHTS,
  EMA_ALPHA,
  HISTORY_LIMIT,
  DEFAULT_TTL_MS,
  ENGAGEMENT_WEIGHTS,
  SENTIMENT_WEIGHTS,
  TRUST_WEIGHTS,
  INTENT_WEIGHTS,
} from "./signal-defaults.js";
export { runEngagementAgent } from "./engagement-agent.js";
export { runSentimentAgent } from "./sentiment-agent.js";
export { runTrustAgent } from "./trust-agent.js";
export { runIntentAgent } from "./intent-agent.js";
export {
  extractEngagementFeatures,
  extractSentimentFeatures,
  extractTrustFeatures,
  extractIntentFeatures,
  type EngagementFeatures,
  type SentimentFeatures,
  type TrustFeatures,
  type IntentFeatures,
} from "./extractors.js";
