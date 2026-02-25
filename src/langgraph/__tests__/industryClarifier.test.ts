import { jest } from "@jest/globals";
import { AIMessage } from "@langchain/core/messages";

const mockIsIndustryVague = jest.fn(async () => true);
const mockGetSubIndustrySuggestions = jest.fn(async () => ({
    results: [
      { title: "Provider Management", description: "", url: "https://example.com/a", score: 0, source: "firecrawl" },
      { title: "Managed Care", description: "", url: "https://example.com/b", score: 0, source: "firecrawl" },
      { title: "Ambulatory Care", description: "", url: "https://example.com/c", score: 0, source: "firecrawl" },
    ],
    suggestions: ["Provider Management", "Managed Care", "Ambulatory Care"],
  }));

jest.unstable_mockModule("../core/services/internet-search.js", () => ({
  isIndustryVague: mockIsIndustryVague,
  getSubIndustrySuggestions: mockGetSubIndustrySuggestions,
  nodeInternetSearch: jest.fn(),
}));

let buildCfsGraph: typeof import("../graph.js").buildCfsGraph;
let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;
let lastAIMessage: typeof import("../infra.js").lastAIMessage;

beforeAll(async () => {
  ({ buildCfsGraph, createInitialState, runTurn } = await import("../graph.js"));
  ({ lastAIMessage } = await import("../infra.js"));
});

describe("industry clarifier flow", () => {
  it("asks clarifier once with suggested sub-industries", async () => {
    delete process.env.OPENAI_API_KEY;
    const originalMock = globalThis.__mockSearchSupabaseVectors;
    // Avoid embedding/model calls during this test.
    globalThis.__mockSearchSupabaseVectors = async () => [];
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s1" });

    try {
      const afterInit = await runTurn(graphApp, initial, undefined);
      const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
      const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
      const afterName = await runTurn(graphApp, afterConfirm, "Alex");

      const beforeIndustryLen = afterName.messages.length;
      const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
      const clarifierMessages = afterIndustry.messages
        .slice(beforeIndustryLen)
        .filter((m) => m instanceof AIMessage)
        .map((m) => m.content?.toString() ?? "")
        .join("\n");

      expect(clarifierMessages).toContain("To make sure we're aligned — when you said Healthcare");
      expect(clarifierMessages).toContain("For instance: Provider Management, Managed Care, Ambulatory Care.");
      expect(afterIndustry.session_context.step_clarifier_used).toBe(true);
      expect(afterIndustry.session_context.awaiting_user).toBe(true);

      const afterClarified = await runTurn(graphApp, afterIndustry, "Managed Care");
      expect(afterClarified.user_context.industry).toBe("Healthcare - Managed Care");
      expect(afterClarified.session_context.step_clarifier_used).toBe(true);
      expect(afterClarified.session_context.awaiting_user).toBe(true);
      expect(afterClarified.session_context.last_question_key).toBe("S1_ROLE");
    } finally {
      globalThis.__mockSearchSupabaseVectors = originalMock;
    }
  });
});
