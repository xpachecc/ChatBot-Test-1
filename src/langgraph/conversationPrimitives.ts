import type { CfsState } from "./state.js";
import { Primitive, AsyncPrimitive } from "./primitiveBase.js";
import { pushAI, mergeStatePatch, patchSessionContext, lastHumanMessage, sanitizeNumericSelectionInput, parseNumericSelectionIndices } from "./utilities.js";
import { rephraseQuestionWithAI } from "./aiHelpers.js";

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

export type ClarifyIfVagueParams = {
  value: string;
  isVague: (value: string) => Promise<boolean> | boolean;
  fetchSuggestions: (value: string) => Promise<{ suggestions: string[]; results?: unknown }>;
  buildClarificationMessage: (value: string, suggestions: string[]) => string;
  buildExamplesMessage?: (suggestions: string[]) => string;
  questionKey: string;
  extraPatch?: (suggestions: string[], results?: unknown) => Partial<CfsState>;
};

/**
 * When a value is vague, fetch suggestions and ask for clarification.
 * Sets step_clarifier_used and stores suggestions in state (e.g. internet_search_context).
 */
export class ClarifyIfVaguePrimitive extends AsyncPrimitive {
  readonly name = "ClarifyIfVague" as const;
  templateId = "clarify_if_vague_v1";

  async run(state: CfsState, input: ClarifyIfVagueParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const {
      value,
      isVague,
      fetchSuggestions,
      buildClarificationMessage,
      buildExamplesMessage,
      questionKey,
      extraPatch,
    } = input;

    const vague = await isVague(value);
    if (!vague) {
      return this.logEnd(state, t0);
    }

    try {
      const { suggestions, results } = await fetchSuggestions(value);
      if (!suggestions?.length) return this.logEnd(state, t0);

      const alignMessage = buildClarificationMessage(value, suggestions);
      const withAlign = pushAI(state, alignMessage, "industryClarifier");
      const examplesMsg = buildExamplesMessage
        ? buildExamplesMessage(suggestions)
        : `For instance: ${suggestions.join(", ")}.`;
      const withExamples = pushAI(mergeStatePatch(state, withAlign), examplesMsg, "industryClarifier");

      const out: Partial<CfsState> = {
        ...withExamples,
        ...patchSessionContext(state, {
          step_clarifier_used: true,
          awaiting_user: true,
          last_question_key: questionKey,
        }),
      };
      if (extraPatch) {
        Object.assign(out, extraPatch(suggestions, results));
      }
      const merged = mergeStatePatch(state, out) as CfsState;
      return { ...out, ...this.logEnd(merged, t0) };
    } catch {
      return this.logEnd(state, t0);
    }
  }
}

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

export type IngestHandler = (state: CfsState) => Promise<Partial<CfsState>> | Partial<CfsState>;

export type IngestDispatcherParams = {
  handlers: Record<string, IngestHandler>;
  lastQuestionKey: string | null;
};

/**
 * Dispatch to a handler based on last_question_key.
 * Used to replace large if/switch chains in ingest nodes.
 */
export class IngestDispatcherPrimitive extends AsyncPrimitive {
  readonly name = "IngestDispatcher" as const;
  templateId = "ingest_dispatcher_v1";

  async run(state: CfsState, input: IngestDispatcherParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { handlers, lastQuestionKey } = input;

    const key = lastQuestionKey ?? "";
    const handler = handlers[key];
    if (!handler) {
      return this.logEnd(state, t0);
    }

    const result = await handler(state);
    const merged = mergeStatePatch(state, result) as CfsState;
    return { ...result, ...this.logEnd(merged, t0) };
  }
}

// ── NumericSelectionIngestPrimitive ───────────────────────────────────

export type NumericSelectionIngestParams = {
  availableItems: Array<{ name: string; [key: string]: unknown }>;
  questionKey: string;
  retryMessage: string;
  successMessage: string;
  stateField: keyof CfsState;
  stateItemKey: string;
};

/**
 * Parse numeric user selection (e.g. "1" or "1,3"), validate against available items,
 * and return selected names + state patch. Replaces the inline pattern in nodeIngestUseCaseSelection.
 */
export class NumericSelectionIngestPrimitive extends Primitive {
  readonly name = "NumericSelectionIngest" as const;
  templateId = "numeric_selection_ingest_v1";

  run(state: CfsState, input: NumericSelectionIngestParams): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const { availableItems, questionKey, retryMessage, successMessage, stateField, stateItemKey } = input;
    const raw = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
    const { normalized, invalid } = sanitizeNumericSelectionInput(raw);
    const parsed = invalid ? null : parseNumericSelectionIndices(normalized, availableItems.length);

    if (!parsed || parsed.length === 0) {
      const out = {
        ...pushAI(state, retryMessage),
        ...patchSessionContext(state, { awaiting_user: true, last_question_key: questionKey, step_clarifier_used: true }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    const selected = parsed
      .map((idx) => availableItems[idx - 1]?.name)
      .filter((name): name is string => Boolean(name?.trim()));

    if (selected.length === 0) {
      const out = {
        ...pushAI(state, retryMessage),
        ...patchSessionContext(state, { awaiting_user: true, last_question_key: questionKey, step_clarifier_used: true }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    const out: Partial<CfsState> = {
      ...pushAI(state, successMessage),
      [stateField]: { ...(state[stateField] as object), [stateItemKey]: selected },
      ...patchSessionContext(state, { awaiting_user: false, last_question_key: null }),
    };
    return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
  }
}

// ── ResolveAndConfirmPrimitive ────────────────────────────────────────

export type ResolveAndConfirmParams = {
  resolve: (state: CfsState, input: string) => Promise<{
    classification: string | null;
    confidence: number;
    examples: string[];
    displayName: string | null;
  }>;
  buildConfirmationMessage: (
    displayName: string,
    classification: string | null,
    examples: string[]
  ) => string;
  confirmQuestionKey: string;
  stateUpdater: (
    state: CfsState,
    resolved: { classification: string | null; confidence: number; displayName: string | null }
  ) => Partial<CfsState>;
  messageType?: import("./state.js").MessageType;
};

/**
 * Resolve input -> present confirmation -> if user corrects, re-resolve -> loop.
 * Encapsulates the role resolve-confirm pattern used in KYC.
 */
export class ResolveAndConfirmPrimitive extends AsyncPrimitive {
  readonly name = "ResolveAndConfirm" as const;
  templateId = "resolve_and_confirm_v1";

  async run(state: CfsState, input: ResolveAndConfirmParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { resolve, buildConfirmationMessage, confirmQuestionKey, stateUpdater, messageType } = input;
    const rawInput = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
    const resolved = await resolve(state, rawInput);
    const displayName = resolved.displayName ?? rawInput;
    const message = buildConfirmationMessage(displayName, resolved.classification, resolved.examples);
    const stateUpdate = stateUpdater(state, {
      classification: resolved.classification,
      confidence: resolved.confidence,
      displayName: resolved.displayName,
    });

    const out: Partial<CfsState> = {
      ...stateUpdate,
      ...pushAI(mergeStatePatch(state, stateUpdate), message, messageType ?? "default"),
      ...patchSessionContext(state, {
        last_question_key: confirmQuestionKey,
        awaiting_user: true,
        role_assessment_message: message,
        role_assessment_examples: resolved.examples,
      }),
    };
    const merged = mergeStatePatch(state, out) as CfsState;
    return { ...out, ...this.logEnd(merged, t0) };
  }
}

export const askWithRephrase = new AskWithRephrasePrimitive();
export const clarifyIfVague = new ClarifyIfVaguePrimitive();
export const questionnaireLoop = new QuestionnaireLoopPrimitive();
export const ingestDispatcher = new IngestDispatcherPrimitive();
export const numericSelectionIngest = new NumericSelectionIngestPrimitive();
