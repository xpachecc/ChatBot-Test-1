import { jest } from "@jest/globals";

jest.unstable_mockModule("../core/services/persona-groups.js", () => ({
  getUseCaseGroups: jest.fn(async () => [
    "Data Governance",
    "Cloud Migration",
    "Data Analytics",
  ]),
  getPersonaGroups: jest.fn(async () => []),
}));

const { CfsStateSchema } = await import("../state.js");
const { getOptionsForQuestionKey } = await import("../flows/chat-options.js");
const { computeFlowProgress } = await import("../infra.js");
const { setGraphMessagingConfig, clearGraphMessagingConfig } = await import("../core/config/messaging.js");

function makeState(overrides: Record<string, unknown> = {}) {
  return CfsStateSchema.parse({
    messages: [],
    session_context: {
      session_id: "test",
      step: "STEP1_KNOW_YOUR_CUSTOMER",
      ...(overrides.session_context as Record<string, unknown> ?? {}),
    },
    ...(overrides.use_case_context ? { use_case_context: overrides.use_case_context } : {}),
    ...(overrides.readout_context ? { readout_context: overrides.readout_context } : {}),
  });
}

describe("getOptionsForQuestionKey", () => {
  it("returns null when questionKey is null", async () => {
    const state = makeState();
    expect(await getOptionsForQuestionKey(null, state)).toBeNull();
  });

  it("returns Yes/No for CONFIRM_START", async () => {
    const state = makeState();
    const result = await getOptionsForQuestionKey("CONFIRM_START", state);
    expect(result).toEqual({ items: ["Yes", "No"] });
  });

  it("returns options for CONFIRM_ROLE", async () => {
    const state = makeState();
    const result = await getOptionsForQuestionKey("CONFIRM_ROLE", state);
    expect(result).not.toBeNull();
    expect(result!.items.length).toBe(2);
  });

  it("returns options for S1_KYC_CONFIRM", async () => {
    const state = makeState();
    const result = await getOptionsForQuestionKey("S1_KYC_CONFIRM", state);
    expect(result).not.toBeNull();
    expect(result!.items).toContain("Yes, let's continue");
  });

  it("returns timeframe options for S1_TIMEFRAME", async () => {
    const state = makeState();
    const result = await getOptionsForQuestionKey("S1_TIMEFRAME", state);
    expect(result).not.toBeNull();
    expect(result!.items).toContain("6 months");
    expect(result!.items).toContain("12 months");
  });

  it("returns dynamic use case options for S3_USE_CASE_SELECT", async () => {
    const state = makeState({
      use_case_context: {
        use_cases_prioritized: [
          { name: "Unified Data Platform", rank_score: 90 },
          { name: "Cloud Migration", rank_score: 80 },
        ],
      },
    });
    const result = await getOptionsForQuestionKey("S3_USE_CASE_SELECT", state);
    expect(result).not.toBeNull();
    expect(result!.items.length).toBe(2);
    expect(result!.items[0]).toContain("Unified Data Platform");
  });

  it("returns null for S3_USE_CASE_SELECT with empty prioritized list", async () => {
    const state = makeState();
    const result = await getOptionsForQuestionKey("S3_USE_CASE_SELECT", state);
    expect(result).toBeNull();
  });

  it("returns use case groups from database for S1_USE_CASE_GROUP", async () => {
    const state = makeState();
    const result = await getOptionsForQuestionKey("S1_USE_CASE_GROUP", state);
    expect(result).not.toBeNull();
    expect(result!.items).toEqual(["Data Governance", "Cloud Migration", "Data Analytics"]);
  });

  it("returns null for discovery questions (free text)", async () => {
    const state = makeState();
    expect(await getOptionsForQuestionKey("S3_DISCOVERY_QUESTION", state)).toBeNull();
  });

  it("returns null for unknown question keys", async () => {
    const state = makeState();
    expect(await getOptionsForQuestionKey("UNKNOWN_KEY", state)).toBeNull();
  });

  it("prefers config.options over STATIC_OPTIONS when set", async () => {
    setGraphMessagingConfig({
      options: { CONFIRM_START: ["Oui", "Non"] },
      exampleGenerator: () => [],
      overlayPrefix: () => "",
      clarifierRetryText: { step1Ready: "", step2ConfirmPlan: "", step2Obstacle: "" },
      clarificationAcknowledgement: [],
      messagePolicy: {} as any,
      aiPrompts: {} as any,
    });
    try {
      const state = makeState();
      const result = await getOptionsForQuestionKey("CONFIRM_START", state);
      expect(result).toEqual({ items: ["Oui", "Non"] });
    } finally {
      clearGraphMessagingConfig();
    }
  });

  it("prefers session_context.suggested_options over config", async () => {
    setGraphMessagingConfig({
      options: { CONFIRM_START: ["From config"] },
      exampleGenerator: () => [],
      overlayPrefix: () => "",
      clarifierRetryText: { step1Ready: "", step2ConfirmPlan: "", step2Obstacle: "" },
      clarificationAcknowledgement: [],
      messagePolicy: {} as any,
      aiPrompts: {} as any,
    });
    try {
      const state = makeState({
        session_context: {
          session_id: "test",
          step: "STEP1_KNOW_YOUR_CUSTOMER",
          suggested_options: { CONFIRM_START: ["From state"] },
        },
      });
      const result = await getOptionsForQuestionKey("CONFIRM_START", state);
      expect(result).toEqual({ items: ["From state"] });
    } finally {
      clearGraphMessagingConfig();
    }
  });
});

describe("computeFlowProgress edge cases", () => {
  it("clamps answeredQuestions to totalQuestions", () => {
    const state = makeState({
      session_context: {
        session_id: "test",
        step: "STEP1_KNOW_YOUR_CUSTOMER",
        last_question_key: "S1_KYC_CONFIRM",
      },
    });
    const progress = computeFlowProgress(state);
    const step1 = progress.steps.find((s) => s.key === "STEP1_KNOW_YOUR_CUSTOMER");
    expect(step1).toBeDefined();
    expect(step1!.answeredQuestions).toBeLessThanOrEqual(step1!.totalQuestions);
    expect(step1!.percentage).toBeLessThanOrEqual(100);
    expect(step1!.percentage).toBeGreaterThanOrEqual(0);
  });

  it("handles step4 progress: 0% when readout not ready, 100% when ready", () => {
    const stateInProgress = makeState({
      session_context: {
        session_id: "test",
        step: "STEP4_BUILD_READOUT",
      },
    });
    const progressInProgress = computeFlowProgress(stateInProgress);
    const step4InProgress = progressInProgress.steps.find((s) => s.key === "STEP4_BUILD_READOUT");
    expect(step4InProgress).toBeDefined();
    expect(step4InProgress!.percentage).toBe(0);
    expect(step4InProgress!.countable).toBe(true);
    expect(step4InProgress!.label).toBe("Build Readout");

    const stateComplete = makeState({
      session_context: { session_id: "test", step: "STEP4_BUILD_READOUT" },
      readout_context: { status: "ready" },
    });
    const progressComplete = computeFlowProgress(stateComplete);
    const step4Complete = progressComplete.steps.find((s) => s.key === "STEP4_BUILD_READOUT");
    expect(step4Complete!.percentage).toBe(100);
  });

  it("handles step5 progress: 0% when readout not ready, 100% when ready", () => {
    const stateInProgress = makeState({
      session_context: { session_id: "test", step: "STEP5_READOUT_SUMMARY_NEXT_STEPS" },
    });
    const progressInProgress = computeFlowProgress(stateInProgress);
    const step5InProgress = progressInProgress.steps.find((s) => s.key === "STEP5_READOUT_SUMMARY_NEXT_STEPS");
    expect(step5InProgress).toBeDefined();
    expect(step5InProgress!.percentage).toBe(0);
    expect(step5InProgress!.label).toBe("Readout Summary and Next Steps");

    const stateComplete = makeState({
      session_context: { session_id: "test", step: "STEP5_READOUT_SUMMARY_NEXT_STEPS" },
      readout_context: { status: "ready" },
    });
    const progressComplete = computeFlowProgress(stateComplete);
    const step5Complete = progressComplete.steps.find((s) => s.key === "STEP5_READOUT_SUMMARY_NEXT_STEPS");
    expect(step5Complete!.percentage).toBe(100);
  });

  it("returns valid flowTitle and flowDescription", () => {
    const state = makeState();
    const progress = computeFlowProgress(state);
    expect(progress.flowTitle).toBeTruthy();
    expect(progress.flowDescription).toBeTruthy();
    expect(progress.steps.length).toBe(5);
  });

  it("marks completed steps correctly", () => {
    const state = makeState({
      session_context: {
        session_id: "test",
        step: "STEP3_PERFORM_DISCOVERY",
      },
    });
    const progress = computeFlowProgress(state);
    expect(progress.steps[0].status).toBe("completed");
    expect(progress.steps[1].status).toBe("completed");
    expect(progress.steps[2].status).toBe("in_progress");
    expect(progress.steps[3].status).toBe("upcoming");
    expect(progress.steps[4].status).toBe("upcoming");
  });
});
