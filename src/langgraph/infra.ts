import {
  askQuestion,
  captureObjective,
  acknowledgeEmotion,
  applyUserAnswer as applyUserAnswerFn,
} from "./core/primitives/interaction/index.js";

export type OverlayName =
  | "SeniorSE_Curious"
  | "SeniorSE_Challenging"
  | "CTO_Consultative"
  | "Mentor_Supportive"
  | "Coach_Affirmative";

export type StepName = "STEP_1" | "STEP_2";

export type { CfsState, PrimitiveName } from "./state.js";
export { CfsStateSchema } from "./state.js";
export { createInitialState } from "./core/helpers/state.js";

export { sanitizeUserInput } from "./core/guards/sanitize.js";

export const PrimitivesInstance = {
  AskQuestion: askQuestion,
  CaptureObjective: captureObjective,
  AcknowledgeEmotion: acknowledgeEmotion,
} as const;

// ── Re-exports ───────────────────────────────────────────────────────
export {
  lastAIMessage,
  lastHumanMessage,
  pushAI,
} from "./core/helpers/messaging.js";
export {
  requireGraphMessagingConfig,
  setGraphMessagingConfig,
} from "./core/config/messaging.js";
export {
  mergeStatePatch,
  patchSessionContext,
} from "./core/helpers/state.js";

export {
  selectMarketSegment,
  selectOutcomeName,
  selectPersonaGroup,
} from "./core/services/ai/selection.js";
export { rephraseQuestionWithAI } from "./core/services/ai/rephrase.js";

export {
  interpolate,
  configString,
  prependClarificationAcknowledgement,
  buildDeterministicScores,
  buildFallbackFromSchema,
} from "./core/helpers/template.js";
export { SpanSanitizer, TimeframeSanitizer } from "./core/helpers/text.js";
export { computeFlowProgress } from "./core/helpers/state.js";
export type { StepProgressStatus, StepProgress, FlowProgress } from "./core/helpers/state.js";

// Reusable primitives and utilities for future graph flows
export {
  askWithRephrase,
  clarifyIfVague,
  questionnaireLoop,
  ingestDispatcher,
  numericSelectionIngest,
  type AskWithRephraseParams,
  type ClarifyIfVagueParams,
  type QuestionnaireLoopParams,
  type IngestDispatcherParams,
  type IngestHandler,
  type NumericSelectionIngestParams,
} from "./core/primitives/conversation/index.js";
export {
  vectorSelect,
  multiSectionDocBuilder,
  docStyleQa,
  type VectorSelectParams,
  type MultiSectionDocBuilderParams,
  type SectionBuildParams,
  type DocStyleQaParams,
} from "./core/primitives/compute/index.js";
export { Primitive, AsyncPrimitive } from "./core/primitives/base.js";

export { applyUserAnswerFn as applyUserAnswer };

export { z } from "zod";
export { default as crypto } from "node:crypto";
