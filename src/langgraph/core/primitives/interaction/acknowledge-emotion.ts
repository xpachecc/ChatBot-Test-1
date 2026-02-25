import type { CfsState, PrimitiveName } from "../../../state.js";
import { Primitive } from "../base.js";
import { pushAI } from "../../helpers/messaging.js";

export class AcknowledgeEmotionPrimitive extends Primitive {
  name: PrimitiveName = "AcknowledgeEmotion";
  templateId = "acknowledge_emotion_v1";
  run(state: CfsState, input: { sentiment: "positive" | "neutral" | "concerned" }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const text =
      input.sentiment === "concerned"
        ? "Understood. That pressure is real. We'll keep this tight and focused now."
        : input.sentiment === "positive"
        ? "Understood. That clarity helps us move faster."
        : "Understood.";
    const out = pushAI(state, text);
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

export const acknowledgeEmotion = new AcknowledgeEmotionPrimitive();
