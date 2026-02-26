import * as z from "zod";

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
