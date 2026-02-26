import * as z from "zod";

export const InternetSearchContextSchema = z.object({
  last_query: z.string().nullable().default(null),
  results: z.array(z.any()).default([]),
  fetched_at: z.number().nullable().default(null),
  sub_industries: z.array(z.string()).default([]),
});
