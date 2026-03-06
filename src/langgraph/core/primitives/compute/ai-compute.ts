import type { CfsState } from "../../../state.js";
import { buildNestedPatch } from "../../helpers/path.js";
import { requireGraphMessagingConfig } from "../../config/messaging.js";
import { getModel } from "../../config/model-factory.js";
import { invokeChatModelWithFallback } from "../../services/ai/invoke.js";
import { parsePillarsFromAi, parseJsonObject, parseCompositeQuestions } from "../../helpers/parsing.js";
import type { PillarEntry } from "../../helpers/parsing.js";

export type AiComputeParams = {
  modelAlias: string;
  systemPromptKey: string;
  inputOverrides: Record<string, unknown>;
  buildUserPrompt: (params: Record<string, unknown>) => string;
  responseParser: string | ((text: string) => unknown);
  outputPath: string;
  runName?: string;
};

export const PARSER_REGISTRY: Record<string, (text: string) => unknown> = {
  parsePillarsFromAi: (t) => parsePillarsFromAi(t) as PillarEntry[],
  parseJsonObject: (t) => parseJsonObject(t),
  parseCompositeQuestions: (t) => parseCompositeQuestions(t),
  identity: (t) => t,
};

/**
 * Generic AI compute primitive: build prompt from config + inputs, call model, parse response, write to state.
 * Used by nodeDeterminePillars and future archetype-based nodes.
 */
export async function runAiCompute(
  state: CfsState,
  params: AiComputeParams
): Promise<{ result: unknown; statePatch: Partial<CfsState> }> {
  const config = requireGraphMessagingConfig();
  const system = (config.aiPrompts as Record<string, string>)[params.systemPromptKey] ?? "";
  const user = params.buildUserPrompt(params.inputOverrides);

  let model;
  try {
    model = getModel(params.modelAlias);
  } catch {
    return {
      result: null,
      statePatch: {},
    };
  }

  const respText = await invokeChatModelWithFallback(model, system, user, {
    runName: params.runName ?? "aiCompute",
    fallback: "",
  });

  const parser = typeof params.responseParser === "string"
    ? PARSER_REGISTRY[params.responseParser]
    : params.responseParser;
  const result = parser ? parser(respText) : respText;

  const statePatch = buildNestedPatch(state, params.outputPath, result);
  return { result, statePatch };
}
