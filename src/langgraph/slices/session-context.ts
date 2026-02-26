import * as z from "zod";
import { PrimitiveLogSchema } from "./primitive-log.js";

export const SessionContextSchema = z.object({
  session_id: z.string(),
  tenant_id: z.string().nullable().default(null),
  graph_id: z.string().default("cfs"),
  step: z.string().default("STEP1_KNOW_YOUR_CUSTOMER"),
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

export type SessionContext = z.infer<typeof SessionContextSchema>;
