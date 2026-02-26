import * as z from "zod";

export const UserContextSchema = z.object({
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

export type UserContext = z.infer<typeof UserContextSchema>;
