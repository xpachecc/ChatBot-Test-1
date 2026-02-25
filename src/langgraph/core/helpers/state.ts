import crypto from "node:crypto";
import type { CfsState } from "../../state.js";
import { CfsStateSchema } from "../../state.js";
import { computeFlowProgress } from "../../flow-progress.js";

export { computeFlowProgress, type StepProgressStatus, type StepProgress, type FlowProgress } from "../../flow-progress.js";

export function nowMs(): number {
  return Date.now();
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function mergeStatePatch(base: CfsState, ...patches: Partial<CfsState>[]): CfsState {
  let result: CfsState = base;
  for (const patch of patches) {
    result = { ...result, ...patch } as CfsState;
  }
  return result;
}

export function patchSessionContext(
  state: CfsState,
  patch: Partial<CfsState["session_context"]>
): Pick<CfsState, "session_context"> {
  return { session_context: { ...state.session_context, ...patch } };
}

export function createInitialState(params?: { sessionId?: string }): CfsState {
  const session_id = params?.sessionId ?? crypto.randomUUID();
  return CfsStateSchema.parse({
    messages: [],
    overlay_active: "SeniorSE_Curious",
    session_context: {
      session_id,
      step: "STEP1_KNOW_YOUR_CUSTOMER",
      step_question_index: 0,
      step_clarifier_used: false,
      last_question_key: null,
      awaiting_user: false,
      started: false,
      primitive_counter: 0,
    },
  });
}
