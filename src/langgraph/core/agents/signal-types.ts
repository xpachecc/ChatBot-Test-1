import * as z from "zod";

/** Single dimension result from one agent (engagement, sentiment, or trust). */
export const SignalAgentResultSchema = z.object({
  dimension: z.enum(["engagement", "sentiment", "trust"]),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  source: z.literal("heuristic"),
  timestamp: z.number(),
});
export type SignalAgentResult = z.infer<typeof SignalAgentResultSchema>;

/** Lean turn record for signal_history (MVP: no featureHits or evidenceSpans). */
export const SignalTurnRecordSchema = z.object({
  turn_index: z.number().int().min(0),
  timestamp: z.number(),
  engagement: z.number().min(0).max(1),
  sentiment: z.number().min(0).max(1),
  trust: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  source: z.literal("heuristic"),
});
export type SignalTurnRecord = z.infer<typeof SignalTurnRecordSchema>;

/** Aggregated orchestrator output with EMA-updated cumulative scores. */
export const SignalOrchestratorResultSchema = z.object({
  engagement_score: z.number().min(0).max(1),
  sentiment_score: z.number().min(0).max(1),
  trust_score: z.number().min(0).max(1),
  overall_conversation_score: z.number().min(0).max(1),
  turn_count: z.number().int().min(0),
  signal_history: z.array(SignalTurnRecordSchema),
  signal_events: z.array(z.any()),
  signal_actions: z.array(z.any()),
  last_signal_timestamp: z.number().nullable(),
});
export type SignalOrchestratorResult = z.infer<typeof SignalOrchestratorResultSchema>;
