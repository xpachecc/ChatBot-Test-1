import * as z from "zod";

export const UseCaseContextSchema = z.object({
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

export type UseCaseContext = z.infer<typeof UseCaseContextSchema>;
