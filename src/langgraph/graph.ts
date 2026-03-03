import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { CfsStateSchema, type CfsState, type GraphMessagingConfig, type MessageType } from "./state.js";
import { createInitialState, requireGraphMessagingConfig, prependClarificationAcknowledgement } from "./infra.js";
import { runSignalOrchestrator } from "./core/agents/index.js";
import { reviewResponseWithAI } from "./core/guards/review.js";
import { registerHandlersForGraph } from "./schema/graph-handler-modules.js";
import { loadGraphDsl } from "./schema/graph-loader.js";
import { compileGraphFromDsl } from "./schema/graph-compiler.js";
import type { CompiledGraph } from "./schema/graph-compiler.js";
import { setActiveGraphId } from "./core/config/messaging.js";
import { getDefaultFlowPath } from "../config/appConfig.js";

export type { CfsState } from "./state.js";
export type { CompiledGraph } from "./schema/graph-compiler.js";
export { CfsStateSchema } from "./state.js";
export { createInitialState } from "./infra.js";

const DEFAULT_CFS_YAML = getDefaultFlowPath();

export function buildGraphFromSchema(yamlPath: string): CompiledGraph {
  const dsl = loadGraphDsl(yamlPath);
  registerHandlersForGraph(dsl.graph.graphId);
  return compileGraphFromDsl(dsl);
}

export function buildCfsGraph(): CompiledGraph {
  return buildGraphFromSchema(DEFAULT_CFS_YAML);
}

/** LangGraph Studio expects a compiled graph; export the compiled instance. */
export const graph = buildCfsGraph().compiled;

function findLastAIIndex(messages: unknown[], startFrom: number): number {
  for (let i = messages.length - 1; i >= startFrom; i--) {
    if (messages[i] instanceof AIMessage) return i;
  }
  return -1;
}

export async function runTurn(graphApp: CompiledGraph, state: CfsState, userText?: string): Promise<CfsState> {
  const nextState: CfsState = CfsStateSchema.parse({
    ...state,
    session_context: { ...state.session_context },
    messages: userText ? [...state.messages, new HumanMessage(userText)] : state.messages,
  });
  const inputLen = nextState.messages.length;
  const wasClarifier = nextState.session_context.step_clarifier_used === true;

  setActiveGraphId(graphApp.graphId);

  let config: GraphMessagingConfig | null = null;
  try { config = requireGraphMessagingConfig(); } catch { /* not set yet */ }
  const signalConfig = config?.signalAgents;
  const orchestratorPromise =
    signalConfig?.enabled && userText?.trim()
      ? runSignalOrchestrator(userText, nextState, signalConfig).catch(() => null)
      : Promise.resolve(null);

  const result = await graphApp.compiled.invoke(nextState);
  const parsed = CfsStateSchema.parse(result);

  const signals = await Promise.race([
    orchestratorPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
  ]);
  const finalParsed = signals
    ? CfsStateSchema.parse({ ...parsed, relationship_context: { ...parsed.relationship_context, ...signals } })
    : parsed;

  const lastNewIdx = findLastAIIndex(finalParsed.messages, inputLen);
  if (lastNewIdx < 0) return finalParsed;

  if (!config) return finalParsed;

  const lastNewAI = finalParsed.messages[lastNewIdx] as AIMessage;
  let text = lastNewAI.content?.toString() ?? "";
  const messageType = (lastNewAI.additional_kwargs?.message_type ?? "default") as MessageType;
  const policy = config.messagePolicy[messageType] ?? config.messagePolicy.default;

  if (wasClarifier && text) {
    text = prependClarificationAcknowledgement(text);
  }

  if (policy?.allowAIRephrase && text) {
    text = await reviewResponseWithAI(text, { forbidFirstPerson: policy.forbidFirstPerson });
  }

  if (text !== (lastNewAI.content?.toString() ?? "")) {
    const updated = [...finalParsed.messages];
    updated[lastNewIdx] = new AIMessage({ content: text, additional_kwargs: lastNewAI.additional_kwargs });
    return CfsStateSchema.parse({ ...finalParsed, messages: updated });
  }

  return finalParsed;
}
