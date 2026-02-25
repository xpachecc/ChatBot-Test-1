import path from "node:path";
import { fileURLToPath } from "node:url";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { CfsStateSchema, type CfsState, type GraphMessagingConfig, type MessageType } from "./state.js";
import { createInitialState, requireGraphMessagingConfig, prependClarificationAcknowledgement } from "./infra.js";
import { reviewResponseWithAI } from "./core/guards/review.js";
import { registerCfsHandlers } from "./schema/cfs-handlers.js";
import { loadAndCompileGraph } from "./schema/graph-loader.js";
import type { CompileResult } from "./schema/graph-compiler.js";

export type { CfsState } from "./state.js";
export { CfsStateSchema } from "./state.js";
export { createInitialState } from "./infra.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CFS_YAML = path.resolve(__dirname, "../../graphs/cfs.flow.yaml");

export function buildGraphFromSchema(yamlPath: string): CompileResult {
  registerCfsHandlers();
  return loadAndCompileGraph(yamlPath);
}

export function buildCfsGraph(): CompileResult {
  return buildGraphFromSchema(DEFAULT_CFS_YAML);
}

export const graph = buildCfsGraph();

function findLastAIIndex(messages: unknown[], startFrom: number): number {
  for (let i = messages.length - 1; i >= startFrom; i--) {
    if (messages[i] instanceof AIMessage) return i;
  }
  return -1;
}

export async function runTurn(graphApp: CompileResult, state: CfsState, userText?: string): Promise<CfsState> {
  const nextState: CfsState = CfsStateSchema.parse({
    ...state,
    session_context: { ...state.session_context },
    messages: userText ? [...state.messages, new HumanMessage(userText)] : state.messages,
  });
  const inputLen = nextState.messages.length;
  const wasClarifier = nextState.session_context.step_clarifier_used === true;

  const result = await graphApp.invoke(nextState);
  const parsed = CfsStateSchema.parse(result);

  const lastNewIdx = findLastAIIndex(parsed.messages, inputLen);
  if (lastNewIdx < 0) return parsed;

  let config: GraphMessagingConfig | null = null;
  try { config = requireGraphMessagingConfig(); } catch { /* not set yet */ }
  if (!config) return parsed;

  const lastNewAI = parsed.messages[lastNewIdx] as AIMessage;
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
    const updated = [...parsed.messages];
    updated[lastNewIdx] = new AIMessage({ content: text, additional_kwargs: lastNewAI.additional_kwargs });
    return CfsStateSchema.parse({ ...parsed, messages: updated });
  }

  return parsed;
}
