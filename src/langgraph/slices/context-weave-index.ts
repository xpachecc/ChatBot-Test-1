import * as z from "zod";

export const ContextWeaveIndexSchema = z.object({
  user_phrases: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
});
