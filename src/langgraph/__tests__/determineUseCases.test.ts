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
});

afterEach(() => {
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = undefined;
});

describe("nodeDetermineUseCases", () => {
  it("retrieves use cases, stores prioritized items, and prompts for selection", async () => {
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
            similarity: 0.91,
          },
        ];
      }
      return [];
    };

    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s-usecase-1" });
    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
    const afterRole = await runTurn(graphApp, afterIndustry, "Director of IT");
    const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
    const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "6 months");

    const afterKycConfirm = await runTurn(graphApp, afterTimeframe, "yes");

    expect(afterKycConfirm.use_case_context.use_cases_prioritized.length).toBeGreaterThan(0);
    expect(afterKycConfirm.session_context.awaiting_user).toBe(true);
    expect(afterKycConfirm.session_context.last_question_key).toBe("S3_USE_CASE_SELECT");
    const lastAi = lastAIMessage(afterKycConfirm)?.content?.toString() ?? "";
    expect(lastAi).toContain("Enter the number of the use case(s) that are relevant to you");

    const useCaseCall = calls.find((call) => call.metadataFilter.document_type === "use_case_document");
    expect(useCaseCall).toBeTruthy();
    expect(useCaseCall?.metadataFilter.tenant_id).toBeTruthy();
  });

  it("rejects invalid selection input and keeps awaiting user", async () => {
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      if (params.metadataFilter.document_type === "use_case_document") {
        return [
          {
            document_id: "u2",
            document_type: "use_case_document",
            content: { use_case_text: "Automate compliance reporting" },
            metadata: { use_case_text: "Automate compliance reporting" },
            relationships: {},
            similarity: 0.86,
          },
        ];
      }
      return [];
    };

    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s-usecase-2" });
    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
    const afterRole = await runTurn(graphApp, afterIndustry, "Director of IT");
    const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
    const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "6 months");
    const afterKycConfirm = await runTurn(graphApp, afterTimeframe, "yes");
    const afterInvalid = await runTurn(graphApp, afterKycConfirm, "1,4x");

    expect(afterInvalid.session_context.awaiting_user).toBe(true);
    expect(afterInvalid.session_context.last_question_key).toBe("S3_USE_CASE_SELECT");
    const lastAi = lastAIMessage(afterInvalid)?.content?.toString() ?? "";
    expect(lastAi).toContain("Please reply using only the number(s) shown in the list.");
  });

  it("stores selected use cases after valid selection", async () => {
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      if (params.metadataFilter.document_type === "use_case_document") {
        return [
          {
            document_id: "u3",
            document_type: "use_case_document",
            content: { use_case_text: "Reduce storage costs" },
            metadata: { use_case_text: "Reduce storage costs" },
            relationships: {},
            similarity: 0.9,
          },
        ];
      }
      if (params.metadataFilter.document_type === "use_cases_questions_document") {
        return [
          {
            document_id: "q1",
            document_type: "use_cases_questions_document",
            content: { discovery_question_text: "1. First?\n2. Second?\n3. Third?" },
            metadata: {},
            relationships: {},
          },
        ];
      }
      return [];
    };

    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s-usecase-3" });
    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");
    const afterRole = await runTurn(graphApp, afterIndustry, "Director of IT");
    const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
    const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "6 months");
    const afterKycConfirm = await runTurn(graphApp, afterTimeframe, "yes");
    const afterPick = await runTurn(graphApp, afterKycConfirm, "1");

    expect(afterPick.use_case_context.selected_use_cases).toEqual(["Reduce storage costs"]);
  });
});
