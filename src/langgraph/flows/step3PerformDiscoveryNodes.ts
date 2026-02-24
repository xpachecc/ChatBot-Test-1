import type { CfsState } from "../state.js";
import {
  pushAI,
  SpanSanitizer,
  TimeframeSanitizer,
  mergeStatePatch,
  patchSessionContext,
  interpolate,
  configString,
} from "../utilities.js";
import { assessAnswerRiskFromState, invokeChatModelWithFallback } from "../aiHelpers.js";
import { getAllPillars, getPillarsForOutcome } from "../pillars.js";
import { S3_DISCOVERY_QUESTION_KEY, CFS_STEPS } from "./stepFlowConfig.js";
import { getModel } from "../modelFactory.js";
import { questionnaireLoop } from "../infra.js";
import {
  sanitizeDiscoveryAnswer,
  buildDiscoveryQuestionPrompt,
  normalizePillarValues,
  buildAllowedPillarMap,
  parsePillarsFromAi,
  buildPillarsSelectionPrompt,
  normalizeUseCasePillarEntries,
  type PillarEntry,
} from "./stepFlowHelpers.js";

declare global {
  // Optional test override for pillar selection.
  // eslint-disable-next-line no-var
  var __determinePillarsOverride: string[] | string | null | undefined;
}

export async function nodeAskUseCaseQuestions(state: CfsState): Promise<Partial<CfsState>> {
  const rawQuestions = Array.isArray(state.use_case_context.discovery_questions)
    ? state.use_case_context.discovery_questions
    : [];
  const questionItems = rawQuestions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const question = typeof record.question === "string" ? record.question.trim() : "";
      if (!question) return null;
      const response = typeof record.response === "string" ? record.response : null;
      const risk = typeof record.risk === "string" ? record.risk : null;
      const risk_domain = typeof record.risk_domain === "string" ? record.risk_domain : null;
      return { question, response, risk, risk_domain };
    })
    .filter(
      (item): item is { question: string; response: string | null; risk: string | null; risk_domain: string | null } => Boolean(item)
    );
  const total = questionItems.length;

  const name = SpanSanitizer(state.user_context.first_name, "there");
  const role = SpanSanitizer(state.user_context.persona_clarified_role ?? state.user_context.persona_role, "your role");
  const industry = SpanSanitizer(state.user_context.industry, "your industry");
  const timeframe = TimeframeSanitizer(state.user_context.timeframe);
  const introTemplate = configString(
    "step3.introTemplate",
    "{{name}},\n\nNow focusing on the selected use cases and their impacts on {{industry}} and {{role}} and knowing we want tangible results within {{timeframe}}; I want to ask you {{total}} tailored questions, one a time."
  );
  const introMessage = interpolate(introTemplate, { name, role, industry, timeframe, total: String(total) });

  const result = await questionnaireLoop.run(state, {
    questions: questionItems,
    questionKey: S3_DISCOVERY_QUESTION_KEY,
    buildPrompt: buildDiscoveryQuestionPrompt,
    sanitizeAnswer: sanitizeDiscoveryAnswer,
    processAnswer: async (s, q, a) => {
      const assessment = await assessAnswerRiskFromState(s, q, a);
      return { risk: assessment.risk_statement, risk_domain: assessment.risk_domain };
    },
    closingMessage: configString("step3.closingMessage", "Thanks — that helps. Next I'll map the best solution areas for your use case(s) and prepare your readout."),
    stateField: "use_case_context",
    stateItemKey: "discovery_questions",
    introMessage,
    reasonTraceStart: "ask_use_case_questions:start",
    reasonTraceComplete: "ask_use_case_questions:complete",
    reasonTraceEmpty: "ask_use_case_questions:empty",
  });

  const trace = result.session_context?.reason_trace ?? state.session_context.reason_trace;
  const discoveryComplete = Array.isArray(trace) && trace.includes("ask_use_case_questions:complete");

  return {
    ...result,
    ...patchSessionContext(state, {
      ...(result.session_context ?? {}),
      step: discoveryComplete ? CFS_STEPS.STEP4_BUILD_READOUT : CFS_STEPS.STEP3_PERFORM_DISCOVERY,
    }),
  };
}

function toEntries(names: string[], confidence: number): PillarEntry[] {
  return names.map((name) => ({ name, confidence }));
}

function buildPillarStateUpdate(state: CfsState, entries: PillarEntry[]): Partial<CfsState> {
  return {
    use_case_context: { ...state.use_case_context, pillars: entries },
  };
}

function filterAiEntries(entries: PillarEntry[], allowedMap: Map<string, string>): PillarEntry[] {
  const seen = new Set<string>();
  return entries
    .map((entry) => {
      const canonical = allowedMap.get(entry.name.trim().toLowerCase());
      if (!canonical) return null;
      if (seen.has(canonical)) return null;
      seen.add(canonical);
      return { name: canonical, confidence: entry.confidence };
    })
    .filter((entry): entry is PillarEntry => entry !== null);
}

export async function nodeDeterminePillars(state: CfsState): Promise<Partial<CfsState>> {
  const outcomeRaw = state.user_context.outcome ?? "";
  const outcome = SpanSanitizer(outcomeRaw, "unknown").trim();
  const selectedUseCases = normalizePillarValues(
    (state.use_case_context.selected_use_cases ?? []).map((item) => (typeof item === "string" ? item : ""))
  );

  let rpcPillars: string[] = [];
  if (outcome) {
    try {
      rpcPillars = normalizePillarValues(await getPillarsForOutcome(outcome));
    } catch {
      rpcPillars = [];
    }
  }

  if (rpcPillars.length) {
    return {
      ...buildPillarStateUpdate(state, toEntries(rpcPillars, 1.0)),
      ...patchSessionContext(state, {
        step: CFS_STEPS.STEP4_BUILD_READOUT,
        reason_trace: [...state.session_context.reason_trace, "determine_pillars:rpc_ok"],
      }),
    };
  }

  let allowed: string[] = [];
  try {
    allowed = normalizePillarValues(await getAllPillars());
  } catch {
    allowed = [];
  }
  if (!allowed.length) {
    return {
      ...buildPillarStateUpdate(state, []),
      ...patchSessionContext(state, {
        step: CFS_STEPS.STEP4_BUILD_READOUT,
        reason_trace: [...state.session_context.reason_trace, "determine_pillars:empty"],
        guardrail_log: [...state.session_context.guardrail_log, "guardrail:fail:pillars_empty"],
      }),
    };
  }

  if (globalThis.__determinePillarsOverride !== undefined) {
    const override = globalThis.__determinePillarsOverride;
    const aiEntries = Array.isArray(override)
      ? override.map((name) => ({ name, confidence: 1.0 }))
      : parsePillarsFromAi((override ?? "").toString());
    const allowedMap = buildAllowedPillarMap(allowed);
    const filtered = filterAiEntries(aiEntries, allowedMap);
    if (filtered.length) {
      return {
        ...buildPillarStateUpdate(state, filtered),
        ...patchSessionContext(state, {
          step: CFS_STEPS.STEP4_BUILD_READOUT,
          reason_trace: [...state.session_context.reason_trace, "determine_pillars:override"],
        }),
      };
    }
    return {
      ...buildPillarStateUpdate(state, toEntries(allowed, 0)),
      ...patchSessionContext(state, {
        step: CFS_STEPS.STEP4_BUILD_READOUT,
        reason_trace: [...state.session_context.reason_trace, "determine_pillars:override_invalid"],
        guardrail_log: [...state.session_context.guardrail_log, "guardrail:fail:pillars_override"],
      }),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      ...buildPillarStateUpdate(state, toEntries(allowed, 0)),
      ...patchSessionContext(state, {
        step: CFS_STEPS.STEP4_BUILD_READOUT,
        reason_trace: [...state.session_context.reason_trace, "determine_pillars:ai_unavailable"],
        guardrail_log: [...state.session_context.guardrail_log, "guardrail:fail:pillars_ai_unavailable"],
      }),
    };
  }

  const { system, user } = buildPillarsSelectionPrompt({
    outcome,
    selectedUseCases,
    allowedPillars: allowed,
  });
  const model = getModel("useCaseQuestions");
  const respText = await invokeChatModelWithFallback(model, system, user, {
    runName: "determinePillars",
    fallback: "",
  });
  const aiEntries = parsePillarsFromAi(respText);
  const allowedMap = buildAllowedPillarMap(allowed);
  const filtered = filterAiEntries(aiEntries, allowedMap);
  if (filtered.length) {
    return {
      ...buildPillarStateUpdate(state, filtered),
      ...patchSessionContext(state, {
        step: CFS_STEPS.STEP4_BUILD_READOUT,
        reason_trace: [...state.session_context.reason_trace, "determine_pillars:ai_ok"],
      }),
    };
  }
  return {
    ...buildPillarStateUpdate(state, toEntries(allowed, 0)),
    ...patchSessionContext(state, {
      step: CFS_STEPS.STEP4_BUILD_READOUT,
      reason_trace: [...state.session_context.reason_trace, "determine_pillars:ai_invalid"],
      guardrail_log: [...state.session_context.guardrail_log, "guardrail:fail:pillars_ai_invalid"],
    }),
  };
}
