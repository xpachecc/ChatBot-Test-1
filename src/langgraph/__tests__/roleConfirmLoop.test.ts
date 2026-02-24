import { jest } from "@jest/globals";

let buildCfsGraph: typeof import("../graph.js").buildCfsGraph;
let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;
let lastAIMessage: typeof import("../infra.js").lastAIMessage;

beforeAll(async () => {
  ({ buildCfsGraph, createInitialState, runTurn } = await import("../graph.js"));
  ({ lastAIMessage } = await import("../infra.js"));
});

describe("role confirmation loop", () => {
  it("repeats on correction and exits on affirmative", async () => {
    delete process.env.OPENAI_API_KEY;
    globalThis.__mockSearchSupabaseVectors = async () => [
      { content: "VP Operations", document_id: "1", document_type: "persona_usecase_document", metadata: {}, relationships: {} },
      { content: "Director of Infrastructure", document_id: "2", document_type: "persona_usecase_document", metadata: {}, relationships: {} },
    ];
    globalThis.__mockPersonaGroups = ["Ops Leader", "IT Leader"];
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s1" });

    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    const afterIndustry = await runTurn(graphApp, afterName, "Healthcare");

    const afterRole = await runTurn(graphApp, afterIndustry, "VP Operations");
    expect(afterRole.session_context.last_question_key).toBe("CONFIRM_ROLE");
    const assessment = lastAIMessage(afterRole)?.content?.toString() ?? "";
    expect(assessment).toContain("VP Operations");

    const afterCorrection = await runTurn(graphApp, afterRole, "Director of Ops");
    const correctionAssessment = lastAIMessage(afterCorrection)?.content?.toString() ?? "";
    expect(afterCorrection.user_context.persona_clarified_role).toBe("Director of Ops");
    expect(afterCorrection.session_context.last_question_key).toBe("CONFIRM_ROLE");
    expect(correctionAssessment).toContain("Director of Ops");

    const afterYes = await runTurn(graphApp, afterCorrection, "yes");
    expect(afterYes.session_context.last_question_key).toBe("S1_TIMEFRAME");
    expect(afterYes.session_context.awaiting_user).toBe(true);

    const afterTimeframe = await runTurn(graphApp, afterYes, "12 months");
    expect(afterTimeframe.user_context.timeframe).toBe("12 months");
    // After timeframe, the graph runs the KYC echo node and prompts for confirmation.
    expect(afterTimeframe.session_context.last_question_key).toBe("S1_KYC_CONFIRM");
    expect(afterTimeframe.session_context.awaiting_user).toBe(true);
    globalThis.__mockSearchSupabaseVectors = undefined;
    globalThis.__mockPersonaGroups = undefined;
  });
});
