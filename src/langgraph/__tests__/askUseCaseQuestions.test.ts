import { jest } from "@jest/globals";
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
  globalThis.__assessRiskOverride = undefined;
  globalThis.__mockPillarsForOutcome = undefined;
  globalThis.__mockAllPillars = undefined;
});

afterEach(() => {
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = undefined;
  globalThis.__determineUseCaseQuestionsOverride = undefined;
  globalThis.__assessRiskOverride = undefined;
  globalThis.__mockPillarsForOutcome = undefined;
  globalThis.__mockAllPillars = undefined;
});

async function runToDiscoveryStart(graphApp: ReturnType<typeof buildCfsGraph>) {
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
  // nodeDetermineUseCaseQuestions now ends its turn; trigger nodeAskUseCaseQuestions
  // via routeInitFlow to present the first discovery question.
  return runTurn(graphApp, afterUseCaseSelection, undefined);
}

describe("nodeAskUseCaseQuestions", () => {
  it("loops questions and stores sanitized responses", async () => {
    globalThis.__assessRiskOverride = {
      risk_detected: true,
      risk_statement: "Ownership gaps could delay compliance timelines.",
      risk_domain: "compliance",
    };
    globalThis.__mockPillarsForOutcome = ["Resilience", "Automation"];
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
      return [];
    };
    globalThis.__determineUseCaseQuestionsOverride = ["Question A", "Question B", "Question C"];

    const graphApp = buildCfsGraph();
    const afterUseCaseSelection = await runToDiscoveryStart(graphApp);
    const firstPrompt = lastAIMessage(afterUseCaseSelection)?.content?.toString() ?? "";
    expect(firstPrompt).toContain("Question 1 of 3:");

    const afterFirst = await runTurn(graphApp, afterUseCaseSelection, "  First response \n");
    const firstResponse = afterFirst.use_case_context.discovery_questions[0]?.response ?? "";
    expect(firstResponse).toBe("First response");
    expect(afterFirst.use_case_context.discovery_questions[0]?.risk).toBe("Ownership gaps could delay compliance timelines.");
    expect(afterFirst.use_case_context.discovery_questions[0]?.risk_domain).toBe("compliance");
    // While the loop is awaiting more user input, we should NOT have determined pillars yet.
    expect(afterFirst.session_context.awaiting_user).toBe(true);
    expect(afterFirst.use_case_context.pillars ?? []).toEqual([]);
    const secondPrompt = lastAIMessage(afterFirst)?.content?.toString() ?? "";
    expect(secondPrompt).toContain("Question 2 of 3:");

    const afterSecond = await runTurn(graphApp, afterFirst, "Second response");
    expect(afterSecond.session_context.awaiting_user).toBe(true);
    expect(afterSecond.use_case_context.pillars ?? []).toEqual([]);
    const thirdPrompt = lastAIMessage(afterSecond)?.content?.toString() ?? "";
    expect(thirdPrompt).toContain("Question 3 of 3:");

    const afterThird = await runTurn(graphApp, afterSecond, "Third response");
    const response = afterThird.use_case_context.discovery_questions[2]?.response ?? "";
    expect(response).toBe("Third response");
    expect(afterThird.session_context.awaiting_user).toBe(false);
    expect(afterThird.session_context.last_question_key).toBeNull();
    // Once the loop completes, the graph should proceed to determine pillars exactly once.
    expect((afterThird.use_case_context.pillars ?? []).length).toBeGreaterThan(0);
  });

  it("re-prompts on empty responses without advancing", async () => {
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
      return [];
    };
    globalThis.__determineUseCaseQuestionsOverride = ["Question A", "Question B", "Question C"];

    const graphApp = buildCfsGraph();
    const afterUseCaseSelection = await runToDiscoveryStart(graphApp);
    const afterEmpty = await runTurn(graphApp, afterUseCaseSelection, "   ");
    const retryPrompt = lastAIMessage(afterEmpty)?.content?.toString() ?? "";
    expect(retryPrompt).toContain("Question 1 of 3:");
    expect(afterEmpty.session_context.step_question_index).toBe(0);
    const response = afterEmpty.use_case_context.discovery_questions[0]?.response ?? null;
    expect(response).toBeNull();
  });
});
