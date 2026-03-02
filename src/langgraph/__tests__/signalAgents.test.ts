import { describe, it, expect } from "@jest/globals";
import {
  extractEngagementFeatures,
  extractSentimentFeatures,
  extractTrustFeatures,
} from "../core/agents/extractors.js";
import { runEngagementAgent, runSentimentAgent, runTrustAgent } from "../core/agents/index.js";
import { runSignalOrchestrator } from "../core/agents/index.js";
import { CfsStateSchema } from "../state.js";
import { createInitialState } from "../core/helpers/state.js";

// ── Extractors ─────────────────────────────────────────────────────────

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
    expect(pos.baseValence).toBe(1);
  });

  it("detects concerned sentiment", () => {
    const concerned = extractSentimentFeatures("I'm stressed and worried about the risk");
    expect(concerned.baseValence).toBe(0.2);
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
    const r = await runEngagementAgent("What next? Can you explain?");
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
    const r = await runSentimentAgent("This is great!");
    expect(r.dimension).toBe("sentiment");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.source).toBe("heuristic");
  });
});

describe("runTrustAgent", () => {
  it("returns valid SignalAgentResult shape", async () => {
    const r = await runTrustAgent("We agree, our team aligns on this");
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

describe("validation fixtures", () => {
  it("all fixtures produce bounded scores", async () => {
    for (const { text } of FIXTURES) {
      const eng = await runEngagementAgent(text);
      const sent = await runSentimentAgent(text);
      const trust = await runTrustAgent(text);
      expect(eng.score).toBeGreaterThanOrEqual(0);
      expect(eng.score).toBeLessThanOrEqual(1);
      expect(sent.score).toBeGreaterThanOrEqual(0);
      expect(sent.score).toBeLessThanOrEqual(1);
      expect(trust.score).toBeGreaterThanOrEqual(0);
      expect(trust.score).toBeLessThanOrEqual(1);
    }
  });
});
