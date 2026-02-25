import type { CfsState } from "../state.js";
import { lastHumanMessage } from "../infra.js";
import { S3_DISCOVERY_QUESTION_KEY, CFS_STEPS } from "./step-flow-config.js";

// Discovery question loop router: ends the turn while awaiting user input,
// ends the turn when all questions are answered (so user sees Step 3 at 100%),
// proceeds to pillar determination on the next user message.
export function routeUseCaseQuestionLoop(state: CfsState): string {
  const trace = Array.isArray(state.session_context?.reason_trace) ? state.session_context.reason_trace : [];
  if (trace.includes("ask_use_case_questions:empty")) return "end";
  if (state.session_context?.awaiting_user) return "end";
  // End turn here so user immediately sees Step 3 at 100% and the closing message.
  // Next turn will run nodeDeterminePillars (via routeInitFlow -> routeUseCaseQuestionLoop).
  if (trace.includes("ask_use_case_questions:complete")) return "end";
  return "end";
}

// After ingestUseCaseSelection: if we have selected use cases, proceed to determine questions; else end (retry on invalid input).
export function routeAfterIngestUseCaseSelection(state: CfsState): string {
  const selected = state.use_case_context?.selected_use_cases;
  const hasSelection = Array.isArray(selected) && selected.length > 0;
  return hasSelection ? "nodeDetermineUseCaseQuestions" : "end";
}

// Pillar loop router: when readout ready, end; else build it (nodeBuildReadout -> nodeDisplayReadout via static).
export function routePillarsLoop(state: CfsState): string {
  const readoutStatus = (state as any).readout_context?.status as string | undefined;
  const hasReadout = readoutStatus === "ready";
  if (hasReadout) return "end";
  if (state.session_context?.awaiting_user) return "end";
  return "nodeBuildReadout";
}

// Main router: chooses which node runs next based on conversation state.
export function routeInitFlow(state: CfsState): string {
  const readoutStatus = (state as any).readout_context?.status as string | undefined;
  const hasReadout = readoutStatus === "ready";
  const trace = Array.isArray(state.session_context?.reason_trace) ? state.session_context.reason_trace : [];

  let destination: string = "end";
  if ((state.session_context?.primitive_counter ?? 0) === 0 && (state.messages?.length ?? 0) === 0) destination = "sendIntroAndAskUseCaseGroup";
  else if (state.session_context.started === false) destination = "sendIntroAndAskUseCaseGroup";
  else {
    const lastAnswer = (lastHumanMessage(state)?.content?.toString() ?? "").trim().toLowerCase();
    if (
      !state.session_context.awaiting_user &&
      !state.user_context.first_name &&
      (state.use_case_context.use_case_groups?.length ?? 0) > 0 &&
      lastAnswer === "yes"
    ) {
      destination = "askUserName";
    } else if (
      !state.session_context.awaiting_user &&
      trace.includes("ask_use_case_questions:complete")
    ) {
      destination = "nodeDeterminePillars";
    } else if (
      !state.session_context.awaiting_user &&
      (state.use_case_context?.discovery_questions?.length ?? 0) > 0 &&
      !trace.includes("ask_use_case_questions:start")
    ) {
      destination = "nodeAskUseCaseQuestions";
    } else if (
      !state.session_context.awaiting_user &&
      state.session_context.step === CFS_STEPS.STEP4_BUILD_READOUT &&
      !hasReadout
    ) {
      destination = "nodeBuildReadout";
    } else if (state.session_context.awaiting_user) {
      if (state.session_context.last_question_key === "S1_USE_CASE_GROUP") destination = "ingestUseCaseGroupSelection";
      else if (state.session_context.last_question_key === "CONFIRM_START") destination = "ingestConfirmStart";
      else if (state.session_context.last_question_key === "S1_NAME") destination = "ingestUserName";
      else if (state.session_context.last_question_key === "S1_INDUSTRY") destination = "ingestIndustry";
      else if (state.session_context.last_question_key === "S1_ROLE") destination = "ingestRole";
      else if (state.session_context.last_question_key === "CONFIRM_ROLE") destination = "ingestConfirmRole";
      else if (state.session_context.last_question_key === "S1_TIMEFRAME") destination = "ingestTimeframe";
      else if (state.session_context.last_question_key === "S1_KYC_CONFIRM") destination = "ingestKycConfirm";
      else if (state.session_context.last_question_key === "S1_INTERNET_SEARCH") destination = "internetSearch";
      else if (state.session_context.last_question_key === "S3_USE_CASE_SELECT") destination = "ingestUseCaseSelection";
      else if (state.session_context.last_question_key === S3_DISCOVERY_QUESTION_KEY) destination = "nodeAskUseCaseQuestions";
    }
  }

  return destination;
}
