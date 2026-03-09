import { describe, it, expect, beforeEach } from "@jest/globals";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphFromSchema, createInitialState, runTurn } from "../graph.js";
import { registerCfsHandlers, resetCfsRegistration } from "../schema/cfs-handlers.js";
import { clearRegistry } from "../schema/handler-registry.js";
import { loadAndCompileGraph } from "../schema/graph-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CFS_YAML = resolve(__dirname, "../../../clients/default/flows/cfs-default/flow.yaml");

beforeEach(() => {
  clearRegistry();
  resetCfsRegistration();
});

describe("runTurn signal agent wiring", () => {
  it("merges signal into relationship_context on turn N+1 (deferred merge)", async () => {
    registerCfsHandlers();
    const graphApp = loadAndCompileGraph(CFS_YAML);
    const state = createInitialState({ sessionId: "sig-int-1" });

    const turn1 = await runTurn(graphApp, state, "We love this! Very helpful.");
    const turn2 = await runTurn(graphApp, turn1, "Tell me more about that.");

    expect(turn2.relationship_context).toBeDefined();
    expect(typeof turn2.relationship_context.engagement_score).toBe("number");
    expect(typeof turn2.relationship_context.sentiment_score).toBe("number");
    expect(typeof turn2.relationship_context.trust_score).toBe("number");
    expect(typeof turn2.relationship_context.intent_score).toBe("number");
    expect(typeof turn2.relationship_context.overall_conversation_score).toBe("number");
    expect(typeof turn2.relationship_context.turn_count).toBe("number");
    expect(Array.isArray(turn2.relationship_context.signal_history)).toBe(true);
    expect(turn2.relationship_context.engagement_score).toBeGreaterThanOrEqual(0);
    expect(turn2.relationship_context.engagement_score).toBeLessThanOrEqual(1);
  });
});

describe("legacy key removal", () => {
  it("relationship_context has no engagement_level", () => {
    const state = createInitialState({ sessionId: "legacy-1" });
    expect(state.relationship_context).toBeDefined();
    expect("engagement_level" in state.relationship_context).toBe(false);
  });

  it("relationship_context has no sentiment_log", () => {
    const state = createInitialState({ sessionId: "legacy-2" });
    expect("sentiment_log" in state.relationship_context).toBe(false);
  });

  it("relationship_context has canonical signal keys", () => {
    const state = createInitialState({ sessionId: "legacy-3" });
    const rc = state.relationship_context;
    expect("engagement_score" in rc).toBe(true);
    expect("sentiment_score" in rc).toBe(true);
    expect("trust_score" in rc).toBe(true);
    expect("intent_score" in rc).toBe(true);
    expect("overall_conversation_score" in rc).toBe(true);
    expect("turn_count" in rc).toBe(true);
    expect("signal_history" in rc).toBe(true);
    expect("signal_events" in rc).toBe(true);
    expect("signal_actions" in rc).toBe(true);
    expect("last_signal_timestamp" in rc).toBe(true);
  });
});
