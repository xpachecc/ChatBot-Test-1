import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  extractEngagementFeatures,
  extractSentimentFeatures,
  extractTrustFeatures,
  extractIntentFeatures,
} from "../core/agents/extractors.js";
import { runEngagementAgent, runSentimentAgent, runTrustAgent, runIntentAgent } from "../core/agents/index.js";
import { runSignalOrchestrator } from "../core/agents/index.js";
import { buildSignalContext } from "../core/agents/signal-context.js";
import { getPendingSignal, setPendingSignal, clearPendingSignal, clearAllPendingSignals } from "../core/agents/signal-store.js";
import { computeConfidence } from "../core/agents/confidence.js";
import { computeValence, detectSentiment } from "../core/helpers/sentiment.js";
import { detectSignalEvents, suggestSignalActions } from "../core/agents/signal-events.js";
import { EVENTS_LIMIT } from "../core/agents/signal-defaults.js";
import { runLlmSignalAgent } from "../core/agents/llm-signal-agent.js";
import { CfsStateSchema } from "../state.js";
import { createInitialState } from "../core/helpers/state.js";

// ── Signal Store ───────────────────────────────────────────────────────

const mockSignalResult = {
  engagement_score: 0.7,
  sentiment_score: 0.8,
  trust_score: 0.6,
  intent_score: 0.7,
  overall_conversation_score: 0.7,
  turn_count: 1,
  signal_history: [],
  signal_events: [],
  signal_actions: [],
  last_signal_timestamp: Date.now(),
};

describe("signal store", () => {
  beforeEach(() => clearAllPendingSignals());

  it("getPendingSignal returns null when empty", () => {
    expect(getPendingSignal("s1")).toBeNull();
  });

  it("setPendingSignal and getPendingSignal round-trip", () => {
    setPendingSignal("s1", mockSignalResult);
    const got = getPendingSignal("s1");
    expect(got).not.toBeNull();
    expect(got!.engagement_score).toBe(0.7);
  });

  it("getPendingSignal consumes (deletes) the entry", () => {
    setPendingSignal("s1", mockSignalResult);
    expect(getPendingSignal("s1")).not.toBeNull();
    expect(getPendingSignal("s1")).toBeNull();
  });

  it("clearPendingSignal removes entry", () => {
    setPendingSignal("s1", mockSignalResult);
    clearPendingSignal("s1");
    expect(getPendingSignal("s1")).toBeNull();
  });

  it("isolates sessions", () => {
    setPendingSignal("s1", mockSignalResult);
    setPendingSignal("s2", { ...mockSignalResult, engagement_score: 0.3 });
    expect(getPendingSignal("s1")!.engagement_score).toBe(0.7);
    expect(getPendingSignal("s2")!.engagement_score).toBe(0.3);
  });
});

// ── Extractors ─────────────────────────────────────────────────────────

function ctx(text: string) {
  return buildSignalContext(createInitialState(), text);
}

describe("computeConfidence", () => {
  it("short text produces lower confidence than long text", () => {
    const features = { a: 0.5, b: 0.5 };
    const short = computeConfidence(features, 5);
    const long = computeConfidence(features, 100);
    expect(short).toBeLessThan(long);
  });

  it("concordant features produce higher confidence than discordant", () => {
    const concordant = computeConfidence({ a: 0.8, b: 0.9, c: 0.85 }, 50);
    const discordant = computeConfidence({ a: 0.9, b: 0.1, c: 0.8 }, 50);
    expect(concordant).toBeGreaterThan(discordant);
  });

  it("returns value in [0, 1]", () => {
    expect(computeConfidence({}, 0)).toBeGreaterThanOrEqual(0);
    expect(computeConfidence({}, 0)).toBeLessThanOrEqual(1);
    expect(computeConfidence({ a: 1, b: 1 }, 1000)).toBeLessThanOrEqual(1);
  });
});

describe("extractEngagementFeatures", () => {
  it("returns bounded feature scores", () => {
    const f = extractEngagementFeatures("What next? Can you explain how that works?");
    expect(f.followUpRatio).toBeGreaterThanOrEqual(0);
    expect(f.followUpRatio).toBeLessThanOrEqual(1);
    expect(f.elaborationDepth).toBeGreaterThanOrEqual(0);
    expect(f.elaborationDepth).toBeLessThanOrEqual(1);
    expect(f.backChanneling).toBeGreaterThanOrEqual(0);
    expect(f.backChanneling).toBeLessThanOrEqual(1);
    expect(f.topicContinuity).toBeGreaterThanOrEqual(0);
    expect(f.topicContinuity).toBeLessThanOrEqual(1);
  });

  it("detects follow-up patterns", () => {
    const withFollowUp = extractEngagementFeatures("What next? How does that work?");
    const without = extractEngagementFeatures("Yes");
    expect(withFollowUp.followUpRatio).toBeGreaterThan(without.followUpRatio);
  });

  it("detects back-channeling", () => {
    const withBackChannel = extractEngagementFeatures("I see, makes sense, got it");
    expect(withBackChannel.backChanneling).toBeGreaterThan(0);
  });

  it("short affirmative to confirm question scores higher engagement than to open question", () => {
    const stateConfirm = createInitialState();
    (stateConfirm as any).session_context = { ...stateConfirm.session_context, last_question_key: "S1_KYC_CONFIRM" };
    const stateCollect = createInitialState();
    (stateCollect as any).session_context = { ...stateCollect.session_context, last_question_key: "S1_INDUSTRY" };
    const confirmCtx = buildSignalContext(stateConfirm as any, "yes");
    const collectCtx = buildSignalContext(stateCollect as any, "yes");
    const fConfirm = extractEngagementFeatures(confirmCtx);
    const fCollect = extractEngagementFeatures(collectCtx);
    expect(fConfirm.elaborationDepth).toBeGreaterThanOrEqual(fCollect.elaborationDepth);
  });
});

describe("computeValence", () => {
  it("positive text produces positive valence", () => {
    expect(computeValence("great excellent")).toBeGreaterThan(0);
    expect(computeValence("This is excellent")).toBeGreaterThan(0);
  });

  it("negative text produces negative valence", () => {
    expect(computeValence("terrible awful")).toBeLessThan(0);
    expect(computeValence("I'm frustrated")).toBeLessThan(0);
  });

  it("not happy produces negative valence", () => {
    const negated = computeValence("I'm not happy with this");
    const positive = computeValence("I'm happy");
    expect(negated).toBeLessThan(0);
    expect(positive).toBeGreaterThan(0);
  });

  it("returns value in [-1, 1]", () => {
    expect(computeValence("")).toBe(0);
    expect(computeValence("great perfect excellent amazing")).toBeLessThanOrEqual(1);
    expect(computeValence("terrible awful horrible")).toBeGreaterThanOrEqual(-1);
  });
});

describe("detectSentiment backward compatibility", () => {
  it("great job returns positive", () => {
    expect(detectSentiment("great job")).toBe("positive");
  });

  it("worried about risks returns concerned", () => {
    expect(detectSentiment("I'm worried about risks")).toBe("concerned");
  });
});

describe("extractSentimentFeatures", () => {
  it("returns bounded feature scores", () => {
    const f = extractSentimentFeatures("This is great and very helpful");
    expect(f.baseValence).toBeGreaterThanOrEqual(0);
    expect(f.baseValence).toBeLessThanOrEqual(1);
    expect(f.intensifierMagnitude).toBeGreaterThanOrEqual(0);
    expect(f.intensifierMagnitude).toBeLessThanOrEqual(1);
  });

  it("detects positive sentiment", () => {
    const pos = extractSentimentFeatures("Great, perfect, exactly what I need");
    expect(pos.baseValence).toBeGreaterThan(0.5);
  });

  it("detects concerned sentiment", () => {
    const concerned = extractSentimentFeatures("I'm stressed and worried about the risk");
    expect(concerned.baseValence).toBeLessThan(0.5);
  });
});

describe("extractTrustFeatures", () => {
  it("returns bounded feature scores", () => {
    const f = extractTrustFeatures("We need to work together on this");
    expect(f.pronounShift).toBeGreaterThanOrEqual(0);
    expect(f.pronounShift).toBeLessThanOrEqual(1);
    expect(f.vulnerabilityTransparency).toBeGreaterThanOrEqual(0);
    expect(f.vulnerabilityTransparency).toBeLessThanOrEqual(1);
  });

  it("detects collaborative pronouns", () => {
    const withWe = extractTrustFeatures("We should do this together, our team agrees");
    expect(withWe.pronounShift).toBeGreaterThan(0.5);
  });

  it("detects vulnerability markers", () => {
    const vuln = extractTrustFeatures("We failed before, lesson learned");
    expect(vuln.vulnerabilityTransparency).toBeGreaterThan(0);
  });
});

// ── Agents ─────────────────────────────────────────────────────────────

describe("runEngagementAgent", () => {
  it("returns valid SignalAgentResult shape", async () => {
    const r = await runEngagementAgent(ctx("What next? Can you explain?"));
    expect(r.dimension).toBe("engagement");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.source).toBe("heuristic");
    expect(typeof r.timestamp).toBe("number");
  });
});

describe("runSentimentAgent", () => {
  it("returns valid SignalAgentResult shape", async () => {
    const r = await runSentimentAgent(ctx("This is great!"));
    expect(r.dimension).toBe("sentiment");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.source).toBe("heuristic");
  });
});

describe("runTrustAgent", () => {
  it("returns valid SignalAgentResult shape", async () => {
    const r = await runTrustAgent(ctx("We agree, our team aligns on this"));
    expect(r.dimension).toBe("trust");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.source).toBe("heuristic");
  });
});

// ── Orchestrator ───────────────────────────────────────────────────────

describe("runSignalOrchestrator", () => {
  it("returns null when disabled", async () => {
    const state = createInitialState();
    const r = await runSignalOrchestrator("Hello", state, { enabled: false, ttlMs: 1000 });
    expect(r).toBeNull();
  });

  it("returns null when nodeSignalAgents is false", async () => {
    const state = createInitialState();
    const r = await runSignalOrchestrator("Hello", state, { enabled: true, ttlMs: 1000 }, false);
    expect(r).toBeNull();
  });

  it("returns null for empty userText", async () => {
    const state = createInitialState();
    const r = await runSignalOrchestrator("", state, { enabled: true, ttlMs: 1000 });
    expect(r).toBeNull();
  });

  it("returns aggregated result with EMA scores", async () => {
    const state = CfsStateSchema.parse({
      ...createInitialState(),
      relationship_context: {
        engagement_score: 0.5,
        sentiment_score: 0.5,
        trust_score: 0.5,
        intent_score: 0.5,
        overall_conversation_score: 0.5,
        turn_count: 0,
        signal_history: [],
        signal_events: [],
        signal_actions: [],
        last_signal_timestamp: null,
      },
    });
    const r = await runSignalOrchestrator("We love this! Very helpful.", state, {
      enabled: true,
      ttlMs: 2000,
    });
    expect(r).not.toBeNull();
    expect(r!.engagement_score).toBeGreaterThanOrEqual(0);
    expect(r!.engagement_score).toBeLessThanOrEqual(1);
    expect(r!.sentiment_score).toBeGreaterThanOrEqual(0);
    expect(r!.sentiment_score).toBeLessThanOrEqual(1);
    expect(r!.trust_score).toBeGreaterThanOrEqual(0);
    expect(r!.trust_score).toBeLessThanOrEqual(1);
    expect(r!.overall_conversation_score).toBeGreaterThanOrEqual(0);
    expect(r!.overall_conversation_score).toBeLessThanOrEqual(1);
    expect(r!.turn_count).toBe(1);
    expect(r!.signal_history).toHaveLength(1);
    expect(r!.signal_history[0].engagement).toBeGreaterThanOrEqual(0);
    expect(r!.signal_history[0].sentiment).toBeGreaterThanOrEqual(0);
    expect(r!.signal_history[0].trust).toBeGreaterThanOrEqual(0);
    expect(r!.signal_history[0].intent).toBeGreaterThanOrEqual(0);
    expect(r!.intent_score).toBeGreaterThanOrEqual(0);
    expect(r!.intent_score).toBeLessThanOrEqual(1);
  });

  it("completes in under 100ms for heuristic mode", async () => {
    const state = createInitialState();
    const t0 = Date.now();
    await runSignalOrchestrator("Hello world", state, { enabled: true, ttlMs: 2000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});

// ── Validation fixtures (15–20 snippets) ────────────────────────────────

const FIXTURES = [
  { text: "Yes", expected: { sentiment: "neutral-to-positive" } },
  { text: "Great, perfect!", expected: { sentiment: "positive" } },
  { text: "I'm stressed and worried", expected: { sentiment: "concerned" } },
  { text: "What next? Can you explain?", expected: { engagement: "high" } },
  { text: "I see, makes sense", expected: { engagement: "back-channel" } },
  { text: "We need to work together on this", expected: { trust: "collaborative" } },
  { text: "We failed before, lesson learned", expected: { trust: "vulnerable" } },
  { text: "This is very helpful and exactly what we need", expected: { sentiment: "positive", trust: "high" } },
  { text: "No", expected: { sentiment: "neutral" } },
  { text: "Sure, sounds good", expected: { sentiment: "positive" } },
  { text: "I'm blocked and frustrated", expected: { sentiment: "concerned" } },
  { text: "Tell me more about that", expected: { engagement: "follow-up" } },
  { text: "Our team agrees, we align on this", expected: { trust: "high" } },
  { text: "Exactly right", expected: { sentiment: "positive", trust: "alignment" } },
  { text: "We will implement this when we have time", expected: { sentiment: "future-oriented" } },
];

describe("runIntentAgent", () => {
  it("returns valid SignalAgentResult shape", async () => {
    const r = await runIntentAgent(ctx("We're looking at solutions together, our team agrees"));
    expect(r.dimension).toBe("intent");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.source).toBe("heuristic");
  });

  it("delegation language scores lower than cooperative", async () => {
    const coop = await runIntentAgent(ctx("We're looking at solutions together, our team agrees"));
    const deflect = await runIntentAgent(ctx("That's more of a team decision, I'd have to check"));
    expect(coop.score).toBeGreaterThan(deflect.score);
  });
});

describe("detectSignalEvents and suggestSignalActions", () => {
  it("declining engagement produces event and action", () => {
    const history = [
      { turn_index: 0, timestamp: 1, engagement: 0.8, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
      { turn_index: 1, timestamp: 2, engagement: 0.6, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
      { turn_index: 2, timestamp: 3, engagement: 0.4, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
    ];
    const events = detectSignalEvents(history as any, { engagement: 0.4, sentiment: 0.5, trust: 0.5, intent: 0.5 });
    expect(events.some((e) => e.type === "engagement_declining")).toBe(true);
    const actions = suggestSignalActions(events);
    expect(actions.some((a) => a.type === "slow_down_pacing")).toBe(true);
  });

  it("stable history produces no events", () => {
    const history = [
      { turn_index: 0, timestamp: 1, engagement: 0.5, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
      { turn_index: 1, timestamp: 2, engagement: 0.5, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
    ];
    const events = detectSignalEvents(history as any, { engagement: 0.5, sentiment: 0.5, trust: 0.5, intent: 0.5 });
    expect(events).toHaveLength(0);
  });

  it("short history produces no trend events", () => {
    const events = detectSignalEvents([], { engagement: 0.5, sentiment: 0.5, trust: 0.5, intent: 0.5 });
    expect(events).toHaveLength(0);
  });
});

describe("runSignalOrchestrator accumulation", () => {
  it("accumulates signal_events and signal_actions from previous relationship_context", async () => {
    const prevEvent = { type: "high_trust_moment", timestamp: 1000, details: { trustScore: 0.9 } };
    const prevAction = { type: "slow_down_pacing", priority: "medium" as const, reason: "engagement_declining detected" };
    const state = CfsStateSchema.parse({
      ...createInitialState(),
      relationship_context: {
        engagement_score: 0.5,
        sentiment_score: 0.5,
        trust_score: 0.5,
        intent_score: 0.5,
        overall_conversation_score: 0.5,
        turn_count: 0,
        signal_history: [],
        signal_events: [prevEvent],
        signal_actions: [prevAction],
        last_signal_timestamp: null,
      },
    });
    const r = await runSignalOrchestrator("Hello", state, { enabled: true, ttlMs: 2000 });
    expect(r).not.toBeNull();
    expect(r!.signal_events).toContainEqual(prevEvent);
    expect(r!.signal_events[0]).toEqual(prevEvent);
    expect(r!.signal_actions).toContainEqual(prevAction);
    expect(r!.signal_actions[0]).toEqual(prevAction);
  });

  it("caps signal_events and signal_actions at EVENTS_LIMIT", async () => {
    const oldestEvent = { type: "event_0", timestamp: 1, details: {} };
    const prevEvents = [
      oldestEvent,
      ...Array.from({ length: EVENTS_LIMIT - 1 }, (_, i) => ({
        type: `event_${i + 1}`,
        timestamp: i + 2,
        details: {},
      })),
    ];
    const state = CfsStateSchema.parse({
      ...createInitialState(),
      relationship_context: {
        engagement_score: 0.5,
        sentiment_score: 0.5,
        trust_score: 0.5,
        intent_score: 0.5,
        overall_conversation_score: 0.5,
        turn_count: 0,
        signal_history: [
          { turn_index: 0, timestamp: 1, engagement: 0.8, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
          { turn_index: 1, timestamp: 2, engagement: 0.6, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
          { turn_index: 2, timestamp: 3, engagement: 0.4, sentiment: 0.5, trust: 0.5, intent: 0.5, confidence: 0.8, source: "heuristic" as const },
        ],
        signal_events: prevEvents,
        signal_actions: [],
        last_signal_timestamp: null,
      },
    });
    const r = await runSignalOrchestrator("k", state, { enabled: true, ttlMs: 2000 });
    expect(r).not.toBeNull();
    expect(r!.signal_events.length).toBeLessThanOrEqual(EVENTS_LIMIT);
    expect(r!.signal_events.some((e) => e.type === "event_0")).toBe(false);
    expect(r!.signal_events.some((e) => e.type === "engagement_declining")).toBe(true);
  });
});

describe("runLlmSignalAgent", () => {
  it("returns valid 4-dimension results when mock returns JSON", async () => {
    const origContent = (globalThis as any).__chatOpenAIMockContent;
    const origKey = process.env.OPENAI_API_KEY;
    (globalThis as any).__chatOpenAIMockContent = '{"engagement":0.8,"sentiment":0.7,"trust":0.6,"intent":0.9}';
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";
    const { clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    try {
      const results = await runLlmSignalAgent(ctx("We love this solution"));
      expect(results).not.toBeNull();
      expect(results!).toHaveLength(4);
      expect(results!.every((r) => r.source === "llm")).toBe(true);
      expect(results!.find((r) => r.dimension === "engagement")?.score).toBe(0.8);
    } finally {
      (globalThis as any).__chatOpenAIMockContent = origContent;
      if (origKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = origKey;
      clearModelCache();
    }
  });
});

describe("extractIntentFeatures", () => {
  it("returns bounded feature scores", () => {
    const f = extractIntentFeatures(ctx("We need to work together on this"));
    expect(f.cooperationSignal).toBeGreaterThanOrEqual(0);
    expect(f.cooperationSignal).toBeLessThanOrEqual(1);
    expect(f.rushingSignal).toBeGreaterThanOrEqual(0);
    expect(f.rushingSignal).toBeLessThanOrEqual(1);
  });
});

describe("validation fixtures", () => {
  it("all fixtures produce bounded scores", async () => {
    for (const { text } of FIXTURES) {
      const c = ctx(text);
      const eng = await runEngagementAgent(c);
      const sent = await runSentimentAgent(c);
      const trust = await runTrustAgent(c);
      const intent = await runIntentAgent(c);
      expect(eng.score).toBeGreaterThanOrEqual(0);
      expect(eng.score).toBeLessThanOrEqual(1);
      expect(sent.score).toBeGreaterThanOrEqual(0);
      expect(sent.score).toBeLessThanOrEqual(1);
      expect(trust.score).toBeGreaterThanOrEqual(0);
      expect(trust.score).toBeLessThanOrEqual(1);
      expect(intent.score).toBeGreaterThanOrEqual(0);
      expect(intent.score).toBeLessThanOrEqual(1);
    }
  });
});
