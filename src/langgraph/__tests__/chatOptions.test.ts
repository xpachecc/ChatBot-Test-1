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
const { getOptionsForQuestionKey } = await import("../core/options/resolve-options.js");
const { computeFlowProgress } = await import("../infra.js");
const { setGraphMessagingConfig, clearGraphMessagingConfig } = await import("../core/config/messaging.js");

const { afterEach, beforeEach } = await import("@jest/globals");

const DEFAULT_CONFIG = {
  options: {
    CONFIRM_START: ["Yes", "No"],
    CONFIRM_ROLE: ["Yes, that's correct", "No, let me clarify"],
    S1_KYC_CONFIRM: ["Yes, let's continue", "No"],
    S1_TIMEFRAME: ["6 months", "12 months"],
  },
  dynamicOptions: {
    S1_USE_CASE_GROUP: { source: "service" as const, serviceRef: "persona-groups.getUseCaseGroups" },
    S3_USE_CASE_SELECT: {
      source: "state" as const,
      statePath: "use_case_context.use_cases_prioritized",
      format: "numbered_list" as const,
    },
  },
  exampleGenerator: () => [] as string[],
  overlayPrefix: () => "",
  clarifierRetryText: { step1Ready: "", step2ConfirmPlan: "", step2Obstacle: "" },
  clarificationAcknowledgement: [] as string[],
  messagePolicy: {} as any,
  aiPrompts: {} as any,
  meta: {
    flowTitle: "Discovery Account Executive",
    flowDescription: "This automated assessment analyzes your needs.",
    steps: [
      { key: "STEP1_KNOW_YOUR_CUSTOMER", label: "Know Your Customer", order: 1, countable: true, totalQuestions: 6, countingStrategy: "questionKeyMap" as const },
      { key: "STEP2_NARROW_DOWN_USE_CASES", label: "Narrow Down Use Cases", order: 2, countable: true, totalQuestions: 1, countingStrategy: "useCaseSelect" as const },
      { key: "STEP3_PERFORM_DISCOVERY", label: "Perform Discovery", order: 3, countable: true, totalQuestions: 3, countingStrategy: "dynamicCount" as const },
      { key: "STEP4_BUILD_READOUT", label: "Build Readout", order: 4, countable: true, totalQuestions: 1, countingStrategy: "readoutReady" as const },
      { key: "STEP5_READOUT_SUMMARY_NEXT_STEPS", label: "Readout Summary and Next Steps", order: 5, countable: true, totalQuestions: 1, countingStrategy: "readoutReady" as const },
    ],
  },
  progressRules: {
    questionKeyMap: {
      S1_USE_CASE_GROUP: 0,
      CONFIRM_START: 1,
      S1_NAME: 1,
      S1_INDUSTRY: 2,
      S1_INTERNET_SEARCH: 2,
      S1_ROLE: 3,
      CONFIRM_ROLE: 4,
      S1_TIMEFRAME: 4,
      S1_KYC_CONFIRM: 5,
    },
    dynamicCountField: "use_case_context.discovery_questions",
    dynamicCountStepKey: "STEP3_PERFORM_DISCOVERY",
    useCaseSelectQuestionKey: "S3_USE_CASE_SELECT",
  },
};

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
  beforeEach(() => {
    setGraphMessagingConfig(DEFAULT_CONFIG);
  });
  afterEach(() => {
    clearGraphMessagingConfig();
  });
  it("returns null when questionKey is null and no continuation trigger matches", async () => {
    const state = makeState();
    expect(await getOptionsForQuestionKey(null, state)).toBeNull();
  });

  it("returns continuation trigger items when questionKey is null and state matches", async () => {
    setGraphMessagingConfig({
      ...DEFAULT_CONFIG,
      continuationTriggers: [
        {
          traceIncludes: "ask_use_case_questions:complete",
          notReadoutReady: true,
          steps: ["STEP3_PERFORM_DISCOVERY", "STEP4_BUILD_READOUT"],
          items: ["Continue to readout"],
        },
      ],
    });
    const state = makeState({
      session_context: {
        session_id: "test",
        step: "STEP3_PERFORM_DISCOVERY",
        awaiting_user: false,
        reason_trace: ["ask_use_case_questions:complete"],
      },
    });
    const result = await getOptionsForQuestionKey(null, state);
    expect(result).toEqual({ items: ["Continue to readout"] });
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

  it("prefers config.options when set", async () => {
    setGraphMessagingConfig({
      ...DEFAULT_CONFIG,
      options: { CONFIRM_START: ["Oui", "Non"] },
    });
    const state = makeState();
    const result = await getOptionsForQuestionKey("CONFIRM_START", state);
    expect(result).toEqual({ items: ["Oui", "Non"] });
  });

  it("prefers session_context.suggested_options over config", async () => {
    const state = makeState({
      session_context: {
        session_id: "test",
        step: "STEP1_KNOW_YOUR_CUSTOMER",
        suggested_options: { CONFIRM_START: ["From state"] },
      },
    });
    const result = await getOptionsForQuestionKey("CONFIRM_START", state);
    expect(result).toEqual({ items: ["From state"] });
  });
});

describe("computeFlowProgress edge cases", () => {
  beforeEach(() => {
    setGraphMessagingConfig(DEFAULT_CONFIG);
  });
  afterEach(() => {
    clearGraphMessagingConfig();
  });

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
