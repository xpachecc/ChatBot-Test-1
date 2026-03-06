import {
  askQuestion,
  captureObjective,
  acknowledgeEmotion,
  applyUserAnswer as applyUserAnswerFn,
} from "./core/primitives/interaction/index.js";

export const PLATFORM_API_VERSION = "1.0.0";

export type OverlayName =
  | "SeniorSE_Curious"
  | "SeniorSE_Challenging"
  | "CTO_Consultative"
  | "Mentor_Supportive"
  | "Coach_Affirmative";

export type StepName = "STEP_1" | "STEP_2";

/**
 * State types, schema, and mutation utilities.
 * Use these to read/write CfsState fields and build state patches.
 */
// --- State & Types ---
export type { CfsState, PrimitiveName } from "./state.js";
export { CfsStateSchema } from "./state.js";
export { createInitialState } from "./core/helpers/state.js";
export {
  mergeStatePatch,
  patchSessionContext,
  computeFlowProgress,
} from "./core/helpers/state.js";
export type { StepProgressStatus, StepProgress, FlowProgress } from "./core/helpers/state.js";

/**
 * Path-based state access and mutation.
 * Use getByPath/setByPath for reading/writing dot-path state fields,
 * buildNestedPatch for producing immutable state patches.
 */
// --- Path Utilities ---
export {
  getByPath,
  setByPath,
  buildNestedPatch,
} from "./core/helpers/path.js";

/**
 * Message helpers for reading the conversation history and pushing AI responses.
 */
// --- Messaging ---
export {
  lastAIMessage,
  lastHumanMessage,
  pushAI,
} from "./core/helpers/messaging.js";

/**
 * Graph-scoped configuration access. Use configString() and interpolate()
 * to read YAML-defined strings and build templated messages.
 */
// --- Config ---
export {
  requireGraphMessagingConfig,
  setGraphMessagingConfig,
} from "./core/config/messaging.js";
export {
  interpolate,
  configString,
  prependClarificationAcknowledgement,
  buildDeterministicScores,
  buildFallbackFromSchema,
  buildCanonicalReadoutDocument,
  type CanonicalReadoutSection,
  type CanonicalReadoutDocument,
} from "./core/helpers/template.js";

/**
 * Model factory for obtaining LLM instances by alias.
 */
// --- Model Factory ---
export { getModel } from "./core/config/model-factory.js";

/**
 * High-level interaction primitives that handle question presentation,
 * rephrasing, clarification loops, and user input ingestion.
 */
// --- Interaction Primitives ---
export const PrimitivesInstance = {
  AskQuestion: askQuestion,
  CaptureObjective: captureObjective,
  AcknowledgeEmotion: acknowledgeEmotion,
} as const;

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

/**
 * Compute primitives for AI-driven selection, document generation,
 * vector-based retrieval, and AI compute operations.
 */
// --- Compute Primitives ---
export {
  vectorSelect,
  multiSectionDocBuilder,
  docStyleQa,
  type VectorSelectParams,
  type MultiSectionDocBuilderParams,
  type SectionBuildParams,
  type DocStyleQaParams,
} from "./core/primitives/compute/index.js";
export { runAiCompute, PARSER_REGISTRY } from "./core/primitives/compute/ai-compute.js";

/**
 * AI service wrappers for specific selection tasks (persona, market segment,
 * outcome) and question rephrasing.
 */
// --- AI Services ---
export {
  selectMarketSegment,
  selectOutcomeName,
  selectPersonaGroup,
} from "./core/services/ai/selection.js";
export { rephraseQuestionWithAI } from "./core/services/ai/rephrase.js";
export { invokeChatModelWithFallback } from "./core/services/ai/invoke.js";
export { resolvePersonaGroupFromRole } from "./core/services/ai/resolve-persona.js";

/**
 * Vector, pillar, persona group, and internet search services.
 */
// --- Domain Services ---
export {
  buildVectorFilters,
  retrieveMarketSegmentCandidates,
  retrieveOutcomeCandidates,
  resolveMarketSegment,
  retrieveUseCaseOptions,
  retrieveUseCaseQuestionBank,
  READOUT_DOCUMENT_TYPES,
  retrieveReadoutDocuments,
} from "./core/services/vector.js";
export { getPersonaGroups } from "./core/services/persona-groups.js";
export { getAllPillars, getPillarsForOutcome } from "./core/services/pillars.js";
export { getSubIndustrySuggestions, isIndustryVague } from "./core/services/internet-search.js";

/**
 * Text sanitization, normalization, and parsing utilities.
 */
// --- Text & Sanitization ---
export { SpanSanitizer, TimeframeSanitizer, sanitizeDiscoveryAnswer, truncateTextToWordLimit } from "./core/helpers/text.js";
export { sanitizeUserInput } from "./core/guards/sanitize.js";
export {
  parseJsonObject,
  parsePillarsFromAi,
  parseCompositeQuestions,
  extractStringValuesFromMixedArray,
  sanitizeNumericSelectionInput,
  parseNumericSelectionIndices,
  type DiscoveryQuestionItem,
  type PillarEntry,
} from "./core/helpers/parsing.js";
export {
  normalizeOptionalString,
  normalizePillarValues,
  buildCaseInsensitiveLookupMap,
  normalizeUseCasePillarEntries,
  normalizeDiscoveryQuestions,
  mergeDiscoveryQuestions,
} from "./core/helpers/normalization.js";

/**
 * Sentiment analysis and affirmative answer detection.
 */
// --- Sentiment ---
export { isAffirmativeAnswer, detectSentiment } from "./core/helpers/sentiment.js";

/**
 * Risk assessment guards.
 */
// --- Guards ---
export { assessAnswerRiskFromState } from "./core/guards/risk.js";

/**
 * Signal agent orchestration for background heuristic analysis
 * (engagement, sentiment, trust).
 */
// --- Signal Agents ---
export {
  runSignalOrchestrator,
  type SignalAgentConfig,
  type SignalAgentResult,
  type SignalTurnRecord,
  type SignalOrchestratorResult,
} from "./core/agents/index.js";

/**
 * Base classes for building new primitives. Extend Primitive (sync)
 * or AsyncPrimitive (async) to create reusable operations with telemetry.
 */
// --- Base Classes ---
export { Primitive, AsyncPrimitive } from "./core/primitives/base.js";

export { applyUserAnswerFn as applyUserAnswer };

export { z } from "zod";
export { default as crypto } from "node:crypto";
