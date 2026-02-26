import * as z from "zod";

export const RelationshipContextSchema = z.object({
  trust_score: z.number().min(0).max(1).default(0.6),
  sentiment_score: z.number().min(0).max(1).default(0.7),
  engagement_level: z.number().min(0).max(1).default(0.7),
  sentiment_log: z.array(z.string()).default([]),
});
