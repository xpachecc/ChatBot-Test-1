import type { CfsState } from "./state.js";
import { requireGraphMessagingConfig } from "./utilities.js";

export type StepProgressStatus = "completed" | "in_progress" | "upcoming";

export type StepProgress = {
  key: string;
  label: string;
  order: number;
  status: StepProgressStatus;
  countable: boolean;
  totalQuestions: number;
  answeredQuestions: number;
  percentage: number;
};

export type FlowProgress = {
  flowTitle: string;
  flowDescription: string;
  steps: StepProgress[];
};

type FlowMetaStep = {
  key: string;
  label: string;
  order: number;
  countable: boolean;
  totalQuestions: number;
  countingStrategy?: "questionKeyMap" | "useCaseSelect" | "readoutReady" | "dynamicCount";
};

const DEFAULT_FLOW_META: { flowTitle: string; flowDescription: string; steps: FlowMetaStep[] } = {
  flowTitle: "Discovery Account Executive",
  flowDescription: "This automated assessment analyzes your needs to provide personalized strategic insights.",
  steps: [
    { key: "STEP1_KNOW_YOUR_CUSTOMER", label: "Know Your Customer", order: 1, countable: true, totalQuestions: 6, countingStrategy: "questionKeyMap" },
    { key: "STEP2_NARROW_DOWN_USE_CASES", label: "Narrow Down Use Cases", order: 2, countable: true, totalQuestions: 1, countingStrategy: "useCaseSelect" },
    { key: "STEP3_PERFORM_DISCOVERY", label: "Perform Discovery", order: 3, countable: true, totalQuestions: 3, countingStrategy: "dynamicCount" },
    { key: "STEP4_BUILD_READOUT", label: "Build Readout", order: 4, countable: true, totalQuestions: 1, countingStrategy: "readoutReady" },
    { key: "STEP5_READOUT_SUMMARY_NEXT_STEPS", label: "Readout Summary and Next Steps", order: 5, countable: true, totalQuestions: 1, countingStrategy: "readoutReady" },
  ],
};

const DEFAULT_QUESTION_KEY_MAP: Record<string, number> = {
  S1_USE_CASE_GROUP: 0,
  CONFIRM_START: 1,
  S1_NAME: 1,
  S1_INDUSTRY: 2,
  S1_INTERNET_SEARCH: 2,
  S1_ROLE: 3,
  CONFIRM_ROLE: 4,
  S1_TIMEFRAME: 4,
  S1_KYC_CONFIRM: 5,
};

/**
 * Compute flow progress from state using config-driven meta and progress rules.
 * Falls back to CFS defaults when config is unavailable (e.g. direct test invocation).
 */
export function computeFlowProgress(state: CfsState): FlowProgress {
  let meta = DEFAULT_FLOW_META;
  let questionKeyMap = DEFAULT_QUESTION_KEY_MAP;
  let dynamicCountField = "use_case_context.discovery_questions";
  let dynamicCountStepKey = "STEP3_PERFORM_DISCOVERY";
  let useCaseSelectQuestionKey = "S3_USE_CASE_SELECT";

  try {
    const config = requireGraphMessagingConfig();
    if (config.meta?.steps?.length) {
      meta = config.meta as typeof DEFAULT_FLOW_META;
    }
    if (config.progressRules?.questionKeyMap && Object.keys(config.progressRules.questionKeyMap).length) {
      questionKeyMap = config.progressRules.questionKeyMap;
    }
    if (config.progressRules?.dynamicCountField) {
      dynamicCountField = config.progressRules.dynamicCountField;
    }
    if (config.progressRules?.dynamicCountStepKey) {
      dynamicCountStepKey = config.progressRules.dynamicCountStepKey;
    }
    if (config.progressRules?.useCaseSelectQuestionKey) {
      useCaseSelectQuestionKey = config.progressRules.useCaseSelectQuestionKey;
    }
  } catch {
    /* config not set — use defaults */
  }

  const currentStepKey = state.session_context.step;
  const stepOrder = meta.steps.map((s) => s.key);
  const currentIdx = stepOrder.indexOf(currentStepKey);

  const steps: StepProgress[] = meta.steps.map((metaStep, idx) => {
    const status: StepProgressStatus =
      idx < currentIdx ? "completed" : idx === currentIdx ? "in_progress" : "upcoming";

    let totalQuestions = metaStep.totalQuestions;
    let answeredQuestions = 0;

    if (metaStep.countable) {
      const strategy = metaStep.countingStrategy;

      if (strategy === "questionKeyMap") {
        answeredQuestions = status === "completed" ? totalQuestions : (questionKeyMap[state.session_context.last_question_key ?? ""] ?? 0);
      } else if (strategy === "useCaseSelect") {
        const step2Cond = state.session_context.last_question_key === useCaseSelectQuestionKey && state.session_context.awaiting_user;
        answeredQuestions = status === "completed" ? totalQuestions : status === "upcoming" ? 0 : (step2Cond ? 0 : 1);
      } else if (strategy === "readoutReady") {
        answeredQuestions = status === "completed" ? totalQuestions : (state.readout_context?.status === "ready" ? 1 : 0);
      } else if (strategy === "dynamicCount" || (strategy === undefined && metaStep.key === dynamicCountStepKey)) {
        const parts = dynamicCountField.split(".");
        let arr: unknown[] = [];
        if (parts[0] === "use_case_context" && parts[1] === "discovery_questions") {
          arr = state.use_case_context?.discovery_questions ?? [];
        }
        const questions = Array.isArray(arr) ? arr : [];
        const total = questions.length || 3;
        totalQuestions = total;
        const responseCount = questions.filter((q: unknown) => q && typeof q === "object" && "response" in (q as object) && (q as { response?: unknown }).response != null).length;
        if (status === "upcoming") {
          answeredQuestions = 0;
        } else if (status === "completed" || (total > 0 && responseCount >= total)) {
          answeredQuestions = total;
        } else if (currentStepKey === dynamicCountStepKey) {
          answeredQuestions = responseCount;
        }
      }
    }

    const clampedAnswered = Math.max(0, Math.min(answeredQuestions, totalQuestions));
    const percentage =
      metaStep.countable && totalQuestions > 0
        ? Math.min(100, Math.round((clampedAnswered / totalQuestions) * 100))
        : 0;

    return {
      key: metaStep.key,
      label: metaStep.label,
      order: metaStep.order,
      status,
      countable: metaStep.countable,
      totalQuestions,
      answeredQuestions: clampedAnswered,
      percentage,
    };
  });

  return { flowTitle: meta.flowTitle, flowDescription: meta.flowDescription, steps };
}
