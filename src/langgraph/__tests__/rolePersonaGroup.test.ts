import { jest } from "@jest/globals";

let buildCfsGraph: typeof import("../graph.js").buildCfsGraph;
let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;

beforeAll(async () => {
  ({ buildCfsGraph, createInitialState, runTurn } = await import("../graph.js"));
});

describe("role persona group selection", () => {
  it("stores persona_clarified_role and persona_group", async () => {
    delete process.env.OPENAI_API_KEY;
    globalThis.__mockSearchSupabaseVectors = async () => [
      {
        document_id: "p1",
        document_type: "persona_usecase_document",
        content: { title: "VP Operations" },
        metadata: { title: "VP Operations" },
        relationships: {},
        similarity: 0.92,
      },
      {
        document_id: "p2",
        document_type: "persona_usecase_document",
        content: { title: "Director of Infrastructure" },
        metadata: { title: "Director of Infrastructure" },
        relationships: {},
        similarity: 0.9,
      },
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

    expect(afterRole.user_context.persona_clarified_role).toBe("VP Operations");
    expect(afterRole.user_context.persona_group).toBe("Ops Leader");
    expect(afterRole.user_context.persona_group_confidence).toBe(0.2);
    expect(afterRole.session_context.last_question_key).toBe("CONFIRM_ROLE");
    globalThis.__mockSearchSupabaseVectors = undefined;
    globalThis.__mockPersonaGroups = undefined;
  });
});
