import { jest } from "@jest/globals";

let buildCfsGraph: typeof import("../graph.js").buildCfsGraph;
let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;
let infra: typeof import("../infra.js");

beforeAll(async () => {
  ({ buildCfsGraph, createInitialState, runTurn } = await import("../graph.js"));
  infra = await import("../infra.js");
});

describe("askRole AI rephrase", () => {
  it("uses AI-rephrased question when available", async () => {
    globalThis.__rephraseQuestionOverride = "In Automotive Manufacturing, how are you accountable in your role?";
    const originalMock = globalThis.__mockSearchSupabaseVectors;
    globalThis.__mockSearchSupabaseVectors = async () => [];
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s1" });

    try {
      const afterInit = await runTurn(graphApp, initial, undefined);
      const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
      const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
      const afterName = await runTurn(graphApp, afterConfirm, "Alex");
      const afterIndustry = await runTurn(graphApp, afterName, "Automotive Manufacturing");

      const rolePrompt = infra.lastAIMessage(afterIndustry)?.content?.toString() ?? "";
      expect(rolePrompt).toContain("Alex");
      expect(rolePrompt).toContain("In Automotive Manufacturing, how are you accountable in your role?");
      globalThis.__rephraseQuestionOverride = undefined;
    } finally {
      globalThis.__mockSearchSupabaseVectors = originalMock;
    }
  });

  it("falls back to base question when AI returns null", async () => {
    globalThis.__rephraseQuestionOverride = null;
    const originalMock = globalThis.__mockSearchSupabaseVectors;
    globalThis.__mockSearchSupabaseVectors = async () => [];
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s2" });

    try {
      const afterInit = await runTurn(graphApp, initial, undefined);
      const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
      const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
      const afterName = await runTurn(graphApp, afterConfirm, "Taylor");
      const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");

      const rolePrompt = infra.lastAIMessage(afterIndustry)?.content?.toString() ?? "";
      expect(rolePrompt).toContain("Taylor");
      expect(rolePrompt).toContain("What is your role in the organization - how are you accountable?");
      globalThis.__rephraseQuestionOverride = undefined;
    } finally {
      globalThis.__mockSearchSupabaseVectors = originalMock;
    }
  });
});
