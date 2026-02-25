import type { CfsState } from "../state.js";
import {
  PrimitivesInstance,
  lastHumanMessage,
  pushAI,
  prependClarificationAcknowledgement,
  SpanSanitizer,
  TimeframeSanitizer,
  applyUserAnswer,
  selectOutcomeName,
  askWithRephrase,
  clarifyIfVague,
  vectorSelect,
  ingestDispatcher,
  configString,
  interpolate,
  type IngestHandler,
} from "../infra.js";
import { mergeStatePatch, patchSessionContext } from "../infra.js";
import { invokeChatModelWithFallback } from "../core/services/ai/invoke.js";
import { resolvePersonaGroupFromRole } from "../core/services/ai/resolve-persona.js";
import { getPersonaGroups } from "../core/services/persona-groups.js";
import {
  buildVectorFilters,
  retrieveMarketSegmentCandidates,
  retrieveOutcomeCandidates,
  resolveMarketSegment,
} from "../core/services/vector.js";
import { getSubIndustrySuggestions, isIndustryVague } from "../core/services/internet-search.js";
import { getModel } from "../core/config/model-factory.js";
import {
  isAffirmativeAnswer,
  buildRoleAssessmentMessage,
  buildGoalSummary,
  buildKnowYourCustomerEchoFallback,
} from "./step-flow-helpers.js";

declare global {
  // Optional test override for the recap node.
  // eslint-disable-next-line no-var
  var __knowYourCustomerEchoOverride: string | null | undefined;
}

export function nodeInit(state: CfsState): Partial<CfsState> {
  const greet = configString("step1.greet", "Welcome to Pure Storage!");
  const followup = configString("step1.followup", "Thank you for showing interest in the TCO model.\nTell me, what Enterprise Data challenge do you have that brings you here today?");
  const withGreet = pushAI(state, greet, "intro");
  const withFollowup = pushAI(mergeStatePatch(state, withGreet), followup, "intro");
  const greetState: CfsState = {
    ...mergeStatePatch(state, withFollowup),
    ...patchSessionContext(state, {
      started: true,
      awaiting_user: true,
      last_question_key: "S1_USE_CASE_GROUP",
      step_question_index: 0,
      step_clarifier_used: false,
    }),
  };
  return greetState;
}

export function nodeAskUserName(state: CfsState): Partial<CfsState> {
  return PrimitivesInstance.AskQuestion.run(state, {
    question: configString("step1.nameQuestion", "Before we get started, what's your first name?"),
    questionKey: "S1_NAME",
    questionPurpose: "collect_name",
    targetVariable: "name",
  });
}

export function nodeAskIndustry(state: CfsState): Partial<CfsState> {
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const intro = interpolate(configString("step1.industryIntro", "It's great meeting you {{name}}."), { name });
  const body = configString("step1.industryBody", "To provide precise architectural guidance, I need to understand your domain.\nSystem requirements shift significantly between industries—a solution for Telecom differs fundamentally from Healthcare, just as Pharma requires a different approach than Hospital Networks.");
  const ask = configString("step1.industryPrompt", "\n\n**What industry and specialized focus are you solving for?");
  const prompt = [intro, "", body, "", ask].join("\n");
  return PrimitivesInstance.AskQuestion.run(state, {
    question: prompt,
    questionKey: "S1_INDUSTRY",
    questionPurpose: "collect_industry",
    targetVariable: "industry",
  });
}

export async function nodeAskRole(state: CfsState): Promise<Partial<CfsState>> {
  const name = SpanSanitizer(state.user_context.first_name, "there");
  return askWithRephrase.run(state, {
    baseQuestion: configString("step1.roleQuestion", "What is your role in the organization - how are you accountable?"),
    questionKey: "S1_ROLE",
    questionPurpose: "collect_role",
    targetVariable: "role",
    prefix: name,
    allowAIRephrase: true,
    rephraseContext: {
      industry: state.user_context.industry,
      role: state.user_context.persona_role,
      useCaseGroups: state.use_case_context.use_case_groups,
      actorRole: "SAAS Enterprise Account Executive",
      tone: "conversational, curious",
    },
  });
}

export async function nodeAskTimeframe(state: CfsState): Promise<Partial<CfsState>> {
  const role = SpanSanitizer(state.user_context.persona_clarified_role ?? state.user_context.persona_role, "your role");
  return askWithRephrase.run(state, {
    baseQuestion: configString("step1.timeframeQuestion", "By when do you need to see results? 6 or 12 months maybe? Select an appropriate timeframe or enter your appropriate timeframe."),
    questionKey: "S1_TIMEFRAME",
    questionPurpose: "collect_timeframe",
    targetVariable: "timeframe",
    allowAIRephrase: true,
    rephraseContext: {
      industry: state.user_context.industry,
      role,
      useCaseGroups: state.use_case_context.use_case_groups,
      actorRole: "SAAS Enterprise Account Executive",
      tone: "conversational, curious",
    },
  });
}

export function nodeConfirmRoleAssessment(state: CfsState, message: string, examples: string[]): Partial<CfsState> {
  return {
    ...pushAI(state, message, "roleClarifier"),
    ...patchSessionContext(state, {
      last_question_key: "CONFIRM_ROLE",
      awaiting_user: true,
      role_assessment_message: message,
      role_assessment_examples: examples,
    }),
  };
}

export async function resolvePersonaFromRole(
  state: CfsState,
  roleText: string
): Promise<{ personaGroup: string | null; personaGroupConfidence: number | null; examples: string[]; roleName: string | null }> {
  try {
    const useCaseGroups = (state.use_case_context.use_case_groups ?? []).filter(Boolean);
    const queryText = [state.user_context.industry, ...useCaseGroups]
      .filter((v) => typeof v === "string" && v.trim())
      .join(" | ");
    const filters = buildVectorFilters(state, ["persona_usecase_document"]);
    const useCaseGroupFilter = useCaseGroups.length === 1 ? useCaseGroups[0] : useCaseGroups;
    const personaGroups = await getPersonaGroups();

    const result = await resolvePersonaGroupFromRole({
      roleText,
      queryText,
      vectorDocType: "persona_usecase_document",
      vectorMetadataOverrides: {
        tenant_id: filters.tenantId,
        ...filters.metadataFilter,
        document_type: "persona_usecase_document",
        use_case_group_title: useCaseGroupFilter,
      },
      personaGroups,
      existingGroup: state.user_context.persona_group ?? null,
      existingConfidence: state.user_context.persona_group_confidence ?? 0,
    });

    return {
      personaGroup: result.persona_group,
      personaGroupConfidence: result.confidence,
      examples: result.context_examples,
      roleName: result.role_name || null,
    };
  } catch {
    return {
      personaGroup: state.user_context.persona_group ?? null,
      personaGroupConfidence: state.user_context.persona_group_confidence ?? null,
      examples: [],
      roleName: null,
    };
  }
}

const handleUseCaseGroup: IngestHandler = async (state) => {
  const selected = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
  if (!selected) return {};
  const useCaseUpdate: Partial<CfsState> = {
    use_case_context: { ...state.use_case_context, use_case_groups: [selected] },
    user_context: { ...(state.user_context ?? {}), goal_statement: selected },
  };
  const confirmation = [
    configString("step1.useCaseGroupConfirmWelcome", "Welcome to Pure Storage."),
    "",
    interpolate(configString("step1.useCaseGroupConfirmIntro", "Hi, I'm Sam, an engineer here at Pure Storage in Santa Clara. Thanks for sharing your challenge: {{selected}}*"), { selected }),
    "",
    configString("step1.useCaseGroupConfirmBody", "In a few minutes, We'll complete three quick steps together to uncover the best strategy for you and then provide you with a Readout to map your path forward."),
    "",
    configString("step1.useCaseGroupConfirmSteps", "Here's what to expect:\n1. **Knowing Your \"Why\"** – Understand your role, your goals, and what's motivating this initiative, and describe the journey we'll take and the output you'll receive.\n2. **Understanding your need** – Narrow in on categories that best match your challenges and aspirations\n3. **Mapping the path forward** – Dive deeper into specific needs and blockers.\nWith that, we will provide you with a Strategic Readout you can use moving forward."),
    "",
    configString("step1.useCaseGroupConfirmReady", "Ready to dive in?"),
  ].join("\n");
  const withConfirmation = pushAI(mergeStatePatch(state, useCaseUpdate), confirmation);
  const ready = PrimitivesInstance.AskQuestion.run(
    mergeStatePatch(state, useCaseUpdate, withConfirmation),
    { question: "", questionKey: "CONFIRM_START", questionPurpose: "confirm_start", targetVariable: "ready" }
  );
  return {
    ...useCaseUpdate,
    ...withConfirmation,
    ...ready,
    ...patchSessionContext(state, { ...(ready.session_context ?? {}), step_question_index: 0 }),
  };
};

const handleConfirmStart: IngestHandler = async (state) => {
  const answer = (lastHumanMessage(state)?.content?.toString() ?? "").trim().toLowerCase();
  if (answer !== "yes") {
    return {
      ...pushAI(state, configString("step1.confirmStartDecline", "No problem. Tell me when you're ready to proceed.")),
      ...patchSessionContext(state, { awaiting_user: false, last_question_key: null }),
    };
  }
  return {
    ...nodeAskUserName(state),
    ...patchSessionContext(state, { awaiting_user: true, last_question_key: "S1_NAME" }),
  };
};

const handleName: IngestHandler = async (state) => {
  const updates = await applyUserAnswer(state);
  const nextState = mergeStatePatch(state, updates);
  return {
    ...updates,
    ...nodeAskIndustry(nextState),
    ...patchSessionContext(state, { ...(updates.session_context ?? {}), last_question_key: "S1_INDUSTRY", awaiting_user: true }),
  };
};

const handleIndustry: IngestHandler = async (state) => {
  const priorIndustry = state.user_context.industry;
  const updates = await applyUserAnswer(state);
  const industry = SpanSanitizer((updates.user_context ?? state.user_context).industry, "");
  if (!industry) {
    return { ...updates, ...patchSessionContext(state, { ...(updates.session_context ?? {}), last_question_key: null }) };
  }

  if (!state.session_context.step_clarifier_used) {
    const baseState = mergeStatePatch(state, updates) as CfsState;
    const clarification = await clarifyIfVague.run(baseState, {
      value: industry,
      isVague: (v) => isIndustryVague(v),
      fetchSuggestions: (v) => getSubIndustrySuggestions(v),
      buildClarificationMessage: (v) =>
        `To make sure we're aligned — when you said ${v}, can you be more specific about which sub-industry within ${v} applies?`,
      buildExamplesMessage: (suggestions) => `For instance: ${suggestions.join(", ")}.`,
      questionKey: "S1_INDUSTRY",
      extraPatch: (suggestions, results) => ({
        internet_search_context: {
          ...state.internet_search_context,
          last_query: `${industry} sub-industry list`,
          results: results as any,
          fetched_at: Date.now(),
          sub_industries: suggestions,
        },
      }),
    });
    if (clarification.session_context?.step_clarifier_used) {
      return { ...updates, ...clarification };
    }
  }

  let finalIndustry = industry;
  if (state.session_context.step_clarifier_used && priorIndustry && priorIndustry !== industry) {
    if (!industry.toLowerCase().includes(priorIndustry.toLowerCase())) {
      finalIndustry = `${priorIndustry} - ${industry}`;
    }
  }

  const baseState = {
    ...mergeStatePatch(state, updates),
    user_context: { ...(state.user_context ?? {}), ...(updates.user_context ?? {}), industry: finalIndustry },
  } as CfsState;
  const marketSegment = await resolveMarketSegment(baseState);
  const stateWithSegment: CfsState = {
    ...baseState,
    user_context: { ...(baseState.user_context ?? {}), market_segment: marketSegment },
  };
  return {
    ...updates,
    ...(await nodeAskRole(stateWithSegment)),
    user_context: { ...(state.user_context ?? {}), ...(updates.user_context ?? {}), industry: finalIndustry, market_segment: marketSegment },
    ...patchSessionContext(state, { ...(updates.session_context ?? {}), last_question_key: "S1_ROLE", awaiting_user: true }),
  };
};

const handleRole: IngestHandler = async (state) => {
  const updates = await applyUserAnswer(state);
  const roleText = SpanSanitizer((updates.user_context ?? state.user_context).persona_role, "");
  const baseState = mergeStatePatch(state, updates);
  const resolved = await resolvePersonaFromRole(baseState, roleText);
  const baseWithPersona: CfsState = {
    ...baseState,
    user_context: {
      ...(state.user_context ?? {}),
      ...(updates.user_context ?? {}),
      persona_clarified_role: roleText || null,
      persona_group: resolved.personaGroup,
      persona_group_confidence: resolved.personaGroupConfidence,
    },
  };
  const marketSegment = await resolveMarketSegment(baseWithPersona);
  const assessmentMessage = buildRoleAssessmentMessage(resolved.roleName ?? roleText, resolved.personaGroup, resolved.examples);
  const withMessage = nodeConfirmRoleAssessment(
    { ...baseWithPersona, user_context: { ...(baseWithPersona.user_context ?? {}), market_segment: marketSegment } } as CfsState,
    assessmentMessage,
    resolved.examples
  );
  return {
    ...updates,
    ...withMessage,
    user_context: {
      ...(state.user_context ?? {}),
      ...(updates.user_context ?? {}),
      persona_clarified_role: roleText || null,
      persona_group: resolved.personaGroup,
      persona_group_confidence: resolved.personaGroupConfidence,
      market_segment: marketSegment,
    },
    ...patchSessionContext(state, {
      ...(updates.session_context ?? {}),
      last_question_key: "CONFIRM_ROLE",
      awaiting_user: true,
      role_assessment_message: assessmentMessage,
      role_assessment_examples: resolved.examples,
    }),
  };
};

const handleTimeframe: IngestHandler = async (state) => {
  const updates = await applyUserAnswer(state);
  return {
    ...updates,
    ...patchSessionContext(state, { ...(updates.session_context ?? {}), awaiting_user: false, last_question_key: null }),
  };
};

const handleConfirmRole: IngestHandler = async (state) => {
  const answer = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
  if (isAffirmativeAnswer(answer)) {
    const nextMessage = await nodeAskTimeframe(state);
    return { ...nextMessage, ...patchSessionContext(state, { awaiting_user: true, last_question_key: "S1_TIMEFRAME" }) };
  }
  const correctedRole = SpanSanitizer(answer, "role");
  const updatedState: CfsState = {
    ...(state as CfsState),
    user_context: { ...(state.user_context ?? {}), persona_role: correctedRole, persona_clarified_role: correctedRole },
  };
  const resolved = await resolvePersonaFromRole(updatedState, correctedRole);
  const assessmentMessage = buildRoleAssessmentMessage(resolved.roleName ?? correctedRole, resolved.personaGroup, resolved.examples);
  const withMessage = nodeConfirmRoleAssessment(updatedState, assessmentMessage, resolved.examples);
  return {
    ...withMessage,
    user_context: { ...(updatedState.user_context ?? {}), persona_group: resolved.personaGroup, persona_group_confidence: resolved.personaGroupConfidence },
    ...patchSessionContext(state, {
      awaiting_user: true,
      last_question_key: "CONFIRM_ROLE",
      role_assessment_message: assessmentMessage,
      role_assessment_examples: resolved.examples,
    }),
  };
};

const handleKycConfirm: IngestHandler = async (state) => {
  const answer = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
  if (!isAffirmativeAnswer(answer)) {
    return {
      ...pushAI(state, configString("step1.kycConfirmReject", 'Please click "Yes, Lets continue" to continue.')),
      ...patchSessionContext(state, { awaiting_user: true, last_question_key: "S1_KYC_CONFIRM" }),
    };
  }
  const continuation = configString("step1.kycContinuation", "Excellent. We have two quick steps left. Now let's make sure we have the right use case!");
  return {
    ...pushAI(state, prependClarificationAcknowledgement(continuation)),
    ...patchSessionContext(state, { awaiting_user: false, last_question_key: null }),
  };
};

const step1IngestHandlers: Record<string, IngestHandler> = {
  S1_USE_CASE_GROUP: handleUseCaseGroup,
  CONFIRM_START: handleConfirmStart,
  S1_NAME: handleName,
  S1_INDUSTRY: handleIndustry,
  S1_ROLE: handleRole,
  S1_TIMEFRAME: handleTimeframe,
  CONFIRM_ROLE: handleConfirmRole,
  S1_KYC_CONFIRM: handleKycConfirm,
};

export async function nodeStep1Ingest(state: CfsState): Promise<Partial<CfsState>> {
  if (!state.session_context.awaiting_user) return {};
  return ingestDispatcher.run(state, {
    handlers: step1IngestHandlers,
    lastQuestionKey: state.session_context.last_question_key,
  });
}

async function nodeDetermineOutcome(state: CfsState): Promise<Partial<CfsState>> {
  const goal = SpanSanitizer(state.user_context.goal_statement ?? state.use_case_context.objective_normalized, "unknown");
  return vectorSelect.run(state, {
    retrieve: async (s) => {
      const { outcomes, snippets } = await retrieveOutcomeCandidates(s);
      return { candidates: outcomes, snippets };
    },
    selectWithAI: async ({ candidates, snippets }) => {
      const selected = await selectOutcomeName({
        outcomes: candidates as string[],
        snippets,
        personaGroup: state.user_context.persona_group,
        goal,
        marketSegment: state.user_context.market_segment,
      });
      return selected;
    },
    fallback: (candidates) => SpanSanitizer((candidates as string[])[0] ?? goal, "unknown"),
    statePatch: (s, selected, snippets) => ({
      user_context: { ...(s.user_context ?? {}), outcome: SpanSanitizer(selected as string, "unknown") },
      ...(snippets.length ? { vector_context: { ...s.vector_context, snippets } } : {}),
    }),
  });
}

export async function nodeKnowYourCustomerEcho(state: CfsState): Promise<Partial<CfsState>> {
  const outcomeUpdate = await nodeDetermineOutcome(state);
  const mergedState = mergeStatePatch(state, outcomeUpdate);
  const name = SpanSanitizer(mergedState.user_context.first_name, "");
  const role = SpanSanitizer(mergedState.user_context.persona_clarified_role ?? mergedState.user_context.persona_role, "your role");
  const industry = SpanSanitizer(mergedState.user_context.industry, "your industry");
  const timeframe = TimeframeSanitizer(mergedState.user_context.timeframe);
  const goal = SpanSanitizer(mergedState.user_context.goal_statement ?? mergedState.use_case_context.objective_normalized, "your initiative");
  const outcome = SpanSanitizer(mergedState.user_context.outcome, goal);
  const vectorSnippet = (mergedState.vector_context.snippets ?? []).filter(Boolean)[0];
  const fallback = buildKnowYourCustomerEchoFallback({
    name,
    role,
    industry,
    timeframe,
    goal,
    outcome,
    vectorSnippet,
  });

  if (globalThis.__knowYourCustomerEchoOverride !== undefined) {
    const override = globalThis.__knowYourCustomerEchoOverride;
    return {
      ...outcomeUpdate,
      ...pushAI(mergedState, override ?? fallback),
      ...patchSessionContext(mergedState, {
        awaiting_user: true,
        last_question_key: "S1_KYC_CONFIRM",
      }),
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    return {
      ...outcomeUpdate,
      ...pushAI(mergedState, fallback),
      ...patchSessionContext(mergedState, {
        awaiting_user: true,
        last_question_key: "S1_KYC_CONFIRM",
      }),
    };
  }

  const model = getModel("knowYourCustomer");
  const system = [
    "Role: SAAS Enterprise Account Executive.",
    "Tone: Conversational, curious, insightful.",
    "Generate a humanistic recap using the provided context fields and vector snippets.",
    "Use the structure below and keep it brief and concise.",
    "If first_name is missing, omit the name in the confirmation question.",
    "Do not add extra sections or quotes. Return only the final response text.",
    "",
    "Structure:",
    "Great. This allows for a precision-tailored assessment to ensure your success.",
    "As a **<role>** in **<industry>** with a **<timeframe>** goal to **<8 to 12 word summary of goal>**, your initiative aligns with this strategic theme:",
    "",
    "<State the selected Outcome, restate in an industry context with their description, not our terms>",
    "",
    "This is typically the focus when:",
    "- <Example 1>",
    "- <Example 2>",
    "",
    "Are we interpreting your priorities correctly, <Name>?",
  ].join("\n");
  const user = JSON.stringify({
    goal_statement: goal,
    industry,
    persona_role: mergedState.user_context.persona_role ?? null,
    persona_certified_role: mergedState.user_context.persona_clarified_role ?? null,
    timeframe,
    outcome,
    first_name: name || null,
    vector_context_snippets: mergedState.vector_context.snippets ?? [],
  });
  const text = await invokeChatModelWithFallback(model, system, user, {
    runName: "knowYourCustomerEcho",
    fallback,
  });
  return {
    ...outcomeUpdate,
    ...pushAI(mergedState, text),
    ...patchSessionContext(mergedState, {
      awaiting_user: true,
      last_question_key: "S1_KYC_CONFIRM",
    }),
  };
}
