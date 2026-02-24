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
  globalThis.__assessRiskOverride = undefined;
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

describe("nodeBuildReadout", () => {
  it("retrieves readout documents across required types and stores canonical outputs", async () => {
    const calls: Array<Record<string, unknown>> = [];
    globalThis.__mockPillarsForOutcome = ["Resilience", "Automation"];
    globalThis.__determineUseCaseQuestionsOverride = ["Question A", "Question B", "Question C"];
    globalThis.__mockSearchSupabaseVectors = async (params) => {
      calls.push({
        tenantId: params.tenantId,
        docTypes: params.docTypes,
        metadataFilter: params.metadataFilter,
      });
      const docType = params.metadataFilter.document_type;
      if (docType === "use_case_document") {
        return [
          {
            document_id: "u1",
            document_type: "use_case_document",
            content: { use_case_text: "Modernize data workflows" },
            metadata: { use_case_text: "Modernize data workflows" },
            relationships: {},
            similarity: 0.95,
          },
        ];
      }
      if (docType === "use_cases_questions_document") {
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
      if (docType === "market_segment_use_case_group_document") {
        return [
          {
            document_id: "m1",
            document_type: "market_segment_use_case_group_document",
            content: { segment_name: "Segment A", scope_profile: "Scope A" },
            metadata: { segment_name: "Segment A", scope_profile: "Scope A" },
            relationships: {},
          },
        ];
      }
      return [
        {
          document_id: `${String(docType)}-${String(params.metadataFilter.pillar_name ?? "none")}`,
          document_type: String(docType),
          content: { text: "verified context" },
          metadata: {
            tenant_id: params.metadataFilter.tenant_id,
            document_type: docType,
            pillar_name: params.metadataFilter.pillar_name ?? null,
            "Capability Cluster": "Resilience",
            G_Feature: "Feature X",
            G_Cap: "Capability Y",
          },
          relationships: {},
          similarity: 0.91,
        },
      ];
    };

    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "s-readout-1" });
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
    const afterDiscoveryStart = await runTurn(graphApp, afterUseCaseSelection, undefined);
    const afterFirst = await runTurn(graphApp, afterDiscoveryStart, "First response");
    const afterSecond = await runTurn(graphApp, afterFirst, "Second response");
    const afterThird = await runTurn(graphApp, afterSecond, "Third response");
    const afterReadout = await runTurn(graphApp, afterThird, "continue");

    expect(afterReadout.readout_context.status).toBe("ready");
    expect(afterReadout.readout_context.canonical.document_id).toContain("s-readout-1-readout");
    expect(afterReadout.readout_context.rendered_outputs.markdown).toContain("framing_header");
    expect(afterReadout.readout_context.delivery.download.status).toBe("ready");
    expect(afterReadout.readout_context.delivery.download.url).toBe("/readout/s-readout-1.md");

    const readoutDocTypes = new Set(
      calls
        .map((call) => (call.metadataFilter as Record<string, unknown>)?.document_type)
        .filter((value) =>
          [
            "outcome_posture_document",
            "pillar_readiness_path_document",
            "capability_to_pillar_document",
            "feature_capability_mapping_document",
          ].includes(String(value))
        )
        .map(String)
    );
    expect(readoutDocTypes).toEqual(
      new Set([
        "outcome_posture_document",
        "pillar_readiness_path_document",
        "capability_to_pillar_document",
        "feature_capability_mapping_document",
      ])
    );
  });
});
