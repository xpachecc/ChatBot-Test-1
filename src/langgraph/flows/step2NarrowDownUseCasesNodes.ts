import type { CfsState } from "../state.js";
import {
  pushAI,
  SpanSanitizer,
  configString,
} from "../infra.js";
import { numericSelectionIngest } from "../conversationPrimitives.js";
import {
  mergeStatePatch,
  patchSessionContext,
  buildDeterministicScores,
} from "../utilities.js";
import { invokeChatModelWithFallback } from "../aiHelpers.js";
import {
  retrieveUseCaseOptions,
  retrieveUseCaseQuestionBank,
} from "../vector.js";
import { CFS_STEPS } from "./stepFlowConfig.js";
import { getModel } from "../modelFactory.js";
import {
  parseCompositeQuestions,
  normalizeDiscoveryQuestions,
  mergeDiscoveryQuestions,
  normalizeWeaveValue,
  buildUseCaseQuestionsPrompt,
  buildUseCaseSelectionPrompt,
  parseUseCaseSelections,
  buildUseCaseSelectionMessage,
} from "./stepFlowHelpers.js";

declare global {
  // Optional test override for discovery questions.
  // eslint-disable-next-line no-var
  var __determineUseCaseQuestionsOverride: string[] | string | null | undefined;
}

export async function nodeDetermineUseCases(state: CfsState): Promise<Partial<CfsState>> {
  const goalStatement = state.user_context.goal_statement ?? "";
  const personaGroup = state.user_context.persona_group ?? "";
  const retrieval = await retrieveUseCaseOptions(state, goalStatement);
  const useCases = retrieval.useCases;
  const vectorContextUpdate = retrieval.vectorContextUpdate;

  if (useCases.length === 0) {
    return {
      ...vectorContextUpdate,
      ...pushAI(state, configString("step2.noUseCases", "No matching use cases were found at this time.")),
      ...patchSessionContext(state, {
        step: CFS_STEPS.STEP2_NARROW_DOWN_USE_CASES,
        awaiting_user: false,
        last_question_key: null,
        reason_trace: [...state.session_context.reason_trace, "determine_use_cases:empty_results"],
      }),
    };
  }

  let selections: Array<{ name: string; rank_score: number; engineering_insight: string }> = [];
  if (process.env.OPENAI_API_KEY) {
    const model = getModel("useCaseQuestions");
    const { system, user } = buildUseCaseSelectionPrompt({
      personaGroup,
      goalStatement,
      useCaseText: useCases,
      vectorContext: retrieval.snippets.join("\n"),
    });
    const raw = await invokeChatModelWithFallback(model, system, user, { runName: "determineUseCases", fallback: "" });
    const parsed = parseUseCaseSelections(raw);
    if (parsed.length > 0) {
      const sorted = parsed
        .slice(0, 4)
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.relevance_score - a.relevance_score);
      selections = sorted.map((item) => ({
        name: item.use_case_name,
        rank_score: Math.max(1, Math.min(100, Math.round(item.relevance_score))),
        engineering_insight: item.engineering_insight,
      }));
    }
  }

  if (selections.length === 0) {
    const scored = buildDeterministicScores(retrieval.results, useCases, { max: 4 });
    selections = scored.map((item) => ({
      name: item.name,
      rank_score: item.score,
      engineering_insight: "",
    }));
  }

  const topSelections = selections.slice(0, 4);
  const message = buildUseCaseSelectionMessage({
    goalStatement,
    selections: topSelections.map((item) => ({ name: item.name, engineering_insight: item.engineering_insight })),
  });
  return {
    ...vectorContextUpdate,
    ...pushAI(state, message),
    use_case_context: {
      ...state.use_case_context,
      use_cases_prioritized: topSelections.map((item, idx) => ({
        id: `use_case_${idx + 1}`,
        name: item.name,
        rank_score: item.rank_score,
        engineering_insight: item.engineering_insight,
      })),
    },
    ...patchSessionContext(state, {
      step: CFS_STEPS.STEP2_NARROW_DOWN_USE_CASES,
      awaiting_user: true,
      last_question_key: "S3_USE_CASE_SELECT",
      reason_trace: [...state.session_context.reason_trace, "determine_use_cases:ready"],
    }),
  };
}

export function nodeIngestUseCaseSelection(state: CfsState): Partial<CfsState> {
  if (!state.session_context.awaiting_user) return {};
  const available = (state.use_case_context.use_cases_prioritized ?? []).map((item) => ({
    name: typeof item === "object" && item && "name" in item ? String((item as Record<string, unknown>).name) : "",
  }));
  return numericSelectionIngest.run(state, {
    availableItems: available,
    questionKey: "S3_USE_CASE_SELECT",
    retryMessage: configString("step2.invalidSelection", "Please reply using only the number(s) shown in the list. For example: 1 or 1,3."),
    successMessage: configString("step2.selectionConfirm", "Great, we'll focus on the selected use case(s) next."),
    stateField: "use_case_context",
    stateItemKey: "selected_use_cases",
  });
}

export async function nodeDetermineUseCaseQuestions(state: CfsState): Promise<Partial<CfsState>> {
  const goalRaw = state.user_context.goal_statement ?? state.use_case_context.objective_normalized ?? "";
  const personaGroup = state.user_context.persona_group ?? "";
  if (!goalRaw.trim() || !personaGroup.trim()) {
    return {
      use_case_context: {
        ...state.use_case_context,
        discovery_question_bank: [],
        discovery_questions: [],
      },
      ...patchSessionContext(state, {
        reason_trace: [...state.session_context.reason_trace, "determine_use_case_questions:missing_inputs"],
      }),
    };
  }
  const goal = SpanSanitizer(goalRaw, "your goal");
  const outcome = SpanSanitizer(state.user_context.outcome ?? goal, goal);
  const queryText = [goal, outcome].filter(Boolean).join(" | ").trim();
  const retrieval = await retrieveUseCaseQuestionBank(state, queryText);
  const questionBank = retrieval.questions;
  const vectorContext = retrieval.snippets.join("\n");
  const vectorContextUpdate = retrieval.vectorContextUpdate;

  if (globalThis.__determineUseCaseQuestionsOverride !== undefined) {
    const override = globalThis.__determineUseCaseQuestionsOverride;
    const resolved = Array.isArray(override) ? override : parseCompositeQuestions(override ?? "");
    const normalized = resolved.filter(Boolean).slice(0, 3);
    const fallback = normalized.length === 3 ? normalized : questionBank.slice(0, 3);
    return {
      ...vectorContextUpdate,
      use_case_context: {
        ...state.use_case_context,
        discovery_question_bank: questionBank,
        discovery_questions: mergeDiscoveryQuestions(state.use_case_context.discovery_questions, normalizeDiscoveryQuestions(fallback)),
      },
      ...patchSessionContext(state, {
        reason_trace: [...state.session_context.reason_trace, "determine_use_case_questions:override"],
        ...(normalized.length === 3
          ? {}
          : { guardrail_log: [...state.session_context.guardrail_log, "guardrail:fail:discovery_questions_override"] }),
      }),
    };
  }

  if (!process.env.OPENAI_API_KEY || questionBank.length === 0) {
    return {
      ...vectorContextUpdate,
      use_case_context: {
        ...state.use_case_context,
        discovery_question_bank: questionBank,
        discovery_questions: mergeDiscoveryQuestions(
          state.use_case_context.discovery_questions,
          normalizeDiscoveryQuestions(questionBank.slice(0, 3))
        ),
      },
      ...patchSessionContext(state, {
        reason_trace: [...state.session_context.reason_trace, "determine_use_case_questions:fallback_bank"],
      }),
    };
  }

  const model = getModel("useCaseQuestions");
  const role = normalizeWeaveValue(state.user_context.persona_clarified_role ?? state.user_context.persona_role);
  const industry = normalizeWeaveValue(state.user_context.industry);
  const timeframe = normalizeWeaveValue(state.user_context.timeframe);
  const { system, user } = buildUseCaseQuestionsPrompt({
    problemStatement: state.use_case_context.objective_normalized ?? goal,
    goalStatement: goal,
    vectorContext,
    questionBank,
    role,
    industry,
    timeframe,
  });
  const text = await invokeChatModelWithFallback(model, system, user, {
    runName: "determineUseCaseQuestions",
    fallback: "",
  });
  const composite = parseCompositeQuestions(text);
  if (composite.length === 3) {
    return {
      ...vectorContextUpdate,
      use_case_context: {
        ...state.use_case_context,
        discovery_question_bank: questionBank,
        discovery_questions: mergeDiscoveryQuestions(state.use_case_context.discovery_questions, normalizeDiscoveryQuestions(composite)),
      },
      ...patchSessionContext(state, {
        reason_trace: [...state.session_context.reason_trace, "determine_use_case_questions:ai_ok"],
      }),
    };
  }
  return {
    ...vectorContextUpdate,
    use_case_context: {
      ...state.use_case_context,
      discovery_question_bank: questionBank,
      discovery_questions: mergeDiscoveryQuestions(
        state.use_case_context.discovery_questions,
        normalizeDiscoveryQuestions(questionBank.slice(0, 3))
      ),
    },
    ...patchSessionContext(state, {
      reason_trace: [...state.session_context.reason_trace, "determine_use_case_questions:ai_invalid"],
      guardrail_log: [...state.session_context.guardrail_log, "guardrail:fail:discovery_questions"],
    }),
  };
}
