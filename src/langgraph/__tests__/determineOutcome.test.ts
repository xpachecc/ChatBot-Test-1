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
  globalThis.__mockPersonaGroups = ["IT Leader"];
});

afterEach(() => {
  globalThis.__mockSearchSupabaseVectors = undefined;
  globalThis.__mockPersonaGroups = undefined;
});

describe("nodeDetermineOutcome", () => {
  it("selects an outcome from vector results with required filters", async () => {
    const calls: Array<{ metadataFilter: Record<string, unknown> }> = [];
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      calls.push({ metadataFilter: params.metadataFilter });
      const meta = params.metadataFilter as Record<string, unknown>;
      if (meta.document_type === "persona_usecase_document") {
        return [
          {
            document_id: "p1",
            document_type: "persona_usecase_document",
            content: "Persona example",
            metadata: {},
            relationships: {},
          },
        ];
      }
      if (meta.document_type === "market_segment_use_case_group_document" && "persona_group_name" in meta) {
        return [
          {
            document_id: "o1",
            document_type: "market_segment_use_case_group_document",
            content: { outcome_name: "Outcome Alpha" },
            metadata: { outcome_name: "Outcome Alpha" },
            relationships: {},
          },
          {
            document_id: "o2",
            document_type: "market_segment_use_case_group_document",
            content: { outcome_name: "Outcome Beta" },
            metadata: { outcome_name: "Outcome Beta" },
            relationships: {},
          },
        ];
      }
      if (meta.document_type === "market_segment_use_case_group_document") {
        return [
          {
            document_id: "m1",
            document_type: "market_segment_use_case_group_document",
            content: { segment_name: "Segment A" },
            metadata: { segment_name: "Segment A" },
            relationships: {},
          },
        ];
      }
      return [];
    };

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

    expect(afterTimeframe.user_context.outcome).toBe("Outcome Alpha");

    const outcomeCall = calls.find(
      (call) => call.metadataFilter.document_type === "market_segment_use_case_group_document" && "persona_group_name" in call.metadataFilter
    );
    expect(outcomeCall).toBeTruthy();
    expect(outcomeCall?.metadataFilter.tenant_id).toBeTruthy();
    expect(outcomeCall?.metadataFilter.persona_group_name).toBeTruthy();
    expect(outcomeCall?.metadataFilter.use_case_group_title).toBe("Data governance");
  });

  it("falls back to goal statement when no outcomes are returned", async () => {
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      const meta = params.metadataFilter as Record<string, unknown>;
      if (meta.document_type === "persona_usecase_document") {
        return [
          {
            document_id: "p1",
            document_type: "persona_usecase_document",
            content: "Persona example",
            metadata: {},
            relationships: {},
          },
        ];
      }
      if (meta.document_type === "market_segment_use_case_group_document" && "persona_group_name" in meta) {
        return [];
      }
      if (meta.document_type === "market_segment_use_case_group_document") {
        return [
          {
            document_id: "m1",
            document_type: "market_segment_use_case_group_document",
            content: { segment_name: "Segment A" },
            metadata: { segment_name: "Segment A" },
            relationships: {},
          },
        ];
      }
      return [];
    };

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

    expect(afterTimeframe.user_context.outcome).toBe("Data governance");
  });
});
