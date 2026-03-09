import * as z from "zod";
import { SignalEventSchema, SignalActionSchema } from "../core/agents/signal-types.js";

export const RelationshipContextSchema = z.object({
  engagement_score: z.number().min(0).max(1).default(0.5),
  sentiment_score: z.number().min(0).max(1).default(0.5),
  trust_score: z.number().min(0).max(1).default(0.5),
  intent_score: z.number().min(0).max(1).default(0.5),
  overall_conversation_score: z.number().min(0).max(1).default(0.5),
  turn_count: z.number().int().min(0).default(0),
  signal_history: z.array(z.any()).default([]),
  signal_events: z.array(SignalEventSchema).default([]),
  signal_actions: z.array(SignalActionSchema).default([]),
  last_signal_timestamp: z.number().nullable().default(null),
});
