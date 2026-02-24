import { jest } from "@jest/globals";

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
});

afterEach(() => {
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = undefined;
  globalThis.__determineUseCaseQuestionsOverride = undefined;
});

describe("nodeDetermineUseCaseQuestions", () => {
  it("includes weave values only when real in the prompt", async () => {
    const { buildUseCaseQuestionsPrompt, normalizeWeaveValue } = await import("../flows/stepFlowHelpers.js");
    const role = normalizeWeaveValue("default");
    const industry = normalizeWeaveValue("Healthcare");
    const timeframe = normalizeWeaveValue(" ");
    const prompt = buildUseCaseQuestionsPrompt({
      problemStatement: "Reduce delays",
      goalStatement: "Improve reliability",
      vectorContext: "Context",
      questionBank: ["Q1", "Q2", "Q3"],
      role,
      industry,
      timeframe,
    });

    expect(prompt.system).toContain("Weave in role, industry, and timeframe only if they have real values");
    expect(prompt.user).toContain("Role: ");
    expect(prompt.user).toContain("Industry: Healthcare");
    expect(prompt.user).toContain("Timeframe: ");
  });

  it("retrieves question bank using discovery_question_text and required filters", async () => {
    const calls: Array<{ metadataFilter: Record<string, unknown> }> = [];
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      calls.push({ metadataFilter: params.metadataFilter });
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
              discovery_question_text: "1. How do teams align today?\n2. Where do systems fail?\n3. What will scale break?",
            },
            metadata: {},
            relationships: {},
          },
        ];
      }
      return [];
    };
    globalThis.__determineUseCaseQuestionsOverride = ["Question A", "Question B", "Question C"];

    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s1" });
    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
    const afterRole = await runTurn(graphApp, afterIndustry, "Director of IT");
    const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
    const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "6 months");
    const afterKycConfirm = await runTurn(graphApp, afterTimeframe, "yes");
    const afterUseCaseSelection = await runTurn(graphApp, afterKycConfirm, "1");

    expect(afterUseCaseSelection.use_case_context.discovery_question_bank).toEqual([
      "How do teams align today?",
      "Where do systems fail?",
      "What will scale break?",
    ]);
    expect(afterUseCaseSelection.use_case_context.discovery_questions).toEqual(
      expect.arrayContaining([
        { question: "Question A", response: null, risk: null, risk_domain: null },
        { question: "Question B", response: null, risk: null, risk_domain: null },
        { question: "Question C", response: null, risk: null, risk_domain: null },
      ])
    );

    const questionCall = calls.find((call) => call.metadataFilter.document_type === "use_cases_questions_document");
    expect(questionCall).toBeTruthy();
    expect(questionCall?.metadataFilter.tenant_id).toBeTruthy();
    expect(questionCall?.metadataFilter.use_case_group_title).toBe("Data governance");
    expect(questionCall?.metadataFilter.persona_group_name).toBeTruthy();
    expect(questionCall?.metadataFilter.use_case_name).toEqual(["Modernize data workflows"]);
  });

  it("falls back to question bank when override output is invalid", async () => {
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      if (params.metadataFilter.document_type === "use_case_document") {
        return [
          {
            document_id: "u2",
            document_type: "use_case_document",
            content: { use_case_text: "Automate compliance reporting" },
            metadata: { use_case_text: "Automate compliance reporting" },
            relationships: {},
            similarity: 0.88,
          },
        ];
      }
      if (params.metadataFilter.document_type === "use_cases_questions_document") {
        return [
          {
            document_id: "q2",
            document_type: "use_cases_questions_document",
            content: {
              discovery_question_text: "1. First question?\n2. Second question?\n3. Third question?",
            },
            metadata: {},
            relationships: {},
          },
        ];
      }
      return [];
    };
    globalThis.__determineUseCaseQuestionsOverride = "1. Only one\n2. Only two";

    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s2" });
    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
    const afterRole = await runTurn(graphApp, afterIndustry, "Director of IT");
    const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
    const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "6 months");
    const afterKycConfirm = await runTurn(graphApp, afterTimeframe, "yes");
    const afterUseCaseSelection = await runTurn(graphApp, afterKycConfirm, "1");

    expect(afterUseCaseSelection.use_case_context.discovery_questions).toEqual(
      expect.arrayContaining([
        { question: "First question?", response: null, risk: null, risk_domain: null },
        { question: "Second question?", response: null, risk: null, risk_domain: null },
        { question: "Third question?", response: null, risk: null, risk_domain: null },
      ])
    );
    expect(afterUseCaseSelection.session_context.guardrail_log).toContain("guardrail:fail:discovery_questions_override");
  });
});
