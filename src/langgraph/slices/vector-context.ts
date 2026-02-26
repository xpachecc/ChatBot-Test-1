import * as z from "zod";

export const VectorContextSchema = z.object({
  last_query_signature: z.string().nullable().default(null),
  last_filters: z.record(z.any()).default({}),
  results: z.array(z.any()).default([]),
  history: z.array(z.any()).default([]),
  fetched_at: z.number().nullable().default(null),
  snippets: z.array(z.string()).default([]),
});
