/**
 * Centralized scoring configuration for signal agents.
 * All tunable weights, alpha, and composite ratios live here.
 * YAML config only exposes enabled + ttlMs.
 */

// Composite weights: how each dimension contributes to overall_conversation_score
export const COMPOSITE_WEIGHTS = { engagement: 0.3, sentiment: 0.25, trust: 0.25, intent: 0.2 };

// EMA smoothing factor (higher = more weight on latest turn)
export const EMA_ALPHA = 0.25;

// Max signal_history entries retained
export const HISTORY_LIMIT = 20;

// Max signal_events and signal_actions entries retained (cumulative across turns)
export const EVENTS_LIMIT = 50;

// Engagement feature weights
export const ENGAGEMENT_WEIGHTS = {
  followUpRatio: 0.35,
  elaborationDepth: 0.4,
  backChanneling: 0.15,
  topicContinuity: 0.1,
};

// Sentiment feature weights
export const SENTIMENT_WEIGHTS = {
  baseValence: 0.4,
  intensifierMagnitude: 0.2,
  pivotClause: 0.25,
  futureOrientation: 0.15,
};

// Trust feature weights
export const TRUST_WEIGHTS = {
  pronounShift: 0.35,
  vulnerabilityTransparency: 0.3,
  specificityDetail: 0.2,
  consistencyAlignment: 0.15,
};

// Intent feature weights
export const INTENT_WEIGHTS = {
  cooperationSignal: 0.35,
  rushingSignal: 0.25,
  deflectionSignal: 0.2,
  challengeSignal: 0.1,
  confusionSignal: 0.1,
};

// Default TTL for orchestrator timeout (overridden by YAML config if set)
export const DEFAULT_TTL_MS = 1000;
