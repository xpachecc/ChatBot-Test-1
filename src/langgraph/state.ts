import * as z from "zod";

// Log entry for each primitive invocation.
export const PrimitiveLogSchema = z.object({
  primitive_name: z.string(),
  template_id: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  overlay_active: z.string().optional(),
  context_updates: z.array(z.string()).default([]),
  guardrail_status: z.enum(["pass", "fail"]).default("pass"),
  trust_score: z.number().min(0).max(1).default(0.5),
  sentiment_score: z.number().min(0).max(1).default(0.5),
  hash_verified: z.boolean().default(true),
});

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
    selectUseCaseGroups: string;
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
  options?: Record<string, string[]>;
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
  | "AiRecap"
  | "CascadingResolve"
  | "NumericSelectionIngest"
  | "ResolveAndConfirm"
  | "DocStyleQa";

// Lightweight index of user phrases/entities for reuse.
const ContextWeaveIndexSchema = z.object({
  user_phrases: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
});

// Stable user profile data captured during the flow.
const UserContextSchema = z.object({
  first_name: z.string().nullable().default(null),
  persona_role: z.string().nullable().default(null),
  persona_clarified_role: z.string().nullable().default(null),
  industry: z.string().nullable().default(null),
  goal_statement: z.string().nullable().default(null),
  timeframe: z.string().nullable().default(null),
  persona_group: z.string().nullable().default(null),
  persona_group_confidence: z.number().min(0).max(1).nullable().default(null),
  market_segment: z.string().nullable().default(null),
  outcome: z.string().nullable().default(null),
});

// Use-case and outcome data inferred from answers.
const UseCaseContextSchema = z.object({
  objective_normalized: z.string().nullable().default(null),
  objectives: z.array(z.any()).default([]),
  objective_category: z.string().nullable().default(null),
  risks: z.array(z.any()).default([]),
  readiness_profile: z.record(z.any()).default({}),
  use_cases_prioritized: z.array(z.any()).default([]),
  contextual_items: z.array(z.any()).default([]),
  next_action: z.string().nullable().default(null),
  risk_callouts: z.array(z.any()).default([]),
  use_case_ids: z.array(z.string()).default([]),
  use_case_groups: z.array(z.string()).default([]),
  pillars: z
    .array(
      z.object({
        name: z.string(),
        confidence: z.number().min(0).max(1),
      })
    )
    .default([]),
  use_case_group_candidates: z.array(z.string()).default([]),
  selected_use_cases: z.array(z.string()).default([]),
  discovery_question_bank: z.array(z.string()).default([]),
  discovery_questions: z
    .array(
      z.object({
        question: z.string(),
        response: z.string().nullable().default(null),
        risk: z.string().nullable().default(null),
        risk_domain: z.string().nullable().default(null),
      })
    )
    .default([]),
});

// Canonical strategic readout state for reusable rendering/delivery.
const ReadoutContextSchema = z.object({
  status: z.enum(["idle", "ready", "error"]).default("idle"),
  generated_at: z.number().nullable().default(null),
  retrieval_filters: z.record(z.any()).default({}),
  documents_by_type: z.record(z.array(z.any())).default({}),
  analysis_json: z.record(z.any()).nullable().default(null),
  qa_checks: z.record(z.any()).default({}),
  canonical: z
    .object({
      document_id: z.string().nullable().default(null),
      version: z.string().default("1.0"),
      metadata: z.record(z.any()).default({}),
      sections: z.array(z.any()).default([]),
      tables: z.array(z.any()).default([]),
      citations: z.array(z.any()).default([]),
      evidence_refs: z.array(z.string()).default([]),
    })
    .default({}),
  rendered_outputs: z
    .object({
      markdown: z.string().nullable().default(null),
      html: z.string().nullable().default(null),
      text: z.string().nullable().default(null),
    })
    .default({}),
  delivery: z
    .object({
      targets_requested: z.array(z.enum(["download", "email", "database"])).default([]),
      download: z.record(z.any()).default({ status: "skipped" }),
      email: z.record(z.any()).default({ status: "skipped" }),
      database: z.record(z.any()).default({ status: "skipped" }),
    })
    .default({}),
});

// Relationship/rapport metrics and logs.
const RelationshipContextSchema = z.object({
  trust_score: z.number().min(0).max(1).default(0.6),
  sentiment_score: z.number().min(0).max(1).default(0.7),
  engagement_level: z.number().min(0).max(1).default(0.7),
  sentiment_log: z.array(z.string()).default([]),
});

// Session state used for routing and audit logs.
const SessionContextSchema = z.object({
  session_id: z.string(),
  tenant_id: z.string().nullable().default(null),
  graph_id: z.string().default("cfs"),
  step: z.enum([
    "STEP1_KNOW_YOUR_CUSTOMER",
    "STEP2_NARROW_DOWN_USE_CASES",
    "STEP3_PERFORM_DISCOVERY",
    "STEP4_BUILD_READOUT",
    "STEP5_READOUT_SUMMARY_NEXT_STEPS",
  ]).default("STEP1_KNOW_YOUR_CUSTOMER"),
  step_question_index: z.number().int().min(0).default(0),
  step_clarifier_used: z.boolean().default(false),
  last_question_key: z.string().nullable().default(null),
  awaiting_user: z.boolean().default(false),
  started: z.boolean().default(false),
  primitive_counter: z.number().int().min(0).default(0),
  primitive_log: z.array(PrimitiveLogSchema).default([]),
  summary_log: z.array(z.string()).default([]),
  reason_trace: z.array(z.string()).default([]),
  guardrail_log: z.array(z.string()).default([]),
  transition_log: z.array(z.string()).default([]),
  response_log: z.array(z.any()).default([]),
  assumption_log: z.array(z.any()).default([]),
  rank_log: z.array(z.any()).default([]),
  recall_log: z.array(z.any()).default([]),
  challenge_log: z.array(z.any()).default([]),
  milestone_log: z.array(z.any()).default([]),
  recommendation_log: z.array(z.any()).default([]),
  role_assessment_message: z.string().nullable().default(null),
  role_assessment_examples: z.array(z.string()).default([]),
  archive: z.record(z.any()).nullable().default(null),
  suggested_options: z.record(z.string(), z.array(z.string())).optional(),
});

// Stores vector retrieval state and snippets for reuse.
const VectorContextSchema = z.object({
  last_query_signature: z.string().nullable().default(null),
  last_filters: z.record(z.any()).default({}),
  results: z.array(z.any()).default([]),
  history: z.array(z.any()).default([]),
  fetched_at: z.number().nullable().default(null),
  snippets: z.array(z.string()).default([]),
});

const InternetSearchContextSchema = z.object({
  last_query: z.string().nullable().default(null),
  results: z.array(z.any()).default([]),
  fetched_at: z.number().nullable().default(null),
  sub_industries: z.array(z.string()).default([]),
});

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
