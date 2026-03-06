import { StateGraph, END } from "@langchain/langgraph";
import type { CfsState, GraphMessagingConfig, MessageType } from "../state.js";
import type { GraphDsl, NodeDef } from "./graph-dsl-types.js";
import { resolveHandler, resolveRouter, resolveConfig, resolveConfigFn } from "./handler-registry.js";
import { createGenericHandler } from "./generic-handlers.js";
import { evaluateRoutingRules } from "../core/routing/routing-engine.js";
import { setGraphMessagingConfig } from "../core/config/messaging.js";
import { interpolate } from "../core/helpers/template.js";

const SUPPORTED_STATE_CONTRACTS = ["state.CfsStateSchema"];

const BASE_STATE_FIELDS = new Set([
  "messages",
  "session_context",
  "overlay_active",
  "user_context",
  "use_case_context",
  "relationship_context",
  "context_weave_index",
  "vector_context",
  "internet_search_context",
  "readout_context",
]);

/**
 * Shared channel definitions derived from the canonical CfsState Zod contract.
 * All graphs using CfsState share these reducers. `session_context` uses
 * shallow-merge; every other slice uses last-write-wins replacement.
 */
const CFS_STATE_CHANNELS = {
  messages: {
    reducer: (_left: any[] = [], right: any[] = []) => right ?? _left,
    default: () => [] as any[],
  },
  session_context: {
    reducer: (left: any = {}, right: any = {}) => ({ ...left, ...(right ?? {}) }),
    default: () => ({} as any),
  },
  overlay_active: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => undefined as any,
  },
  user_context: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
  use_case_context: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
  relationship_context: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
  context_weave_index: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
  vector_context: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
  internet_search_context: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
  readout_context: {
    reducer: (_left: any, right: any) => right ?? _left,
    default: () => ({} as any),
  },
};

/**
 * The compiled graph type. Uses `any` to stay compatible with the legacy
 * `buildStep1Graph` return type and the `runTurn` parameter signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompileResult = any;

/**
 * Wrapper around a compiled graph that carries the graphId for scoped config lookup.
 */
export interface CompiledGraph {
  graphId: string;
  compiled: CompileResult;
}

/**
 * Expand autoIngest configurations in the DSL. For each question node with
 * autoIngest, generates a synthetic ingest node, routing rules, static
 * transitions, and ingest field mappings. Returns a new DSL — does not mutate.
 */
export function expandAutoIngest(dsl: GraphDsl): GraphDsl {
  const existingNodeIds = new Set(dsl.nodes.map((n) => n.id));
  const existingIngestKeys = new Set<string>();
  for (const node of dsl.nodes) {
    if (node.kind === "ingest" && node.nodeConfig?.ingest) {
      const questionKey = findQuestionKeyForIngest(dsl, node.id);
      if (questionKey) existingIngestKeys.add(questionKey);
    }
  }

  const newNodes: NodeDef[] = [];
  const newStaticTransitions: GraphDsl["transitions"]["static"] = [];
  const newRoutingRules: Record<string, GraphDsl["config"]["routingRules"][string]> = {};
  const newIngestFieldMappings: Record<string, { targetField: string; sanitizeAs?: string; captureObjective?: boolean }> = {};

  for (const node of dsl.nodes) {
    const ai = node.nodeConfig?.question?.autoIngest;
    if (!ai) continue;
    const questionKey = node.nodeConfig!.question!.questionKey;

    if (existingIngestKeys.has(questionKey)) continue;

    const syntheticId = `${node.id}_ingest`;
    if (existingNodeIds.has(syntheticId)) continue;

    const ingestNode: NodeDef = {
      id: syntheticId,
      kind: "ingest",
      handlerRef: undefined,
      helperRefs: [],
      reads: ["messages", "session_context"],
      writes: ["user_context", "session_context"],
      nodeConfig: {
        ingest: ai.affirmativeCheck ? { affirmativeCheckConfig: ai.affirmativeCheck } : {},
      },
    };
    newNodes.push(ingestNode);
    existingNodeIds.add(syntheticId);

    const transitionTarget = ai.then ?? "__end__";
    newStaticTransitions.push({ from: syntheticId, to: transitionTarget });

    const awaitingRule = {
      when: { awaiting_user: true, last_question_key: questionKey },
      goto: syntheticId,
    };

    const routerNodes = findRouterNodesForQuestion(dsl, node.id);
    for (const routerFrom of routerNodes) {
      if (!newRoutingRules[routerFrom]) {
        newRoutingRules[routerFrom] = [];
      }
      newRoutingRules[routerFrom].push(awaitingRule);
    }

    newIngestFieldMappings[questionKey] = {
      targetField: ai.saveTo,
      ...(ai.sanitizeAs ? { sanitizeAs: ai.sanitizeAs } : {}),
      ...(ai.captureObjective ? { captureObjective: ai.captureObjective } : {}),
    };
  }

  if (newNodes.length === 0) return dsl;

  const mergedRoutingRules = { ...(dsl.config?.routingRules ?? {}) };
  for (const [routerFrom, rules] of Object.entries(newRoutingRules)) {
    const existing = mergedRoutingRules[routerFrom] ?? [];
    const existingGotos = new Set(existing.map((r) => r.goto).filter(Boolean));
    const filtered = rules.filter((r) => !r.goto || !existingGotos.has(r.goto));
    mergedRoutingRules[routerFrom] = [...filtered, ...existing];
  }

  const mergedIngestFieldMappings = {
    ...(dsl.config?.ingestFieldMappings ?? {}),
    ...newIngestFieldMappings,
  };

  const mergedConditional = dsl.transitions.conditional.map((ct) => {
    const autoRules = newRoutingRules[ct.from];
    if (!autoRules) return ct;
    const newDests = { ...ct.destinations };
    for (const rule of autoRules) {
      if (rule.goto && !newDests[rule.goto]) {
        const targetNode = rule.goto;
        if (existingNodeIds.has(targetNode) || targetNode === "__end__") {
          newDests[targetNode] = targetNode === "__end__" ? "__end__" : targetNode;
        }
      }
    }
    return { ...ct, destinations: newDests };
  });

  return {
    ...dsl,
    nodes: [...dsl.nodes, ...newNodes],
    transitions: {
      static: [...dsl.transitions.static, ...newStaticTransitions],
      conditional: mergedConditional,
    },
    config: {
      ...dsl.config,
      routingRules: mergedRoutingRules,
      ingestFieldMappings: mergedIngestFieldMappings,
    },
  } as GraphDsl;
}

function findQuestionKeyForIngest(dsl: GraphDsl, ingestNodeId: string): string | null {
  const routingRules = dsl.config?.routingRules ?? {};
  for (const rules of Object.values(routingRules)) {
    for (const rule of rules) {
      if (rule.goto === ingestNodeId && rule.when?.last_question_key) {
        return rule.when.last_question_key as string;
      }
    }
  }
  return null;
}

function findRouterNodesForQuestion(dsl: GraphDsl, questionNodeId: string): string[] {
  const routers: string[] = [];
  for (const ct of dsl.transitions.conditional) {
    const destinations = Object.values(ct.destinations);
    if (destinations.includes(questionNodeId)) {
      routers.push(ct.from);
    }
  }
  if (routers.length === 0) {
    for (const ct of dsl.transitions.conditional) {
      routers.push(ct.from);
    }
  }
  return [...new Set(routers)];
}

/**
 * Infer reads/writes from a node's kind and nodeConfig when not explicitly provided.
 * Returns { reads, writes } arrays. If the node has explicit reads/writes, returns those.
 */
export function inferReadsWrites(node: NodeDef): { reads: string[]; writes: string[] } {
  if ((node.reads && node.reads.length > 0) || (node.writes && node.writes.length > 0)) {
    return { reads: node.reads ?? [], writes: node.writes ?? [] };
  }

  if (node.kind === "router") {
    return { reads: ["session_context"], writes: [] };
  }

  const nc = node.nodeConfig;
  if (!nc) return { reads: [], writes: [] };

  if (nc.question) {
    return { reads: ["session_context"], writes: ["messages", "session_context"] };
  }
  if (nc.greeting) {
    return { reads: [], writes: ["messages", "session_context"] };
  }
  if (nc.ingest) {
    return { reads: ["messages", "session_context"], writes: ["user_context", "session_context"] };
  }
  if (nc.display) {
    const rootSlice = nc.display.statePath.split(".")[0];
    return { reads: [rootSlice], writes: ["messages"] };
  }
  if (nc.aiCompute) {
    const outputRoot = nc.aiCompute.outputPath.split(".")[0];
    const inputRoots = Object.values(nc.aiCompute.inputOverrides ?? {}).map((p) => p.split(".")[0]);
    return { reads: [...new Set(inputRoots)], writes: [outputRoot, "session_context"] };
  }
  if (nc.vectorSelect) {
    const outputRoot = nc.vectorSelect.outputPath.split(".")[0];
    return { reads: ["session_context"], writes: [outputRoot, "session_context"] };
  }

  return { reads: [], writes: [] };
}

/**
 * Build an adjacency list from transitions. Each node maps to the set of
 * node IDs reachable from it in a single step. `__end__` is included as a
 * sentinel target.
 */
function buildAdjacencyList(dsl: GraphDsl): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of dsl.nodes) {
    if (!adj.has(node.id)) adj.set(node.id, new Set());
  }
  for (const st of dsl.transitions.static) {
    const targets = adj.get(st.from) ?? new Set();
    targets.add(st.to);
    adj.set(st.from, targets);
  }
  for (const ct of dsl.transitions.conditional) {
    const targets = adj.get(ct.from) ?? new Set();
    for (const dest of Object.values(ct.destinations)) {
      targets.add(dest);
    }
    adj.set(ct.from, targets);
  }
  return adj;
}

/**
 * Warnings emitted by preflight routing validation. Exported for testing.
 */
export type PreflightWarning = { code: string; message: string };

/**
 * Validates graph routing properties and returns warnings (non-fatal).
 * Checks: reachability, terminal paths, question-ingest pairing,
 * routing rule completeness.
 */
export function preflightRoutingValidation(dsl: GraphDsl): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];
  const nodeIds = new Set(dsl.nodes.map((n) => n.id));
  const adj = buildAdjacencyList(dsl);

  // 1. Reachability — BFS from entrypoint
  const reachable = new Set<string>();
  const queue = [dsl.graph.entrypoint];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const targets = adj.get(current);
    if (targets) {
      for (const t of targets) {
        if (t !== "__end__" && !reachable.has(t)) queue.push(t);
      }
    }
  }
  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      warnings.push({
        code: "unreachable-node",
        message: `[preflight] Node "${nodeId}" is not reachable from entrypoint "${dsl.graph.entrypoint}".`,
      });
    }
  }

  // 2. Terminal path — every reachable node must eventually reach __end__
  const canReachEnd = new Set<string>(["__end__"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, targets] of adj) {
      if (canReachEnd.has(from)) continue;
      for (const t of targets) {
        if (canReachEnd.has(t)) {
          canReachEnd.add(from);
          changed = true;
          break;
        }
      }
    }
  }
  for (const nodeId of reachable) {
    if (!canReachEnd.has(nodeId)) {
      warnings.push({
        code: "no-terminal-path",
        message: `[preflight] Node "${nodeId}" has no path that eventually reaches __end__.`,
      });
    }
  }

  // 3. Question-ingest pairing — every question node should reach an ingest node
  const nodeKindMap = new Map(dsl.nodes.map((n) => [n.id, n.kind]));
  const questionNodes = dsl.nodes.filter((n) => n.kind === "question");
  for (const qNode of questionNodes) {
    const visited = new Set<string>();
    const bfsQueue = [qNode.id];
    let foundIngest = false;
    while (bfsQueue.length > 0) {
      const current = bfsQueue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const targets = adj.get(current);
      if (!targets) continue;
      for (const t of targets) {
        if (t === "__end__") continue;
        if (nodeKindMap.get(t) === "ingest") { foundIngest = true; break; }
        if (!visited.has(t)) bfsQueue.push(t);
      }
      if (foundIngest) break;
    }
    if (!foundIngest) {
      warnings.push({
        code: "unpaired-question",
        message: `[preflight] Question node "${qNode.id}" has no reachable ingest node.`,
      });
    }
  }

  // 4. Routing rule completeness — every destination key should be producible
  const routingRules = dsl.config?.routingRules ?? {};
  for (const ct of dsl.transitions.conditional) {
    const rules = routingRules[ct.from];
    if (!rules || rules.length === 0) continue;
    const producibleKeys = new Set<string>();
    for (const rule of rules) {
      if (rule.goto) producibleKeys.add(rule.goto);
      if (rule.default) producibleKeys.add(rule.default);
    }
    for (const destKey of Object.keys(ct.destinations)) {
      if (destKey === "end" || destKey === "__end__") continue;
      if (!producibleKeys.has(destKey)) {
        warnings.push({
          code: "unreachable-destination",
          message: `[preflight] Routing destination key "${destKey}" on node "${ct.from}" is not produced by any routing rule.`,
        });
      }
    }
  }

  // 5. Intent annotation — warn when handlerRef nodes lack intent
  for (const node of dsl.nodes) {
    if (node.handlerRef && !node.intent) {
      warnings.push({
        code: "missing-intent",
        message: `[preflight] handlerRef node "${node.id}" has no intent annotation.`,
      });
    }
  }

  // 6. State extensions — warn on undeclared state fields in reads/writes
  const declaredExtensions = new Set(dsl.graph.stateExtensions ?? []);
  const allowedFields = new Set([...BASE_STATE_FIELDS, ...declaredExtensions]);
  for (const node of dsl.nodes) {
    for (const field of [...(node.reads ?? []), ...(node.writes ?? [])]) {
      const topLevel = field.split(".")[0];
      if (!allowedFields.has(topLevel)) {
        warnings.push({
          code: "undeclared-state-field",
          message: `[preflight] Node "${node.id}" references state field "${topLevel}" which is not a base field or declared in stateExtensions.`,
        });
      }
    }
  }

  return warnings;
}

/**
 * Validates a parsed GraphDsl against the handler/router/config registries
 * and the known state contracts. Throws on any unresolvable reference.
 */
function preflight(dsl: GraphDsl): void {
  if (!SUPPORTED_STATE_CONTRACTS.includes(dsl.stateContractRef)) {
    throw new Error(
      `Unknown stateContractRef "${dsl.stateContractRef}". ` +
      `Supported: ${SUPPORTED_STATE_CONTRACTS.join(", ")}`
    );
  }

  const nodeIds = new Set(dsl.nodes.map((n) => n.id));

  if (!nodeIds.has(dsl.graph.entrypoint)) {
    throw new Error(`Entrypoint "${dsl.graph.entrypoint}" is not a declared node.`);
  }

  for (const node of dsl.nodes) {
    if (node.handlerRef) {
      resolveHandler(node.handlerRef);
    } else if (!node.nodeConfig) {
      throw new Error(`Node "${node.id}" has neither handlerRef nor nodeConfig.`);
    }
  }

  const routingRules = dsl.config?.routingRules ?? {};
  for (const ct of dsl.transitions.conditional) {
    if (!nodeIds.has(ct.from)) {
      throw new Error(`Conditional transition "from" node "${ct.from}" is not declared.`);
    }
    const rules = routingRules[ct.from];
    if (!rules || rules.length === 0) {
      resolveRouter(ct.routerRef);
    }
    for (const dest of Object.values(ct.destinations)) {
      if (dest !== "__end__" && !nodeIds.has(dest)) {
        throw new Error(`Conditional destination "${dest}" is not a declared node.`);
      }
    }
  }

  for (const st of dsl.transitions.static) {
    if (!nodeIds.has(st.from)) {
      throw new Error(`Static transition "from" node "${st.from}" is not declared.`);
    }
    if (st.to !== "__end__" && !nodeIds.has(st.to)) {
      throw new Error(`Static transition "to" node "${st.to}" is not declared.`);
    }
  }

  if (dsl.runtimeConfigRefs.initConfigRef) {
    resolveConfig(dsl.runtimeConfigRefs.initConfigRef);
  }

  // Non-fatal routing validations
  const routingWarnings = preflightRoutingValidation(dsl);
  for (const w of routingWarnings) {
    console.warn(w.message);
  }
}

/**
 * Builds a GraphMessagingConfig by merging static YAML config with
 * dynamic TS function refs resolved from the registry. Falls back to
 * the legacy initConfigRef when no inline config section is present.
 */
export function buildGraphMessagingConfigFromDsl(dsl: GraphDsl): GraphMessagingConfig | null {
  const cfg = dsl.config;
  const refs = dsl.runtimeConfigRefs;
  const hasInlineConfig = cfg && Object.keys(cfg.aiPrompts).length > 0;

  if (!hasInlineConfig) return null;

  const overlayPrefixes = cfg.overlayPrefixes && Object.keys(cfg.overlayPrefixes).length > 0 ? cfg.overlayPrefixes : undefined;
  const exampleTemplates = cfg.exampleTemplates && Object.keys(cfg.exampleTemplates).length > 0 ? cfg.exampleTemplates : undefined;

  const overlayPrefixFn = overlayPrefixes
    ? (overlay?: string) => overlayPrefixes[overlay ?? "default"] ?? overlayPrefixes["default"] ?? "To stay aligned, "
    : refs.overlayPrefixRef
      ? resolveConfigFn(refs.overlayPrefixRef)
      : () => "";

  const exampleGeneratorFn = exampleTemplates
    ? (params: { industry?: string | null; role?: string | null; topic: "role" | "industry" | "goal" | "timeframe" }) => {
        const industry = params.industry ?? "your industry";
        const templates = exampleTemplates[params.topic] ?? [];
        return templates.map((t) => interpolate(t, { industry }));
      }
    : refs.exampleGeneratorRef
      ? resolveConfigFn(refs.exampleGeneratorRef)
      : () => [];

  const messagePolicy = Object.fromEntries(
    Object.entries(cfg.messagePolicy).map(([k, v]) => [k, {
      allowAIRephrase: v.allowAIRephrase,
      forbidFirstPerson: v.forbidFirstPerson,
    }])
  ) as Record<MessageType, { allowAIRephrase: boolean; forbidFirstPerson: boolean }>;

  const aiPrompts = cfg.aiPrompts as GraphMessagingConfig["aiPrompts"];

  const strings = (cfg.strings && Object.keys(cfg.strings).length > 0) ? cfg.strings : undefined;
  const readout = (cfg.readout.sectionKeys.length > 0 || cfg.readout.sectionContract)
    ? { sectionKeys: cfg.readout.sectionKeys, sectionContract: cfg.readout.sectionContract }
    : undefined;

  const meta = cfg.meta?.steps?.length
    ? { flowTitle: cfg.meta.flowTitle, flowDescription: cfg.meta.flowDescription, steps: cfg.meta.steps }
    : undefined;
  const progressRules = cfg.progressRules?.questionKeyMap && Object.keys(cfg.progressRules.questionKeyMap).length > 0
    ? cfg.progressRules
    : undefined;
  const questionTemplates = cfg.questionTemplates?.length ? cfg.questionTemplates : undefined;
  const options = cfg.options && Object.keys(cfg.options).length > 0 ? cfg.options : undefined;
  const dynamicOptions = cfg.dynamicOptions && Object.keys(cfg.dynamicOptions).length > 0 ? cfg.dynamicOptions : undefined;
  const continuationTriggers = cfg.continuationTriggers?.length ? cfg.continuationTriggers : undefined;
  const ingestFieldMappings = cfg.ingestFieldMappings && Object.keys(cfg.ingestFieldMappings).length > 0 ? cfg.ingestFieldMappings : undefined;
  const signalAgents = cfg.signalAgents
    ? { enabled: cfg.signalAgents.enabled, ttlMs: cfg.signalAgents.ttlMs }
    : undefined;

  return {
    exampleGenerator: exampleGeneratorFn as GraphMessagingConfig["exampleGenerator"],
    overlayPrefix: overlayPrefixFn as GraphMessagingConfig["overlayPrefix"],
    clarifierRetryText: cfg.clarifierRetryText as GraphMessagingConfig["clarifierRetryText"],
    clarificationAcknowledgement: cfg.clarificationAcknowledgement,
    messagePolicy,
    aiPrompts,
    strings,
    readout,
    readoutRolePerspective: (cfg.readoutVoice.rolePerspective || undefined) as GraphMessagingConfig["readoutRolePerspective"],
    readoutVoiceCharacteristics: cfg.readoutVoice.voiceCharacteristics || undefined,
    readoutBehavioralIntent: cfg.readoutVoice.behavioralIntent || undefined,
    readoutOutputTargets: cfg.delivery.outputTargets as GraphMessagingConfig["readoutOutputTargets"],
    defaultReadoutOutputTargets: cfg.delivery.defaultOutputTargets as GraphMessagingConfig["defaultReadoutOutputTargets"],
    allowMultiTargetDelivery: cfg.delivery.allowMultiTarget,
    outputTargetOverridesByTenant: cfg.delivery.overridesByTenant as GraphMessagingConfig["outputTargetOverridesByTenant"],
    meta,
    overlayPrefixes,
    exampleTemplates,
    progressRules,
    questionTemplates,
    options,
    dynamicOptions,
    continuationTriggers,
    ingestFieldMappings,
    signalAgents,
  };
}

/**
 * Compiles a validated GraphDsl into a runnable LangGraph StateGraph.
 * Rejects schemas that attempt to redefine the shared state contract.
 * Returns a CompiledGraph wrapper with graphId for scoped config lookup.
 */
export function compileGraphFromDsl(inputDsl: GraphDsl): CompiledGraph {
  const dsl = expandAutoIngest(inputDsl);
  preflight(dsl);

  const graphId = dsl.graph.graphId;
  const builtConfig = buildGraphMessagingConfigFromDsl(dsl);
  if (builtConfig) {
    setGraphMessagingConfig(graphId, builtConfig);
  } else if (dsl.runtimeConfigRefs.initConfigRef) {
    const initFn = resolveConfig(dsl.runtimeConfigRefs.initConfigRef);
    initFn();
  }

  const graph: any = new StateGraph<CfsState>({
    channels: CFS_STATE_CHANNELS,
  } as any);

  for (const node of dsl.nodes) {
    let handler;
    if (node.handlerRef) {
      handler = resolveHandler(node.handlerRef);
      if (node.nodeConfig) {
        console.warn(`[graph-compiler] Node "${node.id}" has both handlerRef and nodeConfig; using handlerRef.`);
      }
    } else {
      handler = createGenericHandler(node, dsl.config);
    }
    graph.addNode(node.id, handler);
  }

  graph.setEntryPoint(dsl.graph.entrypoint);

  const routingRules = dsl.config?.routingRules ?? {};
  for (const ct of dsl.transitions.conditional) {
    const rules = routingRules[ct.from];
    const destMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(ct.destinations)) {
      destMap[key] = value === "__end__" ? END : value;
    }
    const router =
      rules && rules.length > 0
        ? (state: CfsState) => {
            const key = evaluateRoutingRules(rules, state);
            return destMap[key] !== undefined ? key : "end";
          }
        : resolveRouter(ct.routerRef);
    graph.addConditionalEdges(ct.from, router, destMap);
  }

  for (const st of dsl.transitions.static) {
    graph.addEdge(st.from, st.to === "__end__" ? END : st.to);
  }

  return { graphId, compiled: graph.compile() };
}
