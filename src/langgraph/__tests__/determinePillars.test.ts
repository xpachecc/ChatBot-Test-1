import { lastAIMessage } from "../infra.js";

let buildCfsGraph: typeof import("../graph.js").buildCfsGraph;
let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;

beforeAll(async () => {
  ({ buildCfsGraph, createInitialState, runTurn } = await import("../graph.js"));
});

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = ["Operations Leader"];
  globalThis.__determineUseCaseQuestionsOverride = undefined;
  globalThis.__assessRiskOverride = {
    risk_detected: false,
    risk_statement: null,
    risk_domain: null,
  };
  globalThis.__mockPillarsForOutcome = undefined;
  globalThis.__mockAllPillars = undefined;
  globalThis.__determinePillarsOverride = undefined;
});

afterEach(() => {
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = undefined;
  globalThis.__determineUseCaseQuestionsOverride = undefined;
  globalThis.__assessRiskOverride = undefined;
  globalThis.__mockPillarsForOutcome = undefined;
  globalThis.__mockAllPillars = undefined;
  globalThis.__determinePillarsOverride = undefined;
});

async function runToPillars(graphApp: ReturnType<typeof buildCfsGraph>) {
  globalThis.__mockSearchSupabaseVectors = async (params) => {
    if (params.metadataFilter.document_type === "use_case_document") {
      return [
        {
          document_id: "u1",
          document_type: "use_case_document",
          content: { use_case_text: "Modernize data workflows" },
          metadata: { use_case_text: "Modernize data workflows" },
          relationships: {},
          similarity: 0.92,
        },
      ];
    }
    if (params.metadataFilter.document_type === "use_cases_questions_document") {
      return [
        {
          document_id: "q1",
          document_type: "use_cases_questions_document",
          content: {
            discovery_question_text: "1. First question?\n2. Second question?\n3. Third question?",
          },
          metadata: {},
          relationships: {},
        },
      ];
    }
    if (params.metadataFilter.document_type === "market_segment_use_case_group_document") {
      return [
        {
          document_id: "seg-1",
          document_type: "market_segment_use_case_group_document",
          content: { segment_name: "Segment A", scope_profile: "Scope A" },
          metadata: { segment_name: "Segment A", scope_profile: "Scope A" },
          relationships: {},
          similarity: 0.9,
        },
      ];
    }
    return [];
  };
  globalThis.__determineUseCaseQuestionsOverride = ["Question A", "Question B", "Question C"];

  const initial = createInitialState({ sessionId: "s-pillars-1" });
  const afterInit = await runTurn(graphApp, initial, undefined);
  const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
  const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
  const afterName = await runTurn(graphApp, afterConfirm, "Alex");
  const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
  const afterRole = await runTurn(graphApp, afterIndustry, "Director of IT");
  const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
  const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "6 months");
  const afterKycConfirm = await runTurn(graphApp, afterTimeframe, "yes");
  // User submits "1" -> ingestUseCaseSelection -> nodeDetermineUseCaseQuestions -> nodeAskUseCaseQuestions (same turn)
  const afterUseCaseSelection = await runTurn(graphApp, afterKycConfirm, "1");
  const firstPrompt = lastAIMessage(afterUseCaseSelection)?.content?.toString() ?? "";
  if (!firstPrompt.includes("Question 1 of 3:")) {
    throw new Error("Discovery questions did not start as expected.");
  }
  const afterFirst = await runTurn(graphApp, afterUseCaseSelection, "First response");
  const afterSecond = await runTurn(graphApp, afterFirst, "Second response");
  const afterThird = await runTurn(graphApp, afterSecond, "Third response");
  // One more turn triggers routeInitFlow -> nodeDeterminePillars
  return runTurn(graphApp, afterThird, undefined);
}

describe("nodeDeterminePillars", () => {
  it("stores pillars from RPC when available", async () => {
    globalThis.__mockPillarsForOutcome = ["Resilience", "Scale"];
    const graphApp = buildCfsGraph();
    const finalState = await runToPillars(graphApp);

    expect(finalState.use_case_context.pillars).toEqual([
      { name: "Resilience", confidence: 1.0 },
      { name: "Scale", confidence: 1.0 },
    ]);
    expect(finalState.session_context.reason_trace).toContain("determine_pillars:rpc_ok");
  });

  it("selects pillars from AI override when RPC returns none", async () => {
    globalThis.__mockPillarsForOutcome = [];
    globalThis.__mockAllPillars = ["P1", "P2", "P3"];
    globalThis.__determinePillarsOverride = ["P2", "P3"];
    const graphApp = buildCfsGraph();
    const finalState = await runToPillars(graphApp);

    expect(finalState.use_case_context.pillars).toEqual([
      { name: "P2", confidence: 1.0 },
      { name: "P3", confidence: 1.0 },
    ]);
    expect(finalState.session_context.reason_trace).toContain("determine_pillars:override");
  });

  it("falls back to all pillars when override is invalid", async () => {
    globalThis.__mockPillarsForOutcome = [];
    globalThis.__mockAllPillars = ["P1", "P2"];
    globalThis.__determinePillarsOverride = ["Unknown"];
    const graphApp = buildCfsGraph();
    const finalState = await runToPillars(graphApp);

    expect(finalState.use_case_context.pillars).toEqual([
      { name: "P1", confidence: 0 },
      { name: "P2", confidence: 0 },
    ]);
    expect(finalState.session_context.guardrail_log).toContain("guardrail:fail:pillars_override");
  });
});
