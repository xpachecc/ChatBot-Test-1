import { StateGraph, END } from "@langchain/langgraph";
import type { CfsState, GraphMessagingConfig, MessageType } from "../state.js";
import type { GraphDsl } from "./graph-dsl-types.js";
import { resolveHandler, resolveRouter, resolveConfig, resolveConfigFn } from "./handler-registry.js";
import { setGraphMessagingConfig } from "../core/config/messaging.js";
import { interpolate } from "../core/helpers/template.js";

const SUPPORTED_STATE_CONTRACTS = ["state.CfsStateSchema"];

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
    resolveHandler(node.handlerRef);
  }

  for (const ct of dsl.transitions.conditional) {
    if (!nodeIds.has(ct.from)) {
      throw new Error(`Conditional transition "from" node "${ct.from}" is not declared.`);
    }
    resolveRouter(ct.routerRef);
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
  const options = cfg.options && Object.keys(cfg.options).length > 0 ? cfg.options : undefined;

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
    options,
  };
}

/**
 * Compiles a validated GraphDsl into a runnable LangGraph StateGraph.
 * Rejects schemas that attempt to redefine the shared state contract.
 */
export function compileGraphFromDsl(dsl: GraphDsl): CompileResult {
  preflight(dsl);

  const builtConfig = buildGraphMessagingConfigFromDsl(dsl);
  if (builtConfig) {
    setGraphMessagingConfig(builtConfig);
  } else if (dsl.runtimeConfigRefs.initConfigRef) {
    const initFn = resolveConfig(dsl.runtimeConfigRefs.initConfigRef);
    initFn();
  }

  const graph: any = new StateGraph<CfsState>({
    channels: CFS_STATE_CHANNELS,
  } as any);

  for (const node of dsl.nodes) {
    const handler = resolveHandler(node.handlerRef);
    graph.addNode(node.id, handler);
  }

  graph.setEntryPoint(dsl.graph.entrypoint);

  for (const ct of dsl.transitions.conditional) {
    const router = resolveRouter(ct.routerRef);
    const destMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(ct.destinations)) {
      destMap[key] = value === "__end__" ? END : value;
    }
    graph.addConditionalEdges(ct.from, router, destMap);
  }

  for (const st of dsl.transitions.static) {
    graph.addEdge(st.from, st.to === "__end__" ? END : st.to);
  }

  return graph.compile();
}
