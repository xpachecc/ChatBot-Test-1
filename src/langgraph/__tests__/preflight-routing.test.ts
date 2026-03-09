import { preflightRoutingValidation, type PreflightWarning } from "../schema/graph-compiler.js";
import type { GraphDsl } from "../schema/graph-dsl-types.js";

function makeDsl(overrides: Record<string, any>): GraphDsl {
  const graph = { tags: [] as string[], stateExtensions: [] as string[], ...overrides.graph };
  return {
    stateContractRef: "state.CfsStateSchema",
    runtimeConfigRefs: {},
    config: {
      models: {}, messagePolicy: {}, aiPrompts: {}, strings: {},
      questionTemplates: [], clarifierRetryText: {}, clarificationAcknowledgement: [],
      readoutVoice: { rolePerspective: "Coach_Affirmative", voiceCharacteristics: "", behavioralIntent: "" },
      readout: { sectionKeys: [], sectionContract: "" },
      delivery: { outputTargets: ["download"], defaultOutputTargets: ["download"], allowMultiTarget: true, overridesByTenant: {} },
      meta: { flowTitle: "", flowDescription: "", steps: [] },
      overlayPrefixes: {}, exampleTemplates: {}, progressRules: { questionKeyMap: {}, dynamicCountField: "", dynamicCountStepKey: "", useCaseSelectQuestionKey: "S3_USE_CASE_SELECT" },
      options: {}, dynamicOptions: {}, continuationTriggers: [],
      ingestFieldMappings: {}, routingRules: {}, signalAgents: { enabled: false, ttlMs: 1000 },
    },
    validation: { requiredStateFields: [], invariants: [] },
    ...overrides,
    graph,
  } as unknown as GraphDsl;
}

function makeNode(id: string, kind: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    kind,
    handlerRef: `test.${id}`,
    helperRefs: [],
    reads: [],
    writes: [],
    ...extra,
  };
}

describe("preflightRoutingValidation", () => {
  describe("reachability", () => {
    it("warns on unreachable nodes", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a", tags: [] },
        nodes: [makeNode("a", "compute"), makeNode("b", "compute"), makeNode("orphan", "compute")],
        transitions: {
          static: [{ from: "a", to: "b" }, { from: "b", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.some((w) => w.code === "unreachable-node" && w.message.includes("orphan"))).toBe(true);
    });

    it("no warnings when all nodes are reachable", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a", tags: [] },
        nodes: [makeNode("a", "compute"), makeNode("b", "compute")],
        transitions: {
          static: [{ from: "a", to: "b" }, { from: "b", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "unreachable-node")).toHaveLength(0);
    });
  });

  describe("terminal path", () => {
    it("warns on nodes with no path to __end__", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a", tags: [] },
        nodes: [makeNode("a", "compute"), makeNode("b", "compute")],
        transitions: {
          static: [{ from: "a", to: "b" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.some((w) => w.code === "no-terminal-path" && w.message.includes('"b"'))).toBe(true);
    });

    it("no terminal warnings when all paths reach __end__", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a", tags: [] },
        nodes: [makeNode("a", "compute"), makeNode("b", "compute")],
        transitions: {
          static: [{ from: "a", to: "b" }, { from: "b", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "no-terminal-path")).toHaveLength(0);
    });
  });

  describe("question-ingest pairing", () => {
    it("warns on unpaired question nodes", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "q", tags: [] },
        nodes: [
          makeNode("q", "question"),
          makeNode("done", "compute"),
        ],
        transitions: {
          static: [{ from: "q", to: "done" }, { from: "done", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.some((w) => w.code === "unpaired-question" && w.message.includes('"q"'))).toBe(true);
    });

    it("no warning when question has a reachable ingest", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "q", tags: [] },
        nodes: [
          makeNode("q", "question"),
          makeNode("router", "router"),
          makeNode("ing", "ingest"),
        ],
        transitions: {
          static: [{ from: "ing", to: "__end__" }],
          conditional: [{
            from: "q",
            routerRef: "test.router",
            destinations: { ingest: "ing", next: "router" },
          }],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "unpaired-question")).toHaveLength(0);
    });
  });

  describe("routing rule completeness", () => {
    it("warns when a destination key is not producible by any rule", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "r", tags: [] },
        nodes: [makeNode("r", "router"), makeNode("a", "compute"), makeNode("b", "compute")],
        transitions: {
          static: [],
          conditional: [{
            from: "r",
            routerRef: "test.router",
            destinations: { goA: "a", goB: "b", end: "__end__" },
          }],
        },
      });
      dsl.config!.routingRules = {
        r: [{ when: { x: true }, goto: "goA" }, { default: "end" }],
      };
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.some((w) => w.code === "unreachable-destination" && w.message.includes('"goB"'))).toBe(true);
    });

    it("no warning when all destination keys are producible", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "r", tags: [] },
        nodes: [makeNode("r", "router"), makeNode("a", "compute")],
        transitions: {
          static: [],
          conditional: [{
            from: "r",
            routerRef: "test.router",
            destinations: { goA: "a", end: "__end__" },
          }],
        },
      });
      dsl.config!.routingRules = {
        r: [{ when: { x: true }, goto: "goA" }, { default: "end" }],
      };
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "unreachable-destination")).toHaveLength(0);
    });
  });

  describe("stateExtensions validation", () => {
    it("warns when a node references an undeclared state field", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a" },
        nodes: [makeNode("a", "compute", { reads: ["custom_slice"], writes: ["messages"] })],
        transitions: {
          static: [{ from: "a", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.some((w) => w.code === "undeclared-state-field" && w.message.includes("custom_slice"))).toBe(true);
    });

    it("no warning when field is declared in stateExtensions", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a", stateExtensions: ["custom_slice"] },
        nodes: [makeNode("a", "compute", { reads: ["custom_slice"], writes: ["messages"] })],
        transitions: {
          static: [{ from: "a", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "undeclared-state-field")).toHaveLength(0);
    });

    it("no warning for base state fields", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a" },
        nodes: [makeNode("a", "compute", { reads: ["messages", "session_context"], writes: ["user_context"] })],
        transitions: {
          static: [{ from: "a", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "undeclared-state-field")).toHaveLength(0);
    });
  });

  describe("intent annotation", () => {
    it("warns when a handlerRef node lacks intent", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a" },
        nodes: [makeNode("a", "compute", { handlerRef: "test.a" })],
        transitions: {
          static: [{ from: "a", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.some((w) => w.code === "missing-intent" && w.message.includes('"a"'))).toBe(true);
    });

    it("no warning when handlerRef node has intent", () => {
      const dsl = makeDsl({
        graph: { graphId: "test", version: "1.0", entrypoint: "a" },
        nodes: [makeNode("a", "compute", { handlerRef: "test.a", intent: "Do something useful" })],
        transitions: {
          static: [{ from: "a", to: "__end__" }],
          conditional: [],
        },
      });
      const warnings = preflightRoutingValidation(dsl);
      expect(warnings.filter((w) => w.code === "missing-intent")).toHaveLength(0);
    });
  });
});
