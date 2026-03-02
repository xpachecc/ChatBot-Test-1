import type { CfsState } from "../../state.js";
import type { SignalAgentResult, SignalOrchestratorResult, SignalTurnRecord } from "./signal-types.js";
import {
  COMPOSITE_WEIGHTS,
  EMA_ALPHA,
  HISTORY_LIMIT,
  DEFAULT_TTL_MS,
} from "./signal-defaults.js";
import { runEngagementAgent } from "./engagement-agent.js";
import { runSentimentAgent } from "./sentiment-agent.js";
import { runTrustAgent } from "./trust-agent.js";

export type SignalAgentConfig = { enabled: boolean; ttlMs: number };

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

    const runWithTimeout = (): Promise<SignalAgentResult[] | null> =>
      Promise.race([
        Promise.allSettled([
          runEngagementAgent(userText),
          runSentimentAgent(userText),
          runTrustAgent(userText),
        ]).then((settled) => {
          const results: SignalAgentResult[] = [];
          for (const s of settled) {
            if (s.status === "fulfilled" && s.value) results.push(s.value);
          }
          return results;
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ttlMs)),
      ]).then((out) => (Array.isArray(out) ? out : null));

    const raw = await runWithTimeout();
    if (!raw || raw.length === 0) return null;

    const engagement = raw.find((r) => r.dimension === "engagement")?.score ?? 0.5;
    const sentiment = raw.find((r) => r.dimension === "sentiment")?.score ?? 0.5;
    const trust = raw.find((r) => r.dimension === "trust")?.score ?? 0.5;
    const confidence =
      raw.reduce((sum, r) => sum + r.confidence, 0) / (raw.length || 1);

    const prevEng = typeof rc.engagement_score === "number" ? rc.engagement_score : 0.5;
    const prevSent = typeof rc.sentiment_score === "number" ? rc.sentiment_score : 0.5;
    const prevTrust = typeof rc.trust_score === "number" ? rc.trust_score : 0.5;

    const engagement_score = EMA_ALPHA * engagement + (1 - EMA_ALPHA) * prevEng;
    const sentiment_score = EMA_ALPHA * sentiment + (1 - EMA_ALPHA) * prevSent;
    const trust_score = EMA_ALPHA * trust + (1 - EMA_ALPHA) * prevTrust;

    const overall_conversation_score =
      engagement_score * COMPOSITE_WEIGHTS.engagement +
      sentiment_score * COMPOSITE_WEIGHTS.sentiment +
      trust_score * COMPOSITE_WEIGHTS.trust;

    const turn_count = (typeof rc.turn_count === "number" ? rc.turn_count : 0) + 1;
    const timestamp = Date.now();

    const record: SignalTurnRecord = {
      turn_index: turn_count - 1,
      timestamp,
      engagement,
      sentiment,
      trust,
      confidence,
      source: "heuristic",
    };

    const prevHistory = Array.isArray(rc.signal_history) ? rc.signal_history : [];
    const signal_history = [...prevHistory, record].slice(-HISTORY_LIMIT);

    const signal_events = Array.isArray(rc.signal_events) ? rc.signal_events : [];
    const signal_actions = Array.isArray(rc.signal_actions) ? rc.signal_actions : [];

    const result: SignalOrchestratorResult = {
      engagement_score: Math.max(0, Math.min(1, engagement_score)),
      sentiment_score: Math.max(0, Math.min(1, sentiment_score)),
      trust_score: Math.max(0, Math.min(1, trust_score)),
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
