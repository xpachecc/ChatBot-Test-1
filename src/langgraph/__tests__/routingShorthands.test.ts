import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  expandAwaitingDispatch,
  expandDestinations,
  expandDefaultTransitions,
} from "../schema/graph-compiler.js";
import { loadGraphDsl } from "../schema/graph-loader.js";
import type { GraphDsl } from "../schema/graph-dsl-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CFS_YAML = resolve(__dirname, "../../../clients/default/flows/cfs-default/flow.yaml");

const minimalDsl = (overrides: Partial<GraphDsl> = {}): GraphDsl =>
  ({
    graph: { graphId: "test", version: "1", entrypoint: "router" },
    stateContractRef: "state.CfsStateSchema",
    nodes: [
      { id: "router", kind: "router", handlerRef: "x" },
      { id: "a", kind: "question", nodeConfig: { question: { questionKey: "Q1" } } },
      { id: "b", kind: "question", nodeConfig: { question: { questionKey: "Q2" } } },
    ],
    transitions: {
      static: [],
      conditional: [
        { from: "router", routerRef: "x" },
      ],
    },
    config: {
      routingRules: {
        router: [
          { when: { x: true }, goto: "a" },
          { awaitingDispatch: { Q1: "a", Q2: "b" } },
          { default: "end" },
        ],
      },
    },
    ...overrides,
  } as unknown as GraphDsl);

describe("expandAwaitingDispatch", () => {
  it("expands awaitingDispatch into when/goto rules before default", () => {
    const dsl = minimalDsl();
    const out = expandAwaitingDispatch(dsl);
    const rules = out.config!.routingRules!.router!;
    const awaitingRules = rules.filter(
      (r) => r.when?.awaiting_user === true && r.when?.last_question_key
    );
    expect(awaitingRules).toHaveLength(2);
    expect(awaitingRules.map((r) => r.when!.last_question_key)).toContain("Q1");
    expect(awaitingRules.map((r) => r.when!.last_question_key)).toContain("Q2");
    expect(awaitingRules[0].goto).toBe("a");
    expect(awaitingRules[1].goto).toBe("b");
    const defaultRule = rules.find((r) => r.default);
    expect(defaultRule).toBeDefined();
    expect(rules.indexOf(defaultRule!)).toBeGreaterThan(awaitingRules.length);
  });

  it("skips keys already present in when clauses", () => {
    const dsl = minimalDsl({
      config: {
        routingRules: {
          router: [
            { when: { awaiting_user: true, last_question_key: "Q1" }, goto: "a" },
            { awaitingDispatch: { Q1: "b", Q2: "b" } },
            { default: "end" },
          ],
        },
      } as unknown as GraphDsl["config"],
    });
    const out = expandAwaitingDispatch(dsl);
    const rules = out.config!.routingRules!.router!;
    const q1Rules = rules.filter(
      (r) => r.when?.last_question_key === "Q1"
    );
    expect(q1Rules).toHaveLength(1);
    expect(q1Rules[0].goto).toBe("a");
    const q2Rules = rules.filter(
      (r) => r.when?.last_question_key === "Q2"
    );
    expect(q2Rules).toHaveLength(1);
    expect(q2Rules[0].goto).toBe("b");
  });
});

describe("expandDestinations", () => {
  it("derives destinations from routing rules when missing", () => {
    const dsl = minimalDsl({
      transitions: {
        static: [{ from: "a", to: "__end__" }, { from: "b", to: "__end__" }],
        conditional: [{ from: "router", routerRef: "x" }],
      },
    });
    const expanded = expandAwaitingDispatch(dsl);
    const out = expandDestinations(expanded);
    const ct = out.transitions.conditional[0];
    expect(ct.destinations).toBeDefined();
    expect(ct.destinations!["a"]).toBe("a");
    expect(ct.destinations!["b"]).toBe("b");
    expect(ct.destinations!["end"]).toBe("__end__");
  });

  it("does not modify explicit destinations", () => {
    const dsl = minimalDsl({
      transitions: {
        static: [],
        conditional: [
          {
            from: "router",
            routerRef: "x",
            destinations: { a: "a", end: "__end__" },
          },
        ],
      },
    });
    const out = expandDestinations(dsl);
    expect(out.transitions.conditional[0].destinations).toEqual({
      a: "a",
      end: "__end__",
    });
  });

  it("throws when no destinations and no routing rules", () => {
    const dsl = minimalDsl({
      config: { routingRules: {} } as unknown as GraphDsl["config"],
      transitions: {
        static: [],
        conditional: [{ from: "router", routerRef: "x" }],
      },
    });
    expect(() => expandDestinations(dsl)).toThrow(
      /no destinations and no routing rules/
    );
  });
});

describe("expandDefaultTransitions", () => {
  it("adds __end__ for question/ingest/compute/integration nodes without static from", () => {
    const dsl = minimalDsl({
      transitions: {
        static: [{ from: "a", to: "__end__" }],
        conditional: [],
      },
    });
    const out = expandDefaultTransitions(dsl);
    expect(out.transitions.static).toContainEqual({
      from: "b",
      to: "__end__",
    });
    expect(out.transitions.static).toContainEqual({
      from: "a",
      to: "__end__",
    });
  });

  it("skips router and terminal nodes", () => {
    const dsl = minimalDsl({
      nodes: [
        { id: "router", kind: "router", handlerRef: "x", helperRefs: [], reads: [], writes: [] },
        { id: "a", kind: "terminal", nodeConfig: { display: { statePath: "x" } }, helperRefs: [], reads: [], writes: [] },
      ],
      transitions: { static: [], conditional: [] },
    });
    const out = expandDefaultTransitions(dsl);
    expect(out.transitions.static).not.toContainEqual({
      from: "router",
      to: "__end__",
    });
    expect(out.transitions.static).not.toContainEqual({
      from: "a",
      to: "__end__",
    });
  });

  it("preserves explicit overrides", () => {
    const dsl = minimalDsl({
      transitions: {
        static: [{ from: "a", to: "b" }],
        conditional: [],
      },
    });
    const out = expandDefaultTransitions(dsl);
    expect(out.transitions.static).toContainEqual({ from: "a", to: "b" });
    expect(out.transitions.static).toContainEqual({
      from: "b",
      to: "__end__",
    });
  });
});

describe("CFS flow expansion (integration)", () => {
  it("expandDestinations produces all routeInitFlow destinations when destinations omitted", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const noDests = {
      ...dsl,
      transitions: {
        ...dsl.transitions,
        conditional: dsl.transitions.conditional.map((ct) => ({
          ...ct,
          destinations: undefined,
        })),
      },
    };
    const expanded = expandAwaitingDispatch(noDests);
    const out = expandDestinations(expanded);
    const routeInit = out.transitions.conditional.find((c) => c.from === "routeInitFlow");
    expect(routeInit?.destinations).toBeDefined();
    expect(routeInit!.destinations!["sendIntroAndAskUseCaseGroup"]).toBe("sendIntroAndAskUseCaseGroup");
    expect(routeInit!.destinations!["askUserName"]).toBe("askUserName");
    expect(routeInit!.destinations!["end"]).toBe("__end__");
  });
});
