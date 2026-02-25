import { CfsStateSchema } from "../infra.js";
import { buildQuerySignature, buildVectorFilters } from "../core/services/vector.js";

describe("vector helpers", () => {
  it("builds tenant-scoped filters with available fields", () => {
    const state = CfsStateSchema.parse({
      session_context: { session_id: "s1", tenant_id: "t1" },
      user_context: { persona_role: "Analytics Lead", industry: "Data / AI / Analytics", timeframe: "Q1" },
      use_case_context: { objective_normalized: "Improve analytics ROI" },
    });

    const filters = buildVectorFilters(state, ["use_case_document", "persona_document"]);

    expect(filters).toMatchObject({
      tenantId: "t1",
      docTypes: ["use_case_document", "persona_document"],
      metadataFilter: {
        persona_role: "Analytics Lead",
        industry: "Data / AI / Analytics",
        use_case_text: "Improve analytics ROI",
        timeframe: "Q1",
      },
      relationshipsFilter: {},
    });
  });

  it("changes signature when filters change", () => {
    const queryText = "role | industry | goal";
    const filtersA = { tenantId: "t1", docTypes: ["use_case_document"], metadataFilter: {}, relationshipsFilter: {} };
    const filtersB = { tenantId: "t1", docTypes: ["persona_document"], metadataFilter: {}, relationshipsFilter: {} };

    const sigA = buildQuerySignature(queryText, filtersA);
    const sigB = buildQuerySignature(queryText, filtersB);

    expect(sigA).not.toEqual(sigB);
  });
});
