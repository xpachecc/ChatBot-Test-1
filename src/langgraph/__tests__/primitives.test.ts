import { CfsStateSchema, PrimitivesInstance, selectMarketSegment, selectPersonaGroup, setGraphMessagingConfig } from "../infra.js";

const testGraphMessagingConfig = {
  exampleGenerator: () => [],
  overlayPrefix: () => "",
  clarifierRetryText: {
    step1Ready: "Please answer with yes or no.",
    step2ConfirmPlan: "Please provide a short focus area.",
    step2Obstacle: "Please pick the biggest obstacle.",
  },
  clarificationAcknowledgement: "Thank you for the clarification.",
  messagePolicy: {
    intro: { allowAIRephrase: false, forbidFirstPerson: false },
    name: { allowAIRephrase: false, forbidFirstPerson: false },
    industry: { allowAIRephrase: false, forbidFirstPerson: false },
    role: { allowAIRephrase: false, forbidFirstPerson: false },
    industryClarifier: { allowAIRephrase: true, forbidFirstPerson: true },
    roleClarifier: { allowAIRephrase: true, forbidFirstPerson: true },
    default: { allowAIRephrase: false, forbidFirstPerson: false },
  },
  aiPrompts: {
    selectPersonaGroup: "Select a persona_group and return JSON.",
    selectMarketSegment: "Select a market_segment and return JSON.",
    selectUseCaseGroups: "Select use_case_groups and return JSON.",
    selectOutcomeName: "Select an outcome_name and return the string only.",
    selectPillars: "Select pillar names and return JSON.",
    sanitizeUserInput: "Sanitize user input and return only the cleaned value.",
    reviewResponse: "Review responses and fix grammar/spelling only.",
    assessRisk: "Assess risk and return JSON only.",
  },
};

beforeAll(() => {
  setGraphMessagingConfig(testGraphMessagingConfig);
});

describe("primitives", () => {
  it("AskQuestion pushes question and sets awaiting_user", () => {
    const state = CfsStateSchema.parse({
      session_context: { session_id: "s1", step_clarifier_used: false },
      user_context: { industry: "Technology", persona_role: "CTO" },
    });

    const result = PrimitivesInstance.AskQuestion.run(state, {
      question: "What is your primary goal?",
      questionKey: "S1_GOAL",
      questionPurpose: "collect_goal",
      targetVariable: "goal",
    });

    expect(result.session_context?.awaiting_user).toBe(true);
    expect(result.session_context?.last_question_key).toBe("S1_GOAL");
    expect(result.messages?.length).toBe(1);
  });

  it("CaptureObjective stores normalized objective", () => {
    const state = CfsStateSchema.parse({
      session_context: { session_id: "s1" },
    });

    const result = PrimitivesInstance.CaptureObjective.run(state, { rawGoal: "Reduce cost of operations" });
    expect(result.use_case_context?.objective_normalized).toBe("Reduce cost of operations");
  });

  it("selectPersonaGroup falls back to closest non-default without AI", async () => {
    const result = await selectPersonaGroup({
      role: "Operations Lead",
      snippets: ["Ops workflows"],
      personaGroups: ["Default", "Operations", "Engineering"],
    });

    expect(result.persona_group).toBe("Operations");
  });

  it("selectMarketSegment falls back to first segment without AI", async () => {
    const result = await selectMarketSegment({
      industry: "Healthcare",
      snippets: ["Hospital operations"],
      segments: [
        { segment_name: "Segment A", scope_profile: "Scope A" },
        { segment_name: "Segment B", scope_profile: "Scope B" },
      ],
    });

    expect(result.segment_name).toBe("Segment A");
  });
});
