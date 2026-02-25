import type { CfsState, PrimitiveName } from "../../../state.js";
import { Primitive } from "../base.js";

export class CaptureObjectivePrimitive extends Primitive {
  name: PrimitiveName = "CaptureObjective";
  templateId = "capture_objective_v1";
  run(state: CfsState, input: { rawGoal: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const normalized = input.rawGoal.trim().replace(/\s+/g, " ");
    const out: Partial<CfsState> = { use_case_context: { ...state.use_case_context, objective_normalized: normalized } };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

export const captureObjective = new CaptureObjectivePrimitive();
