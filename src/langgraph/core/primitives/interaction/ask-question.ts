import type { CfsState, PrimitiveName } from "../../../state.js";
import { Primitive } from "../base.js";
import { pushAI } from "../../helpers/messaging.js";

export class AskQuestionPrimitive extends Primitive {
  name: PrimitiveName = "AskQuestion";
  templateId = "ask_question_v1";
  run(state: CfsState, input: { question: string; questionKey: string; questionPurpose?: string; targetVariable?: string; disableContextTokens?: boolean }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const q = input.question;
    const out: Partial<CfsState> = {
      ...(q ? pushAI(state, q) : {}),
      session_context: { ...state.session_context, last_question_key: input.questionKey, awaiting_user: true, step_clarifier_used: false },
    };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

export const askQuestion = new AskQuestionPrimitive();
