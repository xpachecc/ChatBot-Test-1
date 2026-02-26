import type { CfsState } from "../../../state.js";
import { requireGraphMessagingConfig } from "../../config/messaging.js";
import { getModel } from "../../config/model-factory.js";
import { invokeChatModelWithFallback } from "../../services/ai/invoke.js";
import { parsePillarsFromAi } from "../../helpers/parsing.js";
import type { PillarEntry } from "../../helpers/parsing.js";

export type AiComputeParams = {
  modelAlias: string;
  systemPromptKey: string;
  inputOverrides: Record<string, unknown>;
  buildUserPrompt: (params: Record<string, unknown>) => string;
  responseParser: "parsePillarsFromAi" | ((text: string) => unknown);
  outputPath: string;
  runName?: string;
};

const PARSER_REGISTRY: Record<string, (text: string) => unknown> = {
  parsePillarsFromAi: (t) => parsePillarsFromAi(t) as PillarEntry[],
};

function buildStatePatch(state: CfsState, path: string, value: unknown): Partial<CfsState> {
  const parts = path.split(".");
  if (parts.length === 1) return { [parts[0]]: value } as Partial<CfsState>;
  const [slice, ...rest] = parts;
  const sliceState = (state as Record<string, unknown>)[slice];
  const base = sliceState && typeof sliceState === "object" ? { ...sliceState } : {};
  let current: Record<string, unknown> = base;
  for (let i = 0; i < rest.length - 1; i++) {
    const part = rest[i];
    const next = (current[part] && typeof current[part] === "object" ? { ...(current[part] as object) } : {}) as Record<string, unknown>;
    current[part] = next;
    current = next;
  }
  current[rest[rest.length - 1]] = value;
  return { [slice]: base } as Partial<CfsState>;
}

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

  const statePatch = buildStatePatch(state, params.outputPath, result);
  return { result, statePatch };
}
