import { jest } from "@jest/globals";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCfsGraph, createInitialState, runTurn } from "../graph.js";
import { registerCfsHandlers, resetCfsRegistration } from "../schema/cfs-handlers.js";
import { clearRegistry, getRegisteredHandlerIds } from "../schema/handler-registry.js";
import { loadGraphDsl } from "../schema/graph-loader.js";
import { compileGraphFromDsl } from "../schema/graph-compiler.js";
import { lastAIMessage } from "../infra.js";
import { createGenericHandler } from "../schema/generic-handlers.js";
import { PARSER_REGISTRY } from "../core/primitives/compute/ai-compute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CFS_YAML = resolve(__dirname, "../../../clients/default/flows/cfs-default/flow.yaml");

beforeEach(() => {
  clearRegistry();
  resetCfsRegistration();
});

describe("generic handler: question nodes", () => {
  it("askUserName uses generic handler from YAML nodeConfig", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "gh-q1" });

    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");

    const namePrompt = lastAIMessage(afterConfirm)?.content?.toString() ?? "";
    expect(namePrompt).toBe("Before we get started, what's your first name?");
    expect(afterConfirm.session_context.last_question_key).toBe("S1_NAME");
    expect(afterConfirm.session_context.awaiting_user).toBe(true);
  });

  it("askIndustry uses generic handler with stringKeys array and interpolation", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "gh-q2" });

    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");

    const industryPrompt = lastAIMessage(afterName)?.content?.toString() ?? "";
    expect(industryPrompt).toContain("Alex");
    expect(industryPrompt).toContain("What industry and specialized focus are you solving for?");
    expect(afterName.session_context.last_question_key).toBe("S1_INDUSTRY");
  });
});

describe("generic handler: greeting node", () => {
  it("sendIntroAndAskUseCaseGroup uses generic greeting handler", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "gh-g1" });

    const afterInit = await runTurn(graphApp, initial, undefined);

    expect(afterInit.session_context.started).toBe(true);
    expect(afterInit.session_context.awaiting_user).toBe(true);
    expect(afterInit.session_context.last_question_key).toBe("S1_USE_CASE_GROUP");
    const messages = afterInit.messages.map((m: any) => m.content?.toString() ?? "");
    expect(messages.some((m: string) => m.includes("Welcome"))).toBe(true);
  });
});

describe("generic handler: ingest nodes", () => {
  it("ingestUserName stores name via generic ingest handler", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "gh-i1" });

    const afterInit = await runTurn(graphApp, initial, undefined);
    const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
    const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
    const afterName = await runTurn(graphApp, afterConfirm, "Alex");

    expect(afterName.user_context.first_name).toBe("Alex");
    expect(afterName.session_context.last_question_key).toBe("S1_INDUSTRY");
  });

  it("ingestTimeframe stores timeframe via generic ingest handler", async () => {
    const graphApp = buildCfsGraph();
    const initial = createInitialState({ sessionId: "gh-i2" });
    delete process.env.OPENAI_API_KEY;
    const originalMock = globalThis.__mockSearchSupabaseVectors;
    globalThis.__mockSearchSupabaseVectors = async () => [];

    try {
      const afterInit = await runTurn(graphApp, initial, undefined);
      const afterSelection = await runTurn(graphApp, afterInit, "Data governance");
      const afterConfirm = await runTurn(graphApp, afterSelection, "yes");
      const afterName = await runTurn(graphApp, afterConfirm, "Alex");
      const afterIndustry = await runTurn(graphApp, afterName, "Tech");
      const afterRole = await runTurn(graphApp, afterIndustry, "CTO");
      const afterConfirmRole = await runTurn(graphApp, afterRole, "yes");
      const afterTimeframe = await runTurn(graphApp, afterConfirmRole, "12 months");

      expect(afterTimeframe.user_context.timeframe).toBe("12 months");
    } finally {
      globalThis.__mockSearchSupabaseVectors = originalMock;
    }
  });
});

describe("generic handler: handlerRef precedence", () => {
  it("handlerRef takes precedence over nodeConfig when both present", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const nodeWithBoth = dsl.nodes.find((n) => n.id === "ingestIndustry");
    expect(nodeWithBoth).toBeDefined();
    expect(nodeWithBoth!.handlerRef).toBe("step1.nodeStep1Ingest");
    expect(nodeWithBoth!.nodeConfig).toBeUndefined();

    compileGraphFromDsl(dsl);
    warnSpy.mockRestore();
  });
});

describe("generic handler: aiCompute config block", () => {
  it("createGenericHandler returns a handler for aiCompute nodeConfig", () => {
    const node = {
      id: "testAiCompute",
      kind: "compute" as const,
      helperRefs: [],
      reads: [],
      writes: [],
      nodeConfig: {
        aiCompute: {
          modelAlias: "useCaseQuestions",
          systemPromptKey: "selectPillars",
          inputOverrides: { outcome: "user_context.outcome" },
          responseParser: "parsePillarsFromAi",
          outputPath: "use_case_context.pillars",
          runName: "testCompute",
        },
      },
    } as any;
    const handler = createGenericHandler(node, {} as any);
    expect(typeof handler).toBe("function");
  });

  it("PARSER_REGISTRY includes built-in parsers", () => {
    expect(PARSER_REGISTRY).toHaveProperty("parsePillarsFromAi");
    expect(PARSER_REGISTRY).toHaveProperty("parseJsonObject");
    expect(PARSER_REGISTRY).toHaveProperty("parseCompositeQuestions");
    expect(PARSER_REGISTRY).toHaveProperty("identity");
    expect(typeof PARSER_REGISTRY.identity).toBe("function");
    expect(PARSER_REGISTRY.identity("hello")).toBe("hello");
  });
});

describe("generic handler: vectorSelect config block", () => {
  it("createGenericHandler returns a handler for vectorSelect nodeConfig", () => {
    const node = {
      id: "testVectorSelect",
      kind: "compute" as const,
      helperRefs: [],
      reads: [],
      writes: [],
      nodeConfig: {
        vectorSelect: {
          retrieveRef: "retrieveOutcomeCandidates",
          outputPath: "user_context.outcome",
          runName: "testVectorSelect",
        },
      },
    } as any;
    const handler = createGenericHandler(node, {} as any);
    expect(typeof handler).toBe("function");
  });

  it("vectorSelect handler returns state with session_context patch", async () => {
    const node = {
      id: "testVs",
      kind: "compute" as const,
      helperRefs: [],
      reads: [],
      writes: [],
      nodeConfig: {
        vectorSelect: {
          retrieveRef: "testRetrieve",
          outputPath: "user_context.outcome",
        },
      },
    } as any;
    const handler = createGenericHandler(node, {} as any);
    const state = createInitialState({ sessionId: "vs-test" });
    const result = await handler(state);
    expect(result.session_context).toBeDefined();
  });
});

describe("handler registry: reduced count", () => {
  it("CFS registers fewer handlers after generic refactor", () => {
    registerCfsHandlers();
    const handlers = getRegisteredHandlerIds();
    const step1Handlers = handlers.filter((h) => h.startsWith("step1."));
    expect(step1Handlers).toContain("step1.nodeStep1Ingest");
    expect(step1Handlers).toContain("step1.nodeKnowYourCustomerEcho");
    expect(step1Handlers).toContain("step1.nodeInternetSearch");
    expect(step1Handlers).not.toContain("step1.nodeInit");
    expect(step1Handlers).not.toContain("step1.nodeAskUserName");
    expect(step1Handlers).not.toContain("step1.nodeAskIndustry");

    const step4Handlers = handlers.filter((h) => h.startsWith("step4."));
    expect(step4Handlers).toContain("step4.nodeBuildReadout");
    expect(step4Handlers).not.toContain("step4.nodeDisplayReadout");
  });
});
