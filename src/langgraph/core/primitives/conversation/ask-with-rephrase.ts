import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { pushAI } from "../../helpers/messaging.js";
import { mergeStatePatch, patchSessionContext } from "../../helpers/state.js";
import { rephraseQuestionWithAI } from "../../services/ai/rephrase.js";

export type AskWithRephraseParams = {
  baseQuestion: string;
  questionKey: string;
  questionPurpose?: string;
  targetVariable?: string;
  prefix?: string;
  allowAIRephrase?: boolean;
  rephraseContext?: {
    industry?: string | null;
    role?: string | null;
    useCaseGroups?: string[];
    actorRole?: string;
    tone?: string;
  };
};

/**
 * Ask a question with optional AI rephrasing for context-awareness.
 * Uses rephraseQuestionWithAI when allowAIRephrase is true, then pushes the question.
 */
export class AskWithRephrasePrimitive extends AsyncPrimitive {
  readonly name = "AskWithRephrase" as const;
  templateId = "ask_with_rephrase_v1";

  async run(state: CfsState, input: AskWithRephraseParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const {
      baseQuestion,
      questionKey,
      questionPurpose,
      targetVariable,
      prefix = "",
      allowAIRephrase = false,
      rephraseContext = {},
    } = input;

    let question = baseQuestion;
    if (allowAIRephrase) {
      const rephrased = await rephraseQuestionWithAI({
        baseQuestion,
        industry: rephraseContext.industry ?? state.user_context.industry,
        role: rephraseContext.role ?? state.user_context.persona_role,
        useCaseGroups: rephraseContext.useCaseGroups ?? state.use_case_context.use_case_groups,
        allowAIRephrase: true,
        actorRole: rephraseContext.actorRole ?? "SAAS Enterprise Account Executive",
        tone: rephraseContext.tone ?? "conversational, curious",
      });
      question = rephrased ?? baseQuestion;
    }

    const fullQuestion = prefix ? `${prefix}\n${question}`.trim() : question;
    const out: Partial<CfsState> = {
      ...pushAI(state, fullQuestion),
      ...patchSessionContext(state, {
        last_question_key: questionKey,
        awaiting_user: true,
        step_clarifier_used: false,
      }),
    };
    const merged = mergeStatePatch(state, out) as CfsState;
    return { ...out, ...this.logEnd(merged, t0) };
  }
}

export const askWithRephrase = new AskWithRephrasePrimitive();
