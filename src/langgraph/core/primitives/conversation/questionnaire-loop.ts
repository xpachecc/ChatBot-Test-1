import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { pushAI, lastHumanMessage } from "../../helpers/messaging.js";
import { mergeStatePatch, patchSessionContext } from "../../helpers/state.js";

export type QuestionnaireLoopParams = {
  questions: Array<{ question: string; response?: string | null; risk?: string | null; risk_domain?: string | null }>;
  questionKey: string;
  buildPrompt: (question: string, index: number, total: number) => string;
  sanitizeAnswer: (raw: string) => string;
  processAnswer?: (state: CfsState, question: string, answer: string) => Promise<{ risk?: string | null; risk_domain?: string | null }>;
  closingMessage?: string;
  stateField: keyof CfsState;
  stateItemKey: string;
  introMessage?: string;
  reasonTraceStart?: string;
  reasonTraceComplete?: string;
  reasonTraceEmpty?: string;
};

/**
 * Loop through a questionnaire: present questions one at a time, capture answers,
 * optionally assess risk per answer, advance index, and complete when done.
 */
export class QuestionnaireLoopPrimitive extends AsyncPrimitive {
  readonly name = "QuestionnaireLoop" as const;
  templateId = "questionnaire_loop_v1";

  async run(state: CfsState, input: QuestionnaireLoopParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const {
      questions,
      questionKey,
      buildPrompt,
      sanitizeAnswer,
      processAnswer,
      closingMessage,
      stateField,
      stateItemKey,
      introMessage,
      reasonTraceStart,
      reasonTraceComplete,
      reasonTraceEmpty,
    } = input;

    const questionItems = questions.map((q) => ({
      question: typeof q === "object" && q?.question ? String(q.question).trim() : "",
      response: (q as any)?.response ?? null,
      risk: (q as any)?.risk ?? null,
      risk_domain: (q as any)?.risk_domain ?? null,
    })).filter((q) => q.question);
    const total = questionItems.length;

    if (total === 0) {
      const out: Partial<CfsState> = {
        ...pushAI(state, "We don't have questions available right now."),
        ...patchSessionContext(state, { awaiting_user: false, last_question_key: null }),
      };
      if (reasonTraceEmpty) {
        out.session_context = {
          ...state.session_context,
          ...(out.session_context ?? {}),
          reason_trace: [...state.session_context.reason_trace, reasonTraceEmpty],
        };
      }
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    const currentIndex = state.session_context.step_question_index ?? 0;
    const awaiting = state.session_context.awaiting_user && state.session_context.last_question_key === questionKey;

    if (awaiting) {
      const answerRaw = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
      const cleaned = sanitizeAnswer(answerRaw);
      if (!cleaned) {
        const retry = buildPrompt(questionItems[currentIndex]?.question ?? "", currentIndex, total);
        const out = {
          ...pushAI(state, retry),
          ...patchSessionContext(state, { awaiting_user: true, last_question_key: questionKey }),
        };
        return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
      }

      const questionText = questionItems[currentIndex]?.question ?? "";
      let risk: string | null = null;
      let risk_domain: string | null = null;
      if (processAnswer) {
        const assessment = await processAnswer(state, questionText, cleaned);
        risk = assessment.risk ?? null;
        risk_domain = assessment.risk_domain ?? null;
      }

      const updatedItems = questionItems.map((item, idx) =>
        idx === currentIndex ? { ...item, response: cleaned, risk, risk_domain } : item
      );

      const nextIndex = currentIndex + 1;
      if (nextIndex < total) {
        const nextPrompt = buildPrompt(questionItems[nextIndex]?.question ?? "", nextIndex, total);
        const out = {
          ...pushAI(state, nextPrompt),
          [stateField]: { ...(state[stateField] as object), [stateItemKey]: updatedItems },
          ...patchSessionContext(state, {
            step_question_index: nextIndex,
            awaiting_user: true,
            last_question_key: questionKey,
          }),
        };
        const merged = mergeStatePatch(state, out) as CfsState;
        return { ...out, ...this.logEnd(merged, t0) };
      }

      const closing = closingMessage
        ? pushAI(state, closingMessage)
        : {};
      const out: Partial<CfsState> = {
        ...closing,
        [stateField]: { ...(state[stateField] as object), [stateItemKey]: updatedItems },
        ...patchSessionContext(state, {
          step_question_index: 0,
          awaiting_user: false,
          last_question_key: null,
        }),
      };
      if (reasonTraceComplete) {
        out.session_context = {
          ...state.session_context,
          ...(out.session_context ?? {}),
          reason_trace: [...state.session_context.reason_trace, reasonTraceComplete],
        };
      }
      const merged = mergeStatePatch(state, out) as CfsState;
      return { ...out, ...this.logEnd(merged, t0) };
    }

    let baseState = state;
    if (introMessage) {
      const withIntro = pushAI(state, introMessage);
      baseState = mergeStatePatch(state, withIntro) as CfsState;
    }
    const firstPrompt = buildPrompt(questionItems[0]?.question ?? "", 0, total);
    const withQuestion = pushAI(baseState, firstPrompt);
    const out: Partial<CfsState> = {
      ...withQuestion,
      ...patchSessionContext(state, {
        step_question_index: 0,
        awaiting_user: true,
        last_question_key: questionKey,
      }),
    };
    if (reasonTraceStart) {
      out.session_context = {
        ...state.session_context,
        ...(out.session_context ?? {}),
        reason_trace: [...state.session_context.reason_trace, reasonTraceStart],
      };
    }
    const merged = mergeStatePatch(state, out) as CfsState;
    return { ...out, ...this.logEnd(merged, t0) };
  }
}

export const questionnaireLoop = new QuestionnaireLoopPrimitive();
