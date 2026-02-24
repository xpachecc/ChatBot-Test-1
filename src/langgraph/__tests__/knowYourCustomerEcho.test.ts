import { jest } from "@jest/globals";

let buildCfsGraph: typeof import("../graph.js").buildCfsGraph;
let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;

const mockVectorResults = [
  {
    document_id: "doc-1",
    document_type: "mock",
    content: "Support evolving AI/ML capabilities without infra constraints.",
    metadata: { outcome_name: "Operational Resilience", segment_name: "Enterprise", scope_profile: "Large org" },
    relationships: {},
  },
];

beforeAll(async () => {
  ({ buildCfsGraph, createInitialState, runTurn } = await import("../graph.js"));
});

beforeEach(() => {
  globalThis.__mockSearchSupabaseVectors = async () => mockVectorResults as any;
  globalThis.__mockPersonaGroups = ["Data Leader"];
});

afterEach(() => {
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = undefined;
  globalThis.__knowYourCustomerEchoOverride = undefined;
});

async function runToTimeframeRecap() {
  const graphApp = buildCfsGraph();
  const initial = createInitialState({ sessionId: "s1" });
  const afterInit = await runTurn(graphApp, initial, undefined);
  const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
  const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
  const afterName = await runTurn(graphApp, afterConfirm, "Alex");
  const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
  const afterRole = await runTurn(graphApp, afterIndustry, "VP of Data");
  const afterRoleConfirm = await runTurn(graphApp, afterRole, "yes");
  const recapState = await runTurn(graphApp, afterRoleConfirm, "in 6 months");
  return { graphApp, recapState };
}

describe("nodeKnowYourCustomerEcho", () => {
  it("uses the override response when provided", async () => {
    globalThis.__knowYourCustomerEchoOverride = "Custom recap message.";
    const { recapState } = await runToTimeframeRecap();
    const messages = recapState.messages.map((m) => m.content?.toString() ?? "");
    expect(messages.some((text) => text.includes("Custom recap message."))).toBe(true);
    expect(recapState.session_context.last_question_key).toBe("S1_KYC_CONFIRM");
    expect(recapState.session_context.awaiting_user).toBe(true);
  });

  it("falls back to deterministic recap when AI is unavailable", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "";
    const { recapState } = await runToTimeframeRecap();
    const messages = recapState.messages.map((m) => m.content?.toString() ?? "");
    const recap = messages.find((text) => text.includes("I really appreciate the context"));
    expect(recap).toBeTruthy();
    expect(recap).toContain("Related insight:");
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("emits the next-step message after confirmation", async () => {
    const { graphApp, recapState } = await runToTimeframeRecap();
    const afterConfirm = await runTurn(graphApp, recapState, "yes");
    const messages = afterConfirm.messages.map((m) => m.content?.toString() ?? "");
    expect(messages.some((text) => text.includes("Excellent. We have two quick steps left."))).toBe(true);
    expect(messages.some((text) => text.includes("Now let's make sure we have the right use case!"))).toBe(true);
  });
});
