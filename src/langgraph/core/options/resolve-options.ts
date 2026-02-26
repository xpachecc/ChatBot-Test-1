import type { CfsState } from "../../state.js";
import { requireGraphMessagingConfig } from "../../infra.js";
import { getUseCaseGroups } from "../services/persona-groups.js";

export interface ChatOptions {
  items: string[];
}

const SERVICE_REGISTRY: Record<string, () => Promise<string[]>> = {
  "persona-groups.getUseCaseGroups": getUseCaseGroups,
};

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchesContinuationTrigger(
  state: CfsState,
  trigger: { traceIncludes: string; notReadoutReady?: boolean; steps?: string[]; items: string[] }
): boolean {
  if (state.session_context?.awaiting_user) return false;
  const trace = Array.isArray(state.session_context?.reason_trace) ? state.session_context.reason_trace : [];
  if (!trace.includes(trigger.traceIncludes)) return false;
  if (trigger.notReadoutReady && state.readout_context?.status === "ready") return false;
  if (trigger.steps?.length && state.session_context?.step && !trigger.steps.includes(state.session_context.step)) {
    return false;
  }
  return true;
}

export async function getOptionsForQuestionKey(
  questionKey: string | null | undefined,
  state: CfsState
): Promise<ChatOptions | null> {
  let config;
  try {
    config = requireGraphMessagingConfig();
  } catch {
    return null;
  }
  const triggers = config.continuationTriggers ?? [];

  if (!questionKey) {
    for (const trigger of triggers) {
      if (matchesContinuationTrigger(state, trigger)) return { items: trigger.items };
    }
    return null;
  }

  const suggestedFromState = state.session_context?.suggested_options?.[questionKey];
  if (suggestedFromState && suggestedFromState.length > 0) return { items: suggestedFromState };

  const configOptions = config.options?.[questionKey];
  if (configOptions && configOptions.length > 0) return { items: configOptions };

  const dynamic = config.dynamicOptions?.[questionKey];
  if (dynamic) {
    if (dynamic.source === "service") {
      const fn = SERVICE_REGISTRY[dynamic.serviceRef];
      if (fn) {
        try {
          const items = await fn();
          if (items.length > 0) return { items };
        } catch {
          return null;
        }
      }
    } else if (dynamic.source === "state") {
      const value = getByPath(state, dynamic.statePath);
      const arr = Array.isArray(value) ? value : [];
      if (arr.length > 0) {
        const items = arr.map((uc: unknown, idx: number) => {
          const name = typeof uc === "string" ? uc : (uc as { name?: string })?.name ?? `Option ${idx + 1}`;
          return dynamic.format === "numbered_list" ? `${idx + 1}. ${name}` : String(name);
        });
        return { items };
      }
    }
  }

  return null;
}
