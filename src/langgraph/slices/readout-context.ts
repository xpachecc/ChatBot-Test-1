import * as z from "zod";

export const ReadoutContextSchema = z.object({
  status: z.enum(["idle", "ready", "error"]).default("idle"),
  generated_at: z.number().nullable().default(null),
  retrieval_filters: z.record(z.any()).default({}),
  documents_by_type: z.record(z.array(z.any())).default({}),
  analysis_json: z.record(z.any()).nullable().default(null),
  qa_checks: z.record(z.any()).default({}),
  canonical: z
    .object({
      document_id: z.string().nullable().default(null),
      version: z.string().default("1.0"),
      metadata: z.record(z.any()).default({}),
      sections: z.array(z.any()).default([]),
      tables: z.array(z.any()).default([]),
      citations: z.array(z.any()).default([]),
      evidence_refs: z.array(z.string()).default([]),
    })
    .default({}),
  rendered_outputs: z
    .object({
      markdown: z.string().nullable().default(null),
      html: z.string().nullable().default(null),
      text: z.string().nullable().default(null),
    })
    .default({}),
  delivery: z
    .object({
      targets_requested: z.array(z.enum(["download", "email", "database"])).default([]),
      download: z.record(z.any()).default({ status: "skipped" }),
      email: z.record(z.any()).default({ status: "skipped" }),
      database: z.record(z.any()).default({ status: "skipped" }),
    })
    .default({}),
});

export type ReadoutContext = z.infer<typeof ReadoutContextSchema>;
