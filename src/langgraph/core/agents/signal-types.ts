import * as z from "zod";

/** Context passed to signal agents for conversation-aware assessment. */
export interface SignalContext {
  userText: string;
  lastBotMessage: string | null;
  questionKey: string | null;
  questionPurpose: string | null;
  priorPairs: Array<{ bot: string; user: string }>;
}

/** Single dimension result from one agent (engagement, sentiment, trust, or intent). */
export const SignalAgentResultSchema = z.object({
  dimension: z.enum(["engagement", "sentiment", "trust", "intent"]),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  source: z.enum(["heuristic", "llm"]),
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
  intent: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  source: z.literal("heuristic"),
});
export type SignalTurnRecord = z.infer<typeof SignalTurnRecordSchema>;

export const SignalEventSchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type SignalEvent = z.infer<typeof SignalEventSchema>;

export const SignalActionSchema = z.object({
  type: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  reason: z.string(),
});
export type SignalAction = z.infer<typeof SignalActionSchema>;

/** Aggregated orchestrator output with EMA-updated cumulative scores. */
export const SignalOrchestratorResultSchema = z.object({
  engagement_score: z.number().min(0).max(1),
  sentiment_score: z.number().min(0).max(1),
  trust_score: z.number().min(0).max(1),
  intent_score: z.number().min(0).max(1),
  overall_conversation_score: z.number().min(0).max(1),
  turn_count: z.number().int().min(0),
  signal_history: z.array(SignalTurnRecordSchema),
  signal_events: z.array(SignalEventSchema),
  signal_actions: z.array(SignalActionSchema),
  last_signal_timestamp: z.number().nullable(),
});
export type SignalOrchestratorResult = z.infer<typeof SignalOrchestratorResultSchema>;
