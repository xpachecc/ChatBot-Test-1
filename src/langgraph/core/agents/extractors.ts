import { detectSentiment } from "../helpers/sentiment.js";

/** Engagement feature scores (0–1). */
export interface EngagementFeatures {
  followUpRatio: number;
  elaborationDepth: number;
  backChanneling: number;
  topicContinuity: number;
}

/** Sentiment feature scores (0–1). */
export interface SentimentFeatures {
  baseValence: number;
  intensifierMagnitude: number;
  pivotClause: number;
  futureOrientation: number;
}

/** Trust feature scores (0–1). */
export interface TrustFeatures {
  pronounShift: number;
  vulnerabilityTransparency: number;
  specificityDetail: number;
  consistencyAlignment: number;
}

const FOLLOW_UP_PATTERNS = /\b(what next|how does|can you explain|tell me more|why is that|could you clarify)\b|\?/gi;
const BACK_CHANNEL_PATTERNS = /\b(i see|makes sense|got it|understood|okay|sure|right)\b/gi;
const INTENSIFIER_PATTERNS = /\b(very|extremely|exceptionally|really|absolutely|incredibly)\b/gi;
const PIVOT_PATTERNS = /\b(but|however|though|although)\b/gi;
const FUTURE_ORIENTED_PATTERNS = /\b(we will|when we implement|going to|plan to|will help)\b/gi;
const COLLABORATIVE_PRONOUNS = /\b(we|us|our|together)\b/gi;
const VULNERABILITY_PATTERNS = /\b(we failed|lesson learned|mistake|challenge|struggled)\b/gi;
const SPECIFICITY_PATTERNS = /\b(\d+%|\d+\.\d+|\d+ users|\d+ teams)\b|\b(specific|concrete|exactly|precisely)\b/gi;

/**
 * Extract engagement-related features from user text.
 */
export function extractEngagementFeatures(text: string): EngagementFeatures {
  const lower = text.trim().toLowerCase();
  const len = lower.length;

  const followUpMatches = lower.match(FOLLOW_UP_PATTERNS) ?? [];
  const followUpRatio = Math.min(1, followUpMatches.length * 0.5);

  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const clauseCount = (lower.match(/[,;]| and | because | so /g) ?? []).length + 1;
  const elaborationDepth = len < 10 ? 0 : Math.min(1, (wordCount / 50) * 0.6 + (clauseCount / 4) * 0.4);

  const backChannelMatches = lower.match(BACK_CHANNEL_PATTERNS) ?? [];
  const backChanneling = Math.min(1, backChannelMatches.length * 0.4);

  const topicContinuity = len < 5 ? 0.5 : Math.min(1, 0.5 + wordCount / 80);
  return {
    followUpRatio,
    elaborationDepth,
    backChanneling,
    topicContinuity,
  };
}

/**
 * Extract sentiment-related features from user text.
 */
export function extractSentimentFeatures(text: string): SentimentFeatures {
  const lower = text.trim().toLowerCase();
  const sentiment = detectSentiment(text);
  const baseValence = sentiment === "positive" ? 1 : sentiment === "concerned" ? 0.2 : 0.5;

  const intensifierMatches = lower.match(INTENSIFIER_PATTERNS) ?? [];
  const intensifierMagnitude = Math.min(1, intensifierMatches.length * 0.3);

  const pivotMatches = lower.match(PIVOT_PATTERNS) ?? [];
  const pivotClause = pivotMatches.length > 0 ? 0.6 : 0.5;

  const futureMatches = lower.match(FUTURE_ORIENTED_PATTERNS) ?? [];
  const futureOrientation = Math.min(1, 0.4 + futureMatches.length * 0.2);
  return {
    baseValence,
    intensifierMagnitude,
    pivotClause,
    futureOrientation,
  };
}

/**
 * Extract trust-related features from user text.
 */
export function extractTrustFeatures(text: string): TrustFeatures {
  const lower = text.trim().toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  const pronounMatches = lower.match(COLLABORATIVE_PRONOUNS) ?? [];
  const pronounShift = wordCount < 5 ? 0.5 : Math.min(1, 0.3 + pronounMatches.length * 0.2);

  const vulnMatches = lower.match(VULNERABILITY_PATTERNS) ?? [];
  const vulnerabilityTransparency = Math.min(1, vulnMatches.length * 0.4);

  const specMatches = lower.match(SPECIFICITY_PATTERNS) ?? [];
  const specificityDetail = Math.min(1, 0.2 + specMatches.length * 0.2);

  const consistencyTerms = /\b(agree|align|makes sense|exactly right)\b/gi;
  const consistencyMatches = lower.match(consistencyTerms) ?? [];
  const consistencyAlignment = Math.min(1, 0.4 + consistencyMatches.length * 0.2);
  return {
    pronounShift,
    vulnerabilityTransparency,
    specificityDetail,
    consistencyAlignment,
  };
}
