import { buildCfsGraph, createInitialState, runTurn } from "../graph.js";
import { lastAIMessage } from "../infra.js";

describe("step flow init options", () => {
  it("stores selected use case group before Step 1", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s1" });

    const afterInit = await runTurn(graphApp, initial, undefined);
    expect(afterInit.session_context.last_question_key).toBe("S1_USE_CASE_GROUP");

    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    expect(afterSelection.use_case_context.use_case_groups).toEqual(["Data governance"]);
    expect(afterSelection.session_context.last_question_key).toBe("CONFIRM_START");
    expect(afterSelection.session_context.awaiting_user).toBe(true);
    const lastAi = lastAIMessage(afterSelection)?.content?.toString() ?? "";
    expect(lastAi).toContain("Ready to dive in?");
    expect(lastAi).not.toContain("To stay aligned");

    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const confirmAi = lastAIMessage(afterConfirm)?.content?.toString() ?? "";
    expect(confirmAi).toBe("Before we get started, what's your first name?");
    expect(afterConfirm.session_context.last_question_key).toBe("S1_NAME");
    expect(afterConfirm.session_context.awaiting_user).toBe(true);

    const afterName = await runTurn(graphApp, afterConfirm, "Alex");
    expect(afterName.user_context.first_name).toBe("Alex");
    expect(afterName.session_context.last_question_key).toBe("S1_INDUSTRY");
    expect(afterName.session_context.awaiting_user).toBe(true);
    const industryPrompt = lastAIMessage(afterName)?.content?.toString() ?? "";
    expect(industryPrompt).toContain("What industry and specialized focus are you solving for?");
  });

  it("stores market segment after industry confirmation", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s2" });
    const originalMock = globalThis.__mockSearchSupabaseVectors;
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    globalThis.__mockSearchSupabaseVectors = async () => [
      {
        document_id: "seg-1",
        document_type: "market_segment_use_case_group_document",
        content: { segment_name: "Segment A", scope_profile: "Scope A" },
        metadata: { segment_name: "Segment A", scope_profile: "Scope A" },
        relationships: {},
        similarity: 0.9,
      },
    ];
    try {
      const afterInit = await runTurn(graphApp, initial, undefined);
      const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
      const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
      const afterName = await runTurn(graphApp, afterConfirm, "Alex");
      const afterIndustry = await runTurn(graphApp, afterName, "Healthcare IT");
      expect(afterIndustry.user_context.market_segment).toBe("Segment A");
    } finally {
      globalThis.__mockSearchSupabaseVectors = originalMock;
      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });

});
