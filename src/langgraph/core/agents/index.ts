export { runSignalOrchestrator, type SignalAgentConfig } from "./signal-orchestrator.js";
export type {
  SignalAgentResult,
  SignalTurnRecord,
  SignalOrchestratorResult,
} from "./signal-types.js";
export {
  COMPOSITE_WEIGHTS,
  EMA_ALPHA,
  HISTORY_LIMIT,
  DEFAULT_TTL_MS,
  ENGAGEMENT_WEIGHTS,
  SENTIMENT_WEIGHTS,
  TRUST_WEIGHTS,
} from "./signal-defaults.js";
export { runEngagementAgent } from "./engagement-agent.js";
export { runSentimentAgent } from "./sentiment-agent.js";
export { runTrustAgent } from "./trust-agent.js";
export {
  extractEngagementFeatures,
  extractSentimentFeatures,
  extractTrustFeatures,
  type EngagementFeatures,
  type SentimentFeatures,
  type TrustFeatures,
} from "./extractors.js";
