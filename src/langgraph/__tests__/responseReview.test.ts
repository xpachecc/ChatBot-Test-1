import { jest } from "@jest/globals";
import { AIMessage } from "@langchain/core/messages";

let createInitialState: typeof import("../graph.js").createInitialState;
let runTurn: typeof import("../graph.js").runTurn;
let lastAIMessage: typeof import("../infra.js").lastAIMessage;
let setGraphMessagingConfig: typeof import("../infra.js").setGraphMessagingConfig;

const testGraphMessagingConfig = {
  exampleGenerator: () => [],
  overlayPrefix: () => "",
  clarifierRetryText: {
    step1Ready: "Please answer with yes or no.",
    step2ConfirmPlan: "Please provide a short focus area.",
    step2Obstacle: "Please pick the biggest obstacle.",
  },
  clarificationAcknowledgement: ["Thank you for the clarification.", "Understood", "Noted."],
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

describe("response review", () => {
  beforeAll(async () => {
    ({ createInitialState, runTurn } = await import("../graph.js"));
    ({ lastAIMessage, setGraphMessagingConfig } = await import("../infra.js"));
    setGraphMessagingConfig(testGraphMessagingConfig);
  });

  it("rewrites clarifier messages when API key is available", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    (globalThis as any).__chatOpenAIMockContent = "Corrected response.";
    const initial = createInitialState({ sessionId: "s1" });
    const graphApp = {
      invoke: async (input: any) => ({
        ...input,
        messages: [
          ...input.messages,
          new AIMessage({ content: "Raw clarifier response.", additional_kwargs: { message_type: "industryClarifier" } }),
        ],
      }),
    };

    const afterInit = await runTurn(graphApp, initial, undefined);
    const lastAi = lastAIMessage(afterInit)?.content?.toString() ?? "";
    expect(lastAi).toBe("Corrected response.");
  });

  it("skips AI review for scripted messages", async () => {
    delete process.env.OPENAI_API_KEY;
    (globalThis as any).__chatOpenAIMockContent = "";
    const initial = createInitialState({ sessionId: "s2" });
    const graphApp = {
      invoke: async (input: any) => ({
        ...input,
        messages: [
          ...input.messages,
          new AIMessage({ content: "Intro text.", additional_kwargs: { message_type: "intro" } }),
        ],
      }),
    };

    const afterInit = await runTurn(graphApp, initial, undefined);
    const lastAi = lastAIMessage(afterInit)?.content?.toString() ?? "";
    expect(lastAi).toBe("Intro text.");
  });

  it("acknowledges clarification responses", async () => {
    delete process.env.OPENAI_API_KEY;
    (globalThis as any).__chatOpenAIMockContent = "";
    const graphApp = {
      invoke: async (input: any) => ({
        ...input,
        messages: [...input.messages, new AIMessage({ content: "Next question." })],
      }),
    };
    const initial = createInitialState({ sessionId: "s3" });

    const afterInit = await runTurn(graphApp, initial, undefined);
    const clarifierState = {
      ...afterInit,
      session_context: {
        ...afterInit.session_context,
        awaiting_user: true,
        last_question_key: "S1_NAME",
        step_clarifier_used: true,
      },
    };
    const afterClarification = await runTurn(graphApp, clarifierState, "Alex");
    const lastAi = lastAIMessage(afterClarification)?.content?.toString() ?? "";
    expect(
      ["Thank you for the clarification.", "Understood", "Noted."].some((ack) => lastAi.startsWith(`${ack} `))
    ).toBe(true);
  });
});
