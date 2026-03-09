import type { CfsState } from "../../state.js";
import type { SignalAgentResult, SignalOrchestratorResult, SignalTurnRecord } from "./signal-types.js";
import {
  COMPOSITE_WEIGHTS,
  EMA_ALPHA,
  EVENTS_LIMIT,
  HISTORY_LIMIT,
  DEFAULT_TTL_MS,
} from "./signal-defaults.js";
import { buildSignalContext } from "./signal-context.js";
import { runEngagementAgent } from "./engagement-agent.js";
import { runSentimentAgent } from "./sentiment-agent.js";
import { runTrustAgent } from "./trust-agent.js";
import { runIntentAgent } from "./intent-agent.js";
import { detectSignalEvents, suggestSignalActions } from "./signal-events.js";
import { runLlmSignalAgent } from "./llm-signal-agent.js";

export type SignalAgentConfig = { enabled: boolean; ttlMs: number; llmEnabled?: boolean };

/**
 * Run all signal agents in parallel, enforce TTL, aggregate results with EMA.
 * Returns null on error or when nodeSignalAgents is false.
 */
export async function runSignalOrchestrator(
  userText: string,
  state: CfsState,
  config: SignalAgentConfig,
  nodeSignalAgents?: boolean
): Promise<SignalOrchestratorResult | null> {
  if (nodeSignalAgents === false) return null;
  if (!config.enabled) return null;
  if (!userText?.trim()) return null;

  try {
    const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    const rc = state.relationship_context ?? {};

    const ctx = buildSignalContext(state, userText);
    const llmEnabled = config.llmEnabled === true;

    const runHeuristics = (): Promise<SignalAgentResult[]> =>
      Promise.all([runEngagementAgent(ctx), runSentimentAgent(ctx), runTrustAgent(ctx), runIntentAgent(ctx)]);

    const heuristicResults = await runHeuristics();
    const llmResults = llmEnabled
      ? await Promise.race([
          runLlmSignalAgent(ctx),
          new Promise<SignalAgentResult[] | null>((r) => setTimeout(() => r(null), ttlMs - 50)),
        ])
      : null;

    const raw = llmResults && llmResults.length === 4 ? llmResults : heuristicResults;
    if (!raw || raw.length === 0) return null;

    const engagement = raw.find((r) => r.dimension === "engagement")?.score ?? 0.5;
    const sentiment = raw.find((r) => r.dimension === "sentiment")?.score ?? 0.5;
    const trust = raw.find((r) => r.dimension === "trust")?.score ?? 0.5;
    const intent = raw.find((r) => r.dimension === "intent")?.score ?? 0.5;
    const avgConfidence = raw.reduce((sum, r) => sum + r.confidence, 0) / (raw.length || 1);
    const effectiveAlpha = EMA_ALPHA * avgConfidence;

    const prevEng = typeof rc.engagement_score === "number" ? rc.engagement_score : 0.5;
    const prevSent = typeof rc.sentiment_score === "number" ? rc.sentiment_score : 0.5;
    const prevTrust = typeof rc.trust_score === "number" ? rc.trust_score : 0.5;
    const prevIntent = typeof (rc as { intent_score?: number }).intent_score === "number" ? (rc as { intent_score: number }).intent_score : 0.5;

    const engagement_score = effectiveAlpha * engagement + (1 - effectiveAlpha) * prevEng;
    const sentiment_score = effectiveAlpha * sentiment + (1 - effectiveAlpha) * prevSent;
    const trust_score = effectiveAlpha * trust + (1 - effectiveAlpha) * prevTrust;
    const intent_score = effectiveAlpha * intent + (1 - effectiveAlpha) * prevIntent;

    const overall_conversation_score =
      engagement_score * COMPOSITE_WEIGHTS.engagement +
      sentiment_score * COMPOSITE_WEIGHTS.sentiment +
      trust_score * COMPOSITE_WEIGHTS.trust +
      intent_score * COMPOSITE_WEIGHTS.intent;

    const turn_count = (typeof rc.turn_count === "number" ? rc.turn_count : 0) + 1;
    const timestamp = Date.now();

    const record: SignalTurnRecord = {
      turn_index: turn_count - 1,
      timestamp,
      engagement,
      sentiment,
      trust,
      intent,
      confidence: avgConfidence,
      source: "heuristic",
    };

    const prevHistory = Array.isArray(rc.signal_history) ? rc.signal_history : [];
    const signal_history = [...prevHistory, record].slice(-HISTORY_LIMIT);

    const currentScores = { engagement, sentiment, trust, intent };
    const currentEvents = detectSignalEvents(signal_history, currentScores);
    const currentActions = suggestSignalActions(currentEvents);

    const prevEvents = Array.isArray(rc.signal_events) ? rc.signal_events : [];
    const prevActions = Array.isArray(rc.signal_actions) ? rc.signal_actions : [];
    const signal_events = [...prevEvents, ...currentEvents].slice(-EVENTS_LIMIT);
    const signal_actions = [...prevActions, ...currentActions].slice(-EVENTS_LIMIT);

    const result: SignalOrchestratorResult = {
      engagement_score: Math.max(0, Math.min(1, engagement_score)),
      sentiment_score: Math.max(0, Math.min(1, sentiment_score)),
      trust_score: Math.max(0, Math.min(1, trust_score)),
      intent_score: Math.max(0, Math.min(1, intent_score)),
      overall_conversation_score: Math.max(0, Math.min(1, overall_conversation_score)),
      turn_count,
      signal_history,
      signal_events,
      signal_actions,
      last_signal_timestamp: timestamp,
    };

    return result;
  } catch {
    return null;
  }
}
