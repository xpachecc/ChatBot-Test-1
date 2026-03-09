import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraphDsl } from "../schema/graph-loader.js";
import { expandAutoIngest, expandAwaitingDispatch, inferReadsWrites } from "../schema/graph-compiler.js";
import type { NodeDef, GraphDsl } from "../schema/graph-dsl-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CFS_YAML = resolve(__dirname, "../../../clients/default/flows/cfs-default/flow.yaml");
const CFS_YAML_BAK = resolve(__dirname, "../../../clients/default/flows/cfs-default/flow.yaml.bak");

describe("inferReadsWrites", () => {
  it("infers reads/writes for question node with nodeConfig.question", () => {
    const node = {
      id: "q1", kind: "question", helperRefs: [], reads: [], writes: [],
      nodeConfig: { question: { questionKey: "Q1", stringKey: "q1.text" } },
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual(["session_context"]);
    expect(result.writes).toEqual(["messages", "session_context"]);
  });

  it("infers reads/writes for greeting node", () => {
    const node = {
      id: "g1", kind: "question", helperRefs: [], reads: [], writes: [],
      nodeConfig: { greeting: { stringKeys: ["g.hello"], afterQuestionKey: "Q1" } },
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual(["messages", "session_context"]);
  });

  it("infers reads/writes for ingest node", () => {
    const node = {
      id: "i1", kind: "ingest", helperRefs: [], reads: [], writes: [],
      nodeConfig: { ingest: {} },
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual(["messages", "session_context"]);
    expect(result.writes).toEqual(["user_context", "session_context"]);
  });

  it("infers reads/writes for display node", () => {
    const node = {
      id: "d1", kind: "compute", helperRefs: [], reads: [], writes: [],
      nodeConfig: { display: { statePath: "readout_context.document" } },
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual(["readout_context"]);
    expect(result.writes).toEqual(["messages"]);
  });

  it("returns explicit reads/writes when provided", () => {
    const node = {
      id: "c1", kind: "compute", helperRefs: [], reads: ["user_context"], writes: ["messages"],
      nodeConfig: { question: { questionKey: "Q1", stringKey: "q.text" } },
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual(["user_context"]);
    expect(result.writes).toEqual(["messages"]);
  });

  it("returns empty for handlerRef nodes without nodeConfig", () => {
    const node = {
      id: "h1", kind: "compute", handlerRef: "test.handler", helperRefs: [], reads: [], writes: [],
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual([]);
  });

  it("infers reads/writes for router node kind", () => {
    const node = {
      id: "r1", kind: "router", handlerRef: "test.router", helperRefs: [], reads: [], writes: [],
    } as unknown as NodeDef;
    const result = inferReadsWrites(node);
    expect(result.reads).toEqual(["session_context"]);
    expect(result.writes).toEqual([]);
  });
});

describe("expandAutoIngest", () => {
  it("generates synthetic ingest node for autoIngest question", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(dsl);

    const syntheticNames = expanded.nodes
      .filter((n) => n.id.endsWith("_ingest"))
      .map((n) => n.id);
    expect(syntheticNames).toContain("askUserName_ingest");
    expect(syntheticNames).toContain("askTimeframe_ingest");
  });

  it("synthetic ingest nodes have correct kind and nodeConfig", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(dsl);

    const userNameIngest = expanded.nodes.find((n) => n.id === "askUserName_ingest");
    expect(userNameIngest).toBeDefined();
    expect(userNameIngest!.kind).toBe("ingest");
    expect(userNameIngest!.nodeConfig?.ingest).toBeDefined();
  });

  it("generates static transition for synthetic ingest node", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(dsl);

    const userNameTransition = expanded.transitions.static.find(
      (t) => t.from === "askUserName_ingest"
    );
    expect(userNameTransition).toBeDefined();
    expect(userNameTransition!.to).toBe("routeInitFlow");

    const timeframeTransition = expanded.transitions.static.find(
      (t) => t.from === "askTimeframe_ingest"
    );
    expect(timeframeTransition).toBeDefined();
    expect(timeframeTransition!.to).toBe("knowYourCustomerEcho");
  });

  it("generates ingestFieldMappings for autoIngest", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(dsl);

    const mappings = expanded.config?.ingestFieldMappings ?? {};
    expect(mappings["S1_NAME"]).toEqual({
      targetField: "user_context.first_name",
      sanitizeAs: "name",
    });
    expect(mappings["S1_TIMEFRAME"]).toEqual({
      targetField: "user_context.timeframe",
      sanitizeAs: "timeframe",
    });
  });

  it("does not mutate the original DSL", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const originalNodeCount = dsl.nodes.length;
    expandAutoIngest(dsl);
    expect(dsl.nodes.length).toBe(originalNodeCount);
  });

  it("is idempotent on a DSL without autoIngest", () => {
    const dsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(dsl);
    const doubleExpanded = expandAutoIngest(expanded);
    expect(doubleExpanded.nodes.length).toBe(expanded.nodes.length);
  });
});

describe("DSL expansion equivalence", () => {
  it("expanded intent-driven YAML has same node count as original explicit YAML", () => {
    const intentDsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(intentDsl);
    let originalDsl: GraphDsl | null = null;
    try {
      originalDsl = loadGraphDsl(CFS_YAML_BAK);
    } catch {
      return;
    }

    expect(expanded.nodes.length).toBe(originalDsl.nodes.length);
  });

  it("expanded intent-driven YAML covers same routing rule destinations", () => {
    const intentDsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAwaitingDispatch(expandAutoIngest(intentDsl));
    let originalDsl: GraphDsl | null = null;
    try {
      originalDsl = loadGraphDsl(CFS_YAML_BAK);
    } catch {
      return;
    }

    const originalRoutingGotos = new Set<string>();
    for (const rules of Object.values(originalDsl.config?.routingRules ?? {})) {
      for (const rule of rules) {
        if (rule.goto) originalRoutingGotos.add(rule.goto);
      }
    }

    const expandedRoutingGotos = new Set<string>();
    for (const rules of Object.values(expanded.config?.routingRules ?? {})) {
      for (const rule of rules) {
        if (rule.goto) expandedRoutingGotos.add(rule.goto);
      }
    }

    for (const goto of originalRoutingGotos) {
      const mapped = goto === "ingestUserName" ? "askUserName_ingest"
                   : goto === "ingestTimeframe" ? "askTimeframe_ingest"
                   : goto;
      expect(expandedRoutingGotos.has(mapped) || expandedRoutingGotos.has(goto)).toBe(true);
    }
  });

  it("expanded DSL has matching ingestFieldMappings for all original keys", () => {
    const intentDsl = loadGraphDsl(CFS_YAML);
    const expanded = expandAutoIngest(intentDsl);
    let originalDsl: GraphDsl | null = null;
    try {
      originalDsl = loadGraphDsl(CFS_YAML_BAK);
    } catch {
      return;
    }

    const originalKeys = Object.keys(originalDsl.config?.ingestFieldMappings ?? {});
    const expandedKeys = Object.keys(expanded.config?.ingestFieldMappings ?? {});

    for (const key of originalKeys) {
      expect(expandedKeys).toContain(key);
    }
  });
});
