import * as z from "zod";

// Re-export for backward compatibility.
export { PrimitiveLogSchema } from "./slices/primitive-log.js";

// Overlay tone options used to shape question wording and responses.
export type OverlayName =
  | "SeniorSE_Curious"
  | "SeniorSE_Challenging"
  | "CTO_Consultative"
  | "Mentor_Supportive"
  | "Coach_Affirmative";

// Conversation step identifiers (graph-scoped).
export type CfsStepName =
  | "STEP1_KNOW_YOUR_CUSTOMER"
  | "STEP2_NARROW_DOWN_USE_CASES"
  | "STEP3_PERFORM_DISCOVERY"
  | "STEP4_BUILD_READOUT"
  | "STEP5_READOUT_SUMMARY_NEXT_STEPS";

// Backward-compatible alias.
export type StepName = CfsStepName;

// Message categories used to apply scripted vs AI review policies.
export type MessageType = "intro" | "name" | "industry" | "industryClarifier" | "role" | "roleClarifier" | "default";

export type GraphMessagingConfig = {
  exampleGenerator: (params: { industry?: string | null; role?: string | null; topic: "role" | "industry" | "goal" | "timeframe" }) => string[];
  overlayPrefix: (overlay?: OverlayName) => string;
  clarifierRetryText: {
    step1Ready: string;
    step2ConfirmPlan: string;
    step2Obstacle: string;
  };
  clarificationAcknowledgement: string | string[];
  messagePolicy: Record<MessageType, { allowAIRephrase: boolean; forbidFirstPerson: boolean }>;
  aiPrompts: {
    selectPersonaGroup: string;
    selectMarketSegment: string;
    selectUseCaseGroups?: string;
    selectOutcomeName: string;
    selectPillars: string;
    sanitizeUserInput: string;
    reviewResponse: string;
    reviewResponse2?: string;
    assessRisk: string;
    buildReadoutAnalysis?: string;
    buildReadoutSection?: string;
    readoutQaChecklist?: string;
    readoutStyleQa?: string;
    buildReadoutSectionRepair?: string;
    determineUseCaseQuestions?: string;
    determineUseCaseSelection?: string;
  };
  strings?: Record<string, string>;
  readout?: {
    sectionKeys?: string[];
    sectionContract?: string;
  };
  readoutRolePerspective?: "Coach_Affirmative";
  readoutVoiceCharacteristics?: string;
  readoutBehavioralIntent?: string;
  readoutOutputTargets?: Array<"download" | "email" | "database">;
  defaultReadoutOutputTargets?: Array<"download" | "email" | "database">;
  allowMultiTargetDelivery?: boolean;
  outputTargetOverridesByTenant?: Record<string, Array<"download" | "email" | "database">>;
  meta?: {
    flowTitle: string;
    flowDescription: string;
    steps: Array<{
      key: string;
      label: string;
      order: number;
      countable: boolean;
      totalQuestions: number;
      countingStrategy?: "questionKeyMap" | "useCaseSelect" | "readoutReady" | "dynamicCount";
    }>;
  };
  overlayPrefixes?: Record<string, string>;
  exampleTemplates?: Record<string, string[]>;
  progressRules?: {
    questionKeyMap: Record<string, number>;
    dynamicCountField: string;
    dynamicCountStepKey: string;
    useCaseSelectQuestionKey?: string;
  };
  questionTemplates?: Array<{ key: string; question: string }>;
  options?: Record<string, string[]>;
  dynamicOptions?: Record<
    string,
    | { source: "service"; serviceRef: string }
    | { source: "state"; statePath: string; format?: "numbered_list" }
  >;
  continuationTriggers?: Array<{
    traceIncludes: string;
    notReadoutReady?: boolean;
    steps?: string[];
    items: string[];
  }>;
  ingestFieldMappings?: Record<
    string,
    { targetField: string; sanitizeAs?: "name" | "role" | "industry" | "goal" | "timeframe"; captureObjective?: boolean }
  >;
};

// Named primitives so we can log and track which routine ran.
export type PrimitiveName =
  | "AskQuestion"
  | "ExplainWhy"
  | "CaptureObjective"
  | "ProbeRisk"
  | "EvaluateReadiness"
  | "SummarizeContext"
  | "ConfirmAssumption"
  | "GenerateRecommendation"
  | "AcknowledgeEmotion"
  | "RiskHighlight"
  | "BestPracticeCue"
  | "RankAndSelect"
  | "ValidateGuardrail"
  | "CelebrateAchievement"
  | "ChallengeAssumption"
  | "MicroWin"
  | "RecallCue"
  | "MotivationalCue"
  | "BridgeCue"
  | "EndSession"
  | "AskWithRephrase"
  | "ClarifyIfVague"
  | "QuestionnaireLoop"
  | "IngestDispatcher"
  | "VectorSelect"
  | "MultiSectionDocBuilder"
  | "NumericSelectionIngest"
  | "DocStyleQa";

import {
  ContextWeaveIndexSchema,
  UserContextSchema,
  UseCaseContextSchema,
  ReadoutContextSchema,
  RelationshipContextSchema,
  SessionContextSchema,
  VectorContextSchema,
  InternetSearchContextSchema,
} from "./slices/index.js";

// Full conversation state schema used by the graph.
export const CfsStateSchema = z.object({
  messages: z.array(z.custom<any>()).default([]),
  overlay_active: z
    .enum(["SeniorSE_Curious", "SeniorSE_Challenging", "CTO_Consultative", "Mentor_Supportive", "Coach_Affirmative"] as const)
    .default("SeniorSE_Curious"),
  context_weave_index: ContextWeaveIndexSchema.default({ user_phrases: [], entities: [] }),
  user_context: UserContextSchema.default({}),
  use_case_context: UseCaseContextSchema.default({}),
  relationship_context: RelationshipContextSchema.default({}),
  session_context: SessionContextSchema,
  vector_context: VectorContextSchema.default({}),
  internet_search_context: InternetSearchContextSchema.default({}),
  readout_context: ReadoutContextSchema.default({}),
});

// Type for the graph state.
export type CfsState = z.infer<typeof CfsStateSchema>;
