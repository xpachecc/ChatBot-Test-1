import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphFromSchema, createInitialState, runTurn } from "../graph.js";
import { registerCfsHandlers, resetCfsRegistration } from "../schema/cfs-handlers.js";
import { clearRegistry, getRegisteredHandlerIds, getRegisteredRouterIds, getRegisteredConfigFnIds } from "../schema/handler-registry.js";
import { loadGraphDsl, parseGraphDslFromText } from "../schema/graph-loader.js";
import { compileGraphFromDsl, buildGraphMessagingConfigFromDsl } from "../schema/graph-compiler.js";
import { lastAIMessage } from "../infra.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CFS_YAML = resolve(__dirname, "../../../graphs/cfs.flow.yaml");

beforeEach(() => {
  clearRegistry();
  resetCfsRegistration();
});

// ---------------------------------------------------------------------------
// 1. DSL Schema Validation
// ---------------------------------------------------------------------------
describe("GraphDSL schema validation", () => {
  it("parses the CFS YAML without errors", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    expect(dsl.graph.graphId).toBe("cfs");
    expect(dsl.graph.entrypoint).toBe("routeInitFlow");
    expect(dsl.nodes.length).toBeGreaterThan(0);
  });

  it("rejects YAML missing required graph fields", () => {
    const bad = `
nodes:
  - id: a
    kind: router
    handlerRef: "x"
transitions: {}
stateContractRef: "state.CfsStateSchema"
`;
    expect(() => parseGraphDslFromText(bad)).toThrow();
  });

  it("rejects YAML with unknown node kind", () => {
    const bad = `
graph:
  graphId: test
  version: "1.0"
  entrypoint: a
stateContractRef: "state.CfsStateSchema"
nodes:
  - id: a
    kind: unknownKind
    handlerRef: "x"
transitions: {}
`;
    expect(() => parseGraphDslFromText(bad)).toThrow();
  });

  it("rejects empty node list", () => {
    const bad = `
graph:
  graphId: test
  version: "1.0"
  entrypoint: a
stateContractRef: "state.CfsStateSchema"
nodes: []
transitions: {}
`;
    expect(() => parseGraphDslFromText(bad)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Handler Registry
// ---------------------------------------------------------------------------
describe("handler registry", () => {
  it("registers all CFS handlers and routers", () => {
    registerCfsHandlers();
    const handlers = getRegisteredHandlerIds();
    const routers = getRegisteredRouterIds();

    expect(handlers).toContain("step1.nodeInit");
    expect(handlers).toContain("step2.nodeDetermineUseCases");
    expect(handlers).toContain("step3.nodeAskUseCaseQuestions");
    expect(handlers).toContain("step4.nodeBuildReadout");
    expect(handlers).toContain("cfs.routeInitFlow");

    expect(routers).toContain("cfs.routeInitFlow");
    expect(routers).toContain("cfs.routeUseCaseQuestionLoop");
    expect(routers).toContain("cfs.routePillarsLoop");
    expect(routers).toContain("cfs.routeAfterIngestUseCaseSelection");
  });

  it("is idempotent on repeated registration", () => {
    registerCfsHandlers();
    const first = getRegisteredHandlerIds().length;
    registerCfsHandlers();
    expect(getRegisteredHandlerIds().length).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 3. Compiler Preflight Checks
// ---------------------------------------------------------------------------
describe("compiler preflight", () => {
  it("rejects unknown stateContractRef", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const bad = { ...dsl, stateContractRef: "state.UnknownSchema" };
    expect(() => compileGraphFromDsl(bad)).toThrow(/Unknown stateContractRef/);
  });

  it("rejects entrypoint that is not a declared node", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const bad = { ...dsl, graph: { ...dsl.graph, entrypoint: "nonexistent" } };
    expect(() => compileGraphFromDsl(bad)).toThrow(/not a declared node/);
  });

  it("rejects unregistered handlerRef", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    expect(() => compileGraphFromDsl(dsl)).toThrow(/not registered/);
  });
});

// ---------------------------------------------------------------------------
// 4. Schema Topology Validation
// ---------------------------------------------------------------------------
describe("schema topology", () => {
  const EXPECTED_NODE_IDS = new Set([
    "routeInitFlow",
    "routeAfterIngestUseCaseSelection",
    "routePillarsLoop",
    "sendIntroAndAskUseCaseGroup",
    "askUserName",
    "askIndustry",
    "internetSearch",
    "ingestUseCaseGroupSelection",
    "ingestConfirmStart",
    "ingestUserName",
    "ingestIndustry",
    "ingestRole",
    "ingestConfirmRole",
    "ingestTimeframe",
    "ingestKycConfirm",
    "knowYourCustomerEcho",
    "nodeDetermineUseCases",
    "ingestUseCaseSelection",
    "nodeDetermineUseCaseQuestions",
    "nodeAskUseCaseQuestions",
    "nodeDeterminePillars",
    "nodeBuildReadout",
    "nodeDisplayReadout",
  ]);

  it("DSL declares all expected node IDs", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const schemaNodeIds = new Set(dsl.nodes.map((n) => n.id));
    expect(schemaNodeIds).toEqual(EXPECTED_NODE_IDS);
  });

  it("DSL entrypoint is routeInitFlow", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    expect(dsl.graph.entrypoint).toBe("routeInitFlow");
  });

  it("DSL has 20 static transitions", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    expect(dsl.transitions.static.length).toBe(20);
  });

  it("DSL has 3 conditional transition groups", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    expect(dsl.transitions.conditional.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Schema Functional Tests
// ---------------------------------------------------------------------------
describe("schema graph functional", () => {
  it("init turn sets correct session state", async () => {
    const compiled = buildGraphFromSchema(CFS_YAML);
    const initial = createInitialState({ sessionId: "schema-init" });
    const after = await runTurn(compiled, initial, undefined);

    expect(after.session_context.step).toBe("STEP1_KNOW_YOUR_CUSTOMER");
    expect(after.session_context.last_question_key).toBe("S1_USE_CASE_GROUP");
    expect(after.session_context.awaiting_user).toBe(true);
    expect(after.session_context.started).toBe(true);
  });

  it("handles use-case-group selection", async () => {
    const compiled = buildGraphFromSchema(CFS_YAML);
    const s1 = await runTurn(compiled, createInitialState({ sessionId: "schema-ucg" }), undefined);
    const s2 = await runTurn(compiled, s1, "Data governance");

    expect(s2.use_case_context.use_case_groups).toEqual(["Data governance"]);
    expect(s2.session_context.last_question_key).toBe("CONFIRM_START");
    expect(s2.session_context.awaiting_user).toBe(true);
  });

  it("handles confirm-start flow", async () => {
    const compiled = buildGraphFromSchema(CFS_YAML);
    let s = await runTurn(compiled, createInitialState({ sessionId: "schema-confirm" }), undefined);
    s = await runTurn(compiled, s, "Data governance");
    s = await runTurn(compiled, s, "yes");

    expect(s.session_context.last_question_key).toBe("S1_NAME");
    expect(s.session_context.awaiting_user).toBe(true);

    const ai = lastAIMessage(s)?.content?.toString() ?? "";
    expect(ai).toBe("Before we get started, what's your first name?");
  });

  it("always produces valid CfsState", async () => {
    const { CfsStateSchema } = await import("../state.js");
    const compiled = buildGraphFromSchema(CFS_YAML);

    let s = await runTurn(compiled, createInitialState({ sessionId: "schema-valid" }), undefined);
    expect(() => CfsStateSchema.parse(s)).not.toThrow();

    s = await runTurn(compiled, s, "Data governance");
    expect(() => CfsStateSchema.parse(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Schema Config Validation
// ---------------------------------------------------------------------------
describe("schema config", () => {
  it("YAML-built config has expected aiPrompts keys", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const yamlConfig = buildGraphMessagingConfigFromDsl(dsl);
    expect(yamlConfig).not.toBeNull();

    const keys = Object.keys(yamlConfig!.aiPrompts).sort();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("assessRisk");
  });

  it("YAML-built config has expected messagePolicy keys", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const yamlConfig = buildGraphMessagingConfigFromDsl(dsl);
    expect(yamlConfig).not.toBeNull();

    const keys = Object.keys(yamlConfig!.messagePolicy).sort();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("default");
  });

  it("YAML-built config has clarifierRetryText entries", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const yamlConfig = buildGraphMessagingConfigFromDsl(dsl);
    expect(yamlConfig).not.toBeNull();

    expect(Object.keys(yamlConfig!.clarifierRetryText).length).toBeGreaterThan(0);
  });

  it("YAML-built config has readout voice fields", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const yamlConfig = buildGraphMessagingConfigFromDsl(dsl);
    expect(yamlConfig).not.toBeNull();

    expect(typeof yamlConfig!.readoutRolePerspective).toBe("string");
    expect(typeof yamlConfig!.readoutVoiceCharacteristics).toBe("string");
    expect(typeof yamlConfig!.readoutBehavioralIntent).toBe("string");
  });

  it("YAML-built config has delivery fields", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const yamlConfig = buildGraphMessagingConfigFromDsl(dsl);
    expect(yamlConfig).not.toBeNull();

    expect(Array.isArray(yamlConfig!.readoutOutputTargets)).toBe(true);
    expect(Array.isArray(yamlConfig!.defaultReadoutOutputTargets)).toBe(true);
    expect(typeof yamlConfig!.allowMultiTargetDelivery).toBe("boolean");
  });

  it("YAML-built config resolves exampleGenerator and overlayPrefix functions", () => {
    registerCfsHandlers();
    const dsl = loadGraphDsl(CFS_YAML);
    const yamlConfig = buildGraphMessagingConfigFromDsl(dsl);
    expect(yamlConfig).not.toBeNull();

    expect(typeof yamlConfig!.exampleGenerator).toBe("function");
    expect(typeof yamlConfig!.overlayPrefix).toBe("function");

    const examples = yamlConfig!.exampleGenerator({ topic: "role" });
    expect(Array.isArray(examples)).toBe(true);
    expect(examples.length).toBeGreaterThan(0);

    const prefix = yamlConfig!.overlayPrefix("Coach_Affirmative");
    expect(typeof prefix).toBe("string");
    expect(prefix.length).toBeGreaterThan(0);
  });

  it("registers configFn entries for CFS", () => {
    registerCfsHandlers();
    const fnIds = getRegisteredConfigFnIds();
    expect(fnIds).toContain("cfs.exampleGenerator");
    expect(fnIds).toContain("cfs.overlayPrefix");
  });
});

