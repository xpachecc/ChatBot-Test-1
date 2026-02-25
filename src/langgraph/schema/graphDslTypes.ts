import * as z from "zod";

// ── Config sub-schemas (per-graph conversation settings) ────────────

export const StepDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const ModelConfigSchema = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.4),
  maxRetries: z.number().int().min(0).default(1),
});

export const MessagePolicyEntrySchema = z.object({
  allowAIRephrase: z.boolean().default(false),
  forbidFirstPerson: z.boolean().default(false),
});

export const QuestionTemplateSchema = z.object({
  key: z.string().min(1),
  question: z.string().min(1),
});

export const ReadoutVoiceSchema = z.object({
  rolePerspective: z.string().default("Coach_Affirmative"),
  voiceCharacteristics: z.string().default(""),
  behavioralIntent: z.string().default(""),
});

export const DeliveryConfigSchema = z.object({
  outputTargets: z.array(z.enum(["download", "email", "database"])).default(["download"]),
  defaultOutputTargets: z.array(z.enum(["download", "email", "database"])).default(["download"]),
  allowMultiTarget: z.boolean().default(true),
  overridesByTenant: z.record(z.string(), z.array(z.enum(["download", "email", "database"]))).default({}),
});

export const ReadoutConfigSchema = z.object({
  sectionKeys: z.array(z.string()).default([]),
  sectionContract: z.string().default(""),
});

export const CountingStrategySchema = z.enum([
  "questionKeyMap",
  "useCaseSelect",
  "readoutReady",
  "dynamicCount",
]);

export const FlowStepMetaSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  order: z.number().int().min(0),
  countable: z.boolean().default(false),
  totalQuestions: z.number().int().min(0).default(0),
  countingStrategy: CountingStrategySchema.optional(),
});

export const FlowMetaSchema = z.object({
  flowTitle: z.string().default(""),
  flowDescription: z.string().default(""),
  steps: z.array(FlowStepMetaSchema).default([]),
});

export const ProgressRulesSchema = z.object({
  questionKeyMap: z.record(z.string(), z.number()).default({}),
  dynamicCountField: z.string().default(""),
  dynamicCountStepKey: z.string().default(""),
  useCaseSelectQuestionKey: z.string().default("S3_USE_CASE_SELECT"),
});

export const GraphConfigSchema = z.object({
  steps: z.array(StepDefSchema).default([]),
  models: z.record(z.string(), ModelConfigSchema).default({}),
  messagePolicy: z.record(z.string(), MessagePolicyEntrySchema).default({}),
  aiPrompts: z.record(z.string(), z.string()).default({}),
  strings: z.record(z.string(), z.string()).default({}),
  questionTemplates: z.array(QuestionTemplateSchema).default([]),
  clarifierRetryText: z.record(z.string(), z.string()).default({}),
  clarificationAcknowledgement: z.union([z.string(), z.array(z.string())]).default([]),
  readoutVoice: ReadoutVoiceSchema.default({}),
  readout: ReadoutConfigSchema.default({}),
  delivery: DeliveryConfigSchema.default({}),
  meta: FlowMetaSchema.default({}),
  overlayPrefixes: z.record(z.string(), z.string()).default({}),
  exampleTemplates: z.record(z.string(), z.array(z.string())).default({}),
  progressRules: ProgressRulesSchema.default({}),
  options: z.record(z.string(), z.array(z.string())).default({}),
});

// ── Node / transition schemas ───────────────────────────────────────

export const NodeKindSchema = z.enum([
  "router",
  "question",
  "ingest",
  "compute",
  "integration",
  "terminal",
]);

export const NodeDefSchema = z.object({
  id: z.string().min(1),
  kind: NodeKindSchema,
  handlerRef: z.string().min(1),
  helperRefs: z.array(z.string()).default([]),
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export const StaticTransitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const ConditionalTransitionSchema = z.object({
  from: z.string().min(1),
  routerRef: z.string().min(1),
  destinations: z.record(z.string(), z.string()),
});

export const RuntimeConfigRefsSchema = z.object({
  initConfigRef: z.string().optional(),
  modelAliases: z.record(z.string(), z.string()).default({}),
  messagePolicyRef: z.string().optional(),
  promptSetRef: z.string().optional(),
  deliveryPolicyRef: z.string().optional(),
  exampleGeneratorRef: z.string().optional(),
  overlayPrefixRef: z.string().optional(),
});

export const ValidationSchema = z.object({
  requiredStateFields: z.array(z.string()).default([]),
  invariants: z.array(z.string()).default([]),
});

export const GraphDslSchema = z.object({
  graph: z.object({
    graphId: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    entrypoint: z.string().min(1),
    tags: z.array(z.string()).default([]),
  }),
  stateContractRef: z.string().min(1),
  nodes: z.array(NodeDefSchema).min(1),
  transitions: z.object({
    static: z.array(StaticTransitionSchema).default([]),
    conditional: z.array(ConditionalTransitionSchema).default([]),
  }),
  routingKeys: z.array(z.string()).default([]),
  runtimeConfigRefs: RuntimeConfigRefsSchema.default({}),
  config: GraphConfigSchema.default({}),
  validation: ValidationSchema.default({}),
});

export type GraphDsl = z.infer<typeof GraphDslSchema>;
export type GraphConfig = z.infer<typeof GraphConfigSchema>;
export type NodeDef = z.infer<typeof NodeDefSchema>;
export type NodeKind = z.infer<typeof NodeKindSchema>;
export type StaticTransition = z.infer<typeof StaticTransitionSchema>;
export type ConditionalTransition = z.infer<typeof ConditionalTransitionSchema>;
export type RuntimeConfigRefs = z.infer<typeof RuntimeConfigRefsSchema>;
export type StepDef = z.infer<typeof StepDefSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type QuestionTemplate = z.infer<typeof QuestionTemplateSchema>;
export type FlowStepMeta = z.infer<typeof FlowStepMetaSchema>;
export type FlowMeta = z.infer<typeof FlowMetaSchema>;
export type ProgressRules = z.infer<typeof ProgressRulesSchema>;
