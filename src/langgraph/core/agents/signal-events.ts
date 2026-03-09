import type { SignalTurnRecord, SignalEvent, SignalAction } from "./signal-types.js";

type CurrentScores = { engagement: number; sentiment: number; trust: number; intent: number };

function getEngagement(r: SignalTurnRecord): number {
  return typeof (r as { engagement?: number }).engagement === "number" ? (r as { engagement: number }).engagement : 0.5;
}
function getSentiment(r: SignalTurnRecord): number {
  return typeof (r as { sentiment?: number }).sentiment === "number" ? (r as { sentiment: number }).sentiment : 0.5;
}
function getTrust(r: SignalTurnRecord): number {
  return typeof (r as { trust?: number }).trust === "number" ? (r as { trust: number }).trust : 0.5;
}
function getIntent(r: SignalTurnRecord): number {
  return typeof (r as { intent?: number }).intent === "number" ? (r as { intent: number }).intent : 0.5;
}

export function detectSignalEvents(history: SignalTurnRecord[], current: CurrentScores): SignalEvent[] {
  const events: SignalEvent[] = [];
  const ts = Date.now();

  if (history.length >= 3) {
    const e0 = getEngagement(history[history.length - 3]);
    const e1 = getEngagement(history[history.length - 2]);
    const e2 = getEngagement(history[history.length - 1]);
    if (e0 > e1 && e1 > e2) {
      events.push({ type: "engagement_declining", timestamp: ts, details: { consecutiveDrops: 3, fromScore: e0, toScore: e2 } });
    }
  }

  if (history.length >= 2) {
    const prevSent = getSentiment(history[history.length - 2]);
    const currSent = current.sentiment;
    if (prevSent > 0.6 && currSent < 0.3) {
      events.push({ type: "sentiment_shift_negative", timestamp: ts, details: { previousScore: prevSent, currentScore: currSent } });
    }
    if (prevSent < 0.3 && currSent > 0.6) {
      events.push({ type: "sentiment_recovery", timestamp: ts, details: { previousScore: prevSent, currentScore: currSent } });
    }

    const i0 = getIntent(history[history.length - 2]);
    const i1 = getIntent(history[history.length - 1]);
    if (i0 < 0.4 && i1 < 0.4) {
      events.push({ type: "user_rushing", timestamp: ts, details: { consecutiveTurns: 2, avgIntentScore: (i0 + i1) / 2 } });
    }
  }

  if (current.trust > 0.85) {
    events.push({ type: "high_trust_moment", timestamp: ts, details: { trustScore: current.trust } });
  }

  return events;
}

const EVENT_TO_ACTIONS: Record<string, { type: string; priority: "low" | "medium" | "high" }[]> = {
  engagement_declining: [{ type: "slow_down_pacing", priority: "medium" }],
  sentiment_shift_negative: [{ type: "increase_empathy", priority: "high" }],
  user_rushing: [{ type: "skip_optional_questions", priority: "medium" }],
  high_trust_moment: [],
  sentiment_recovery: [],
};

export function suggestSignalActions(events: SignalEvent[]): SignalAction[] {
  const seen = new Set<string>();
  const actions: SignalAction[] = [];
  for (const e of events) {
    const configs = EVENT_TO_ACTIONS[e.type] ?? [];
    for (const c of configs) {
      if (!seen.has(c.type)) {
        seen.add(c.type);
        actions.push({ type: c.type, priority: c.priority, reason: `${e.type} detected` });
      }
    }
  }
  return actions;
}
