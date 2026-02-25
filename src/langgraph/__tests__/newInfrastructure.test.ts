import { jest } from "@jest/globals";

let interpolate: typeof import("../utilities.js").interpolate;
let configString: typeof import("../utilities.js").configString;
let buildDeterministicScores: typeof import("../utilities.js").buildDeterministicScores;
let buildFallbackFromSchema: typeof import("../utilities.js").buildFallbackFromSchema;
let setGraphMessagingConfig: typeof import("../utilities.js").setGraphMessagingConfig;
let clearGraphMessagingConfig: typeof import("../utilities.js").clearGraphMessagingConfig;
let createInitialState: typeof import("../graph.js").createInitialState;

beforeAll(async () => {
  ({ interpolate, configString, buildDeterministicScores, buildFallbackFromSchema, setGraphMessagingConfig, clearGraphMessagingConfig } =
    await import("../utilities.js"));
  ({ createInitialState } = await import("../graph.js"));
});

describe("interpolate", () => {
  it("replaces known placeholders", () => {
    expect(interpolate("Hello {{name}}, welcome to {{place}}!", { name: "Alex", place: "NYC" })).toBe(
      "Hello Alex, welcome to NYC!"
    );
  });

  it("leaves unknown placeholders intact", () => {
    expect(interpolate("Hi {{name}}, {{unknown}} here", { name: "Pat" })).toBe("Hi Pat, {{unknown}} here");
  });

  it("handles empty vars", () => {
    expect(interpolate("No vars {{here}}", {})).toBe("No vars {{here}}");
  });

  it("handles template with no placeholders", () => {
    expect(interpolate("Plain text", { key: "value" })).toBe("Plain text");
  });
});

describe("configString", () => {
  beforeEach(() => {
    clearGraphMessagingConfig();
  });

  it("returns fallback when config is not set", () => {
    expect(configString("step1.greet", "fallback")).toBe("fallback");
  });

  it("returns config value when set", () => {
    setGraphMessagingConfig({
      strings: { "step1.greet": "Hello from config!" },
      exampleGenerator: () => [],
      overlayPrefix: () => "",
      clarifierRetryText: { step1Ready: "", step2ConfirmPlan: "", step2Obstacle: "" },
      clarificationAcknowledgement: [],
      messagePolicy: {} as any,
      aiPrompts: {} as any,
    });
    expect(configString("step1.greet", "fallback")).toBe("Hello from config!");
  });

  it("returns fallback for missing key even when config is set", () => {
    expect(configString("nonexistent.key", "fallback")).toBe("fallback");
  });
});

describe("buildDeterministicScores", () => {
  it("scores items based on vector similarity", () => {
    const results = [
      { content: { use_case_text: "Case A" }, metadata: {}, similarity: 0.95 },
      { content: { use_case_text: "Case B" }, metadata: {}, similarity: 0.8 },
    ];
    const scores = buildDeterministicScores(results, ["Case A", "Case B", "Case C"]);
    expect(scores[0]).toEqual({ name: "Case A", score: 95 });
    expect(scores[1]).toEqual({ name: "Case B", score: 80 });
    expect(scores[2].name).toBe("Case C");
    expect(scores[2].score).toBeGreaterThan(0);
  });

  it("limits to max items", () => {
    const results = [{ content: { use_case_text: "A" }, metadata: {}, similarity: 0.9 }];
    const scores = buildDeterministicScores(results, ["A", "B", "C", "D", "E"], { max: 2 });
    expect(scores).toHaveLength(2);
  });

  it("uses fallback scores when no similarity match", () => {
    const scores = buildDeterministicScores([], ["X", "Y"]);
    expect(scores[0]).toEqual({ name: "X", score: 100 });
    expect(scores[1]).toEqual({ name: "Y", score: 90 });
  });
});

describe("buildFallbackFromSchema", () => {
  it("builds a complete fallback analysis structure", () => {
    const state = createInitialState({ sessionId: "test" });
    state.user_context.goal_statement = "Reduce costs";
    state.user_context.timeframe = "6 months";
    state.user_context.persona_role = "CTO";
    state.user_context.industry = "Finance";

    const result = buildFallbackFromSchema(state, ["Pillar A", "Pillar B"]);

    expect(result.analysis_version).toBe("1.0");
    expect(result.overall_posture).toBe("Managed");
    expect(result.highest_business_outcome).toBe("Reduce costs");
    expect(Array.isArray(result.selected_solution_areas)).toBe(true);
    const areas = result.selected_solution_areas as Array<Record<string, unknown>>;
    expect(areas).toHaveLength(2);
    expect(areas[0].pillar_name).toBe("Pillar A");
    expect(areas[0].timeline_alignment).toBe("6 months");
    expect(areas[1].pillar_name).toBe("Pillar B");
  });

  it("uses default value for missing fields", () => {
    const state = createInitialState({ sessionId: "test2" });
    const result = buildFallbackFromSchema(state, ["P1"]);
    expect(result.highest_business_outcome).toBe("Not provided in today's conversation");
    const inputs = result.final_thoughts_inputs as Record<string, unknown>;
    expect(inputs.persona).toBe("Not provided in today's conversation");
  });
});
