import type { SignalContext } from "./signal-types.js";
import { computeValence } from "../helpers/sentiment.js";

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

/** Intent feature scores (0–1). */
export interface IntentFeatures {
  cooperationSignal: number;
  rushingSignal: number;
  deflectionSignal: number;
  challengeSignal: number;
  confusionSignal: number;
}

const FOLLOW_UP_PATTERNS = /\b(what next|how does|can you explain|tell me more|why is that|could you clarify)\b|\?/gi;
const BACK_CHANNEL_PATTERNS = /\b(i see|makes sense|got it|understood|okay|sure|right)\b/gi;
const INTENSIFIER_PATTERNS = /\b(very|extremely|exceptionally|really|absolutely|incredibly)\b/gi;
const PIVOT_PATTERNS = /\b(but|however|though|although)\b/gi;
const FUTURE_ORIENTED_PATTERNS = /\b(we will|when we implement|going to|plan to|will help)\b/gi;
const COLLABORATIVE_PRONOUNS = /\b(we|us|our|together)\b/gi;
const VULNERABILITY_PATTERNS = /\b(we failed|lesson learned|mistake|challenge|struggled)\b/gi;
const SPECIFICITY_PATTERNS = /\b(\d+%|\d+\.\d+|\d+ users|\d+ teams)\b|\b(specific|concrete|exactly|precisely)\b/gi;
const COOPERATION_PATTERNS = /\b(we're looking|we need|we want|our team|together|let's|we should)\b/gi;
const RUSHING_PATTERNS = /\b(whatever|sure whatever|that's fine|fine|ok|okay|whatever works)\b/gi;
const DEFLECTION_PATTERNS = /\b(team decision|someone else|i'd have to check|that's more of a|not my area)\b/gi;
const CHALLENGE_PATTERNS = /\b(how is this different|what about|how does that|why would|compared to)\b/gi;
const CONFUSION_PATTERNS = /\b(not sure what|don't understand|could you clarify|what do you mean|i'm confused)\b/gi;

/**
 * Extract engagement-related features from user text.
 * When ctx.questionPurpose is "confirm" or "select", short responses are not penalized.
 */
export function extractEngagementFeatures(ctx: SignalContext | string): EngagementFeatures {
  const text = typeof ctx === "string" ? ctx : ctx.userText;
  const questionPurpose = typeof ctx === "string" ? null : ctx.questionPurpose;
  const lower = text.trim().toLowerCase();
  const len = lower.length;

  const followUpMatches = lower.match(FOLLOW_UP_PATTERNS) ?? [];
  const followUpRatio = Math.min(1, followUpMatches.length * 0.5);

  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const clauseCount = (lower.match(/[,;]| and | because | so /g) ?? []).length + 1;
  let elaborationDepth = len < 10 ? 0 : Math.min(1, (wordCount / 50) * 0.6 + (clauseCount / 4) * 0.4);
  if ((questionPurpose === "confirm" || questionPurpose === "select") && wordCount < 10) {
    elaborationDepth = Math.max(elaborationDepth, 0.5);
  }

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
export function extractSentimentFeatures(ctx: SignalContext | string): SentimentFeatures {
  const text = typeof ctx === "string" ? ctx : ctx.userText;
  const lower = text.trim().toLowerCase();
  const valence = computeValence(text);
  const baseValence = (valence + 1) / 2;

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
export function extractTrustFeatures(ctx: SignalContext | string): TrustFeatures {
  const text = typeof ctx === "string" ? ctx : ctx.userText;
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

/**
 * Extract intent-related features from user text.
 * Uses questionPurpose for response-length expectations (short answer to open question = rushing).
 */
export function extractIntentFeatures(ctx: SignalContext | string): IntentFeatures {
  const text = typeof ctx === "string" ? ctx : ctx.userText;
  const questionPurpose = typeof ctx === "string" ? null : ctx.questionPurpose;
  const lastBotMessage = typeof ctx === "string" ? null : ctx.lastBotMessage;
  const lower = text.trim().toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const botWordCount = lastBotMessage ? lastBotMessage.split(/\s+/).filter(Boolean).length : 50;

  const coopMatches = lower.match(COOPERATION_PATTERNS) ?? [];
  const cooperationSignal = Math.min(1, 0.3 + coopMatches.length * 0.25);

  const rushMatches = lower.match(RUSHING_PATTERNS) ?? [];
  let rushingSignal = Math.min(1, rushMatches.length * 0.5);
  if (questionPurpose !== "confirm" && questionPurpose !== "select" && wordCount < 5 && botWordCount > 20) {
    rushingSignal = Math.max(rushingSignal, 0.5);
  }

  const deflectMatches = lower.match(DEFLECTION_PATTERNS) ?? [];
  const deflectionSignal = Math.min(1, deflectMatches.length * 0.5);

  const challengeMatches = lower.match(CHALLENGE_PATTERNS) ?? [];
  const challengeSignal = Math.min(1, 0.2 + challengeMatches.length * 0.3);

  const confusionMatches = lower.match(CONFUSION_PATTERNS) ?? [];
  const confusionSignal = Math.min(1, confusionMatches.length * 0.5);

  return {
    cooperationSignal,
    rushingSignal,
    deflectionSignal,
    challengeSignal,
    confusionSignal,
  };
}
