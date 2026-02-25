import type { CfsState } from "../state.js";
import { requireGraphMessagingConfig } from "../infra.js";
import { getUseCaseGroups } from "../core/services/persona-groups.js";

export interface ChatOptions {
  items: string[];
}

const STATIC_OPTIONS: Record<string, string[]> = {
  CONFIRM_START: ["Yes", "No"],
  CONFIRM_ROLE: ["Yes, that's correct", "No, let me clarify"],
  S1_KYC_CONFIRM: ["Yes, let's continue", "No"],
  S1_TIMEFRAME: ["6 months", "12 months"],
};

export async function getOptionsForQuestionKey(
  questionKey: string | null | undefined,
  state: CfsState
): Promise<ChatOptions | null> {
  const trace = Array.isArray(state.session_context?.reason_trace) ? state.session_context.reason_trace : [];
  const readoutReady = state.readout_context?.status === "ready";
  if (
    !questionKey &&
    !state.session_context?.awaiting_user &&
    trace.includes("ask_use_case_questions:complete") &&
    !readoutReady &&
    (state.session_context.step === "STEP3_PERFORM_DISCOVERY" || state.session_context.step === "STEP4_BUILD_READOUT")
  ) {
    return { items: ["Continue to readout"] };
  }
  if (!questionKey) return null;

  // Prefer session_context.suggested_options (state), then config.options (YAML), then fallback
  const suggestedFromState = state.session_context?.suggested_options?.[questionKey];
  if (suggestedFromState && suggestedFromState.length > 0) return { items: suggestedFromState };

  try {
    const config = requireGraphMessagingConfig();
    const configOptions = config.options?.[questionKey];
    if (configOptions && configOptions.length > 0) return { items: configOptions };
  } catch {
    /* config not set */
  }

  const staticItems = STATIC_OPTIONS[questionKey];
  if (staticItems) return { items: staticItems };

  if (questionKey === "S1_USE_CASE_GROUP") {
    try {
      const groups = await getUseCaseGroups();
      if (groups.length > 0) return { items: groups };
    } catch {
      return null;
    }
  }

  if (questionKey === "S3_USE_CASE_SELECT") {
    const prioritized = state.use_case_context?.use_cases_prioritized ?? [];
    if (prioritized.length > 0) {
      const items = prioritized.map((uc: any, idx: number) => {
        const name = typeof uc === "string" ? uc : uc?.name ?? `Option ${idx + 1}`;
        return `${idx + 1}. ${name}`;
      });
      return { items };
    }
  }

  return null;
}
