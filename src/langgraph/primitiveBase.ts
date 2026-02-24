import * as z from "zod";
import type { CfsState } from "./state.js";
import { PrimitiveLogSchema } from "./state.js";
import type { PrimitiveName } from "./state.js";
import { nowMs } from "./utilities.js";

/**
 * Base class for synchronous primitives.
 * Provides logStart/logEnd for telemetry and primitive_log entries.
 */
export abstract class Primitive {
  abstract readonly name: PrimitiveName;
  templateId?: string;

  protected logStart(state: CfsState): { t0: number } {
    return { t0: nowMs() };
  }

  protected logEnd(state: CfsState, t0: number, extra?: Partial<z.infer<typeof PrimitiveLogSchema>>): Partial<CfsState> {
    const t1 = nowMs();
    const entry = PrimitiveLogSchema.parse({
      primitive_name: this.name,
      template_id: this.templateId,
      start_time: t0,
      end_time: t1,
      overlay_active: state.overlay_active,
      trust_score: state.relationship_context.trust_score,
      sentiment_score: state.relationship_context.sentiment_score,
      hash_verified: true,
      guardrail_status: "pass",
      ...(extra ?? {}),
    });
    return {
      session_context: {
        ...state.session_context,
        primitive_counter: state.session_context.primitive_counter + 1,
        primitive_log: [...state.session_context.primitive_log, entry],
      },
    };
  }

  abstract run(state: CfsState, input?: unknown): Partial<CfsState>;
}

/**
 * Base class for asynchronous primitives.
 * Same telemetry as Primitive but with async run().
 */
export abstract class AsyncPrimitive {
  abstract readonly name: PrimitiveName;
  templateId?: string;

  protected logStart(state: CfsState): { t0: number } {
    return { t0: nowMs() };
  }

  protected logEnd(state: CfsState, t0: number, extra?: Partial<z.infer<typeof PrimitiveLogSchema>>): Partial<CfsState> {
    const t1 = nowMs();
    const entry = PrimitiveLogSchema.parse({
      primitive_name: this.name,
      template_id: this.templateId,
      start_time: t0,
      end_time: t1,
      overlay_active: state.overlay_active,
      trust_score: state.relationship_context.trust_score,
      sentiment_score: state.relationship_context.sentiment_score,
      hash_verified: true,
      guardrail_status: "pass",
      ...(extra ?? {}),
    });
    return {
      session_context: {
        ...state.session_context,
        primitive_counter: state.session_context.primitive_counter + 1,
        primitive_log: [...state.session_context.primitive_log, entry],
      },
    };
  }

  abstract run(state: CfsState, input?: unknown): Promise<Partial<CfsState>>;
}
