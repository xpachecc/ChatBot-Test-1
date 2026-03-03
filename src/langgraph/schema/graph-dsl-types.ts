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

export const SignalAgentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ttlMs: z.number().int().min(100).default(1000),
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
  dynamicOptions: z
    .record(
      z.string(),
      z.union([
        z.object({ source: z.literal("service"), serviceRef: z.string() }),
        z.object({ source: z.literal("state"), statePath: z.string(), format: z.enum(["numbered_list"]).optional() }),
      ])
    )
    .default({}),
  continuationTriggers: z
    .array(
      z.object({
        traceIncludes: z.string(),
        notReadoutReady: z.boolean().default(true),
        steps: z.array(z.string()).default([]),
        items: z.array(z.string()).min(1),
      })
    )
    .default([]),
  ingestFieldMappings: z
    .record(
      z.string(),
      z.object({
        targetField: z.string(),
        sanitizeAs: z.enum(["name", "role", "industry", "goal", "timeframe"]).optional(),
        captureObjective: z.boolean().optional(),
      })
    )
    .default({}),
  routingRules: z.record(z.string(), z.array(z.object({
    when: z.record(z.string(), z.union([z.boolean(), z.string(), z.number(), z.object({
      path: z.string(),
      value: z.union([z.string(), z.number()]),
    }).passthrough()])).optional(),
    goto: z.string().optional(),
    default: z.string().optional(),
  }))).default({}),
  signalAgents: SignalAgentConfigSchema.default({}),
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

// ── Generic node config schemas (YAML-driven handler generation) ────

export const RephraseContextSchema = z.object({
  industryField: z.string().optional(),
  roleField: z.string().optional(),
  useCaseGroupsField: z.string().optional(),
  actorRole: z.string().optional(),
  tone: z.string().optional(),
});

export const PrefixConfigSchema = z.object({
  stateField: z.string(),
  fallback: z.string().default(""),
});

export const QuestionNodeConfigSchema = z.object({
  stringKey: z.string().optional(),
  stringKeys: z.array(z.string()).optional(),
  questionKey: z.string().min(1),
  questionPurpose: z.string().optional(),
  targetVariable: z.string().optional(),
  interpolateFrom: z.record(z.string(), z.string()).optional(),
  allowAIRephrase: z.boolean().default(false),
  rephraseContext: RephraseContextSchema.optional(),
  prefix: PrefixConfigSchema.optional(),
});

export const GreetingNodeConfigSchema = z.object({
  stringKeys: z.array(z.string()).min(1),
  initialSessionContext: z.record(z.string(), z.unknown()).optional(),
  afterQuestionKey: z.string().optional(),
});

export const AppendDownloadUrlSchema = z.object({
  stateField: z.string(),
  fallbackPattern: z.string(),
});

export const DisplayNodeConfigSchema = z.object({
  statePath: z.string().min(1),
  fallbackMessage: z.string().optional(),
  appendDownloadUrl: AppendDownloadUrlSchema.optional(),
});

export const AcceptQuestionConfigSchema = z.object({
  stringKey: z.string().min(1),
  questionKey: z.string().min(1),
  questionPurpose: z.string().optional(),
  targetVariable: z.string().optional(),
});

export const AffirmativeCheckConfigSchema = z.object({
  rejectStringKey: z.string().min(1),
  rejectPatch: z.record(z.string(), z.unknown()).default({}),
  acceptStringKey: z.string().optional(),
  acceptPatch: z.record(z.string(), z.unknown()).default({}),
  acceptQuestionConfig: AcceptQuestionConfigSchema.optional(),
});

export const IngestNodeConfigSchema = z.object({
  affirmativeCheckConfig: AffirmativeCheckConfigSchema.optional(),
});

export const NodeConfigSchema = z.object({
  question: QuestionNodeConfigSchema.optional(),
  greeting: GreetingNodeConfigSchema.optional(),
  display: DisplayNodeConfigSchema.optional(),
  ingest: IngestNodeConfigSchema.optional(),
});

export const NodeDefSchema = z.object({
  id: z.string().min(1),
  kind: NodeKindSchema,
  handlerRef: z.string().min(1).optional(),
  helperRefs: z.array(z.string()).default([]),
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  description: z.string().optional(),
  signalAgents: z.boolean().optional(),
  nodeConfig: NodeConfigSchema.optional(),
}).refine(
  (node) => node.handlerRef || node.nodeConfig,
  { message: "A node must have at least one of handlerRef or nodeConfig" },
);

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
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
export type QuestionNodeConfig = z.infer<typeof QuestionNodeConfigSchema>;
export type GreetingNodeConfig = z.infer<typeof GreetingNodeConfigSchema>;
export type DisplayNodeConfig = z.infer<typeof DisplayNodeConfigSchema>;
export type IngestNodeConfig = z.infer<typeof IngestNodeConfigSchema>;
export type AffirmativeCheckConfig = z.infer<typeof AffirmativeCheckConfigSchema>;
export type RephraseContext = z.infer<typeof RephraseContextSchema>;
export type PrefixConfig = z.infer<typeof PrefixConfigSchema>;
