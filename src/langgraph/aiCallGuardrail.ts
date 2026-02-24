import type { ChatOpenAI } from "@langchain/openai";
import type { CfsState } from "./state.js";
import { invokeChatModelWithFallback } from "./aiHelpers.js";

export type AiCallSource = "ai" | "fallback" | "parse_fail";

export type AiCallGuardrailParams<T> = {
  model: ChatOpenAI | null;
  system: string;
  user: string;
  runName: string;
  fallback: T;
  parse?: (raw: string) => T | null;
  reasonTraceLabel?: string;
  guardrailLabel?: string;
  state?: CfsState;
};

export type AiCallGuardrailResult<T> = {
  value: T;
  source: AiCallSource;
  reasonTracePatch?: Partial<CfsState>;
  guardrailLogPatch?: Partial<CfsState>;
};

/**
 * Invoke an AI model with guardrails: fallback on error, optional JSON parsing,
 * and optional reason_trace/guardrail_log updates for audit.
 *
 * @param params - Model, prompts, fallback, optional parser, optional state for logging.
 * @returns The parsed/fallback value plus optional session patches for trace/guardrail.
 */
export async function aiCallWithGuardrail<T>(params: AiCallGuardrailParams<T>): Promise<AiCallGuardrailResult<T>> {
  const { model, system, user, runName, fallback, parse, reasonTraceLabel, guardrailLabel, state } = params;

  if (!model) {
    const patches = buildPatches(state, reasonTraceLabel, guardrailLabel, "fallback");
    return { value: fallback, source: "fallback", ...patches };
  }

  const raw = await invokeChatModelWithFallback(model, system, user, { runName, fallback: "" });
  if (!raw || !raw.trim()) {
    const patches = buildPatches(state, reasonTraceLabel, guardrailLabel, "fallback");
    return { value: fallback, source: "fallback", ...patches };
  }

  if (parse) {
    try {
      const parsed = parse(raw);
      if (parsed !== null && parsed !== undefined) {
        const patches = buildPatches(state, reasonTraceLabel, guardrailLabel, "ai");
        return { value: parsed, source: "ai", ...patches };
      }
    } catch {
      const patches = buildPatches(state, reasonTraceLabel, guardrailLabel, "parse_fail");
      return { value: fallback, source: "parse_fail", ...patches };
    }
  }

  const patches = buildPatches(state, reasonTraceLabel, guardrailLabel, "ai");
  return { value: raw as T, source: "ai", ...patches };
}

function buildPatches(
  state: CfsState | undefined,
  reasonTraceLabel: string | undefined,
  guardrailLabel: string | undefined,
  outcome: "ai" | "fallback" | "parse_fail"
): {
  reasonTracePatch?: Partial<CfsState>;
  guardrailLogPatch?: Partial<CfsState>;
} {
  if (!state) return {};

  const patches: { reasonTracePatch?: Partial<CfsState>; guardrailLogPatch?: Partial<CfsState> } = {};
  if (reasonTraceLabel) {
    const entry = outcome === "ai" ? `${reasonTraceLabel}:ok` : `${reasonTraceLabel}:${outcome}`;
    patches.reasonTracePatch = {
      session_context: {
        ...state.session_context,
        reason_trace: [...state.session_context.reason_trace, entry],
      },
    };
  }
  if (guardrailLabel && outcome !== "ai") {
    patches.guardrailLogPatch = {
      session_context: {
        ...state.session_context,
        guardrail_log: [...state.session_context.guardrail_log, `guardrail:fail:${guardrailLabel}`],
      },
    };
  }
  return patches;
}
