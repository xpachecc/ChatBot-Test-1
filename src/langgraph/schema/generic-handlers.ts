import type { CfsState } from "../state.js";
import type {
  NodeDef,
  GraphConfig,
  QuestionNodeConfig,
  GreetingNodeConfig,
  DisplayNodeConfig,
  IngestNodeConfig,
} from "./graph-dsl-types.js";
import {
  PrimitivesInstance,
  lastHumanMessage,
  pushAI,
  applyUserAnswer,
  configString,
  interpolate,
  SpanSanitizer,
  askWithRephrase,
  mergeStatePatch,
  patchSessionContext,
} from "../infra.js";
import { isAffirmativeAnswer } from "../core/helpers/sentiment.js";

type NodeHandler =
  | ((state: CfsState) => Partial<CfsState>)
  | ((state: CfsState) => Promise<Partial<CfsState>>);

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (cur, key) => (cur != null && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

function resolveStateField(state: CfsState, stateField: string, fallback: string): string {
  const paths = stateField.split("|");
  for (const p of paths) {
    const val = getNestedValue(state as unknown as Record<string, unknown>, p.trim());
    if (val != null && String(val).trim() !== "") return String(val);
  }
  return fallback;
}

function createQuestionHandler(qc: QuestionNodeConfig): NodeHandler {
  return async (state: CfsState): Promise<Partial<CfsState>> => {
    let questionText: string;
    if (qc.stringKeys && qc.stringKeys.length > 0) {
      const parts = qc.stringKeys.map((k) => configString(k, ""));
      questionText = parts.filter(Boolean).join("\n\n");
    } else {
      questionText = configString(qc.stringKey ?? "", "");
    }

    if (qc.interpolateFrom) {
      const vars: Record<string, string> = {};
      for (const [placeholder, statePath] of Object.entries(qc.interpolateFrom)) {
        vars[placeholder] = resolveStateField(state, statePath, "");
      }
      questionText = interpolate(questionText, vars);
    }

    let prefixValue: string | undefined;
    if (qc.prefix) {
      prefixValue = SpanSanitizer(
        resolveStateField(state, qc.prefix.stateField, ""),
        qc.prefix.fallback,
      );
    }

    if (qc.allowAIRephrase) {
      const rephraseCtx: Record<string, string | null | string[] | undefined> = {};
      if (qc.rephraseContext) {
        if (qc.rephraseContext.industryField)
          rephraseCtx.industry = resolveStateField(state, qc.rephraseContext.industryField, "");
        if (qc.rephraseContext.roleField)
          rephraseCtx.role = resolveStateField(state, qc.rephraseContext.roleField, "");
        if (qc.rephraseContext.useCaseGroupsField) {
          const val = getNestedValue(state as unknown as Record<string, unknown>, qc.rephraseContext.useCaseGroupsField);
          rephraseCtx.useCaseGroups = Array.isArray(val) ? val as string[] : undefined;
        }
        if (qc.rephraseContext.actorRole) rephraseCtx.actorRole = qc.rephraseContext.actorRole;
        if (qc.rephraseContext.tone) rephraseCtx.tone = qc.rephraseContext.tone;
      }

      return askWithRephrase.run(state, {
        baseQuestion: questionText,
        questionKey: qc.questionKey,
        questionPurpose: qc.questionPurpose,
        targetVariable: qc.targetVariable,
        prefix: prefixValue,
        allowAIRephrase: true,
        rephraseContext: rephraseCtx as Parameters<typeof askWithRephrase.run>[1]["rephraseContext"],
      });
    }

    if (prefixValue) {
      questionText = `${prefixValue}, ${questionText}`;
    }

    return PrimitivesInstance.AskQuestion.run(state, {
      question: questionText,
      questionKey: qc.questionKey,
      questionPurpose: qc.questionPurpose,
      targetVariable: qc.targetVariable,
    });
  };
}

function createGreetingHandler(gc: GreetingNodeConfig): NodeHandler {
  return (state: CfsState): Partial<CfsState> => {
    let current = state;
    let lastPatch: Partial<CfsState> = {};

    for (const key of gc.stringKeys) {
      const text = configString(key, "");
      if (!text) continue;
      const patch = pushAI(current, text, "intro");
      current = mergeStatePatch(current, patch);
      lastPatch = { ...lastPatch, ...patch };
    }

    const sessionPatch: Partial<CfsState["session_context"]> = {
      started: true,
      awaiting_user: true,
      step_question_index: 0,
      step_clarifier_used: false,
    };
    if (gc.afterQuestionKey) {
      sessionPatch.last_question_key = gc.afterQuestionKey;
    }
    if (gc.initialSessionContext) {
      Object.assign(sessionPatch, gc.initialSessionContext);
    }

    return { ...lastPatch, ...patchSessionContext(current, sessionPatch) };
  };
}

function createDisplayHandler(dc: DisplayNodeConfig): NodeHandler {
  return (state: CfsState): Partial<CfsState> => {
    const raw = getNestedValue(state as unknown as Record<string, unknown>, dc.statePath);
    const content = typeof raw === "string" ? raw : "";

    if (!content && !dc.fallbackMessage) return {};

    let message = content || dc.fallbackMessage || "";

    if (dc.appendDownloadUrl) {
      const url = resolveStateField(state, dc.appendDownloadUrl.stateField, "");
      const downloadUrl = url || dc.appendDownloadUrl.fallbackPattern.replace(
        "{{session_id}}",
        state.session_context?.session_id ?? "",
      );
      message = message
        ? `${message}\n\n---\nDownload: ${downloadUrl}`
        : `Your output is ready. Download: ${downloadUrl}`;
    }

    return pushAI(state, message);
  };
}

function createIngestHandler(ic?: IngestNodeConfig): NodeHandler {
  return async (state: CfsState): Promise<Partial<CfsState>> => {
    if (ic?.affirmativeCheckConfig) {
      const humanMsg = lastHumanMessage(state);
      const answer = (humanMsg?.content?.toString() ?? "").trim();

      if (!isAffirmativeAnswer(answer)) {
        const rejectMsg = configString(ic.affirmativeCheckConfig.rejectStringKey, "");
        const rejectPatch = ic.affirmativeCheckConfig.rejectPatch ?? {};
        return {
          ...pushAI(state, rejectMsg),
          ...patchSessionContext(state, {
            awaiting_user: true,
            ...rejectPatch as Partial<CfsState["session_context"]>,
          }),
        };
      }

      const acceptPatch = ic.affirmativeCheckConfig.acceptPatch ?? {};
      if (ic.affirmativeCheckConfig.acceptQuestionConfig) {
        const qc = ic.affirmativeCheckConfig.acceptQuestionConfig;
        const question = configString(qc.stringKey, "");
        const result = PrimitivesInstance.AskQuestion.run(state, {
          question,
          questionKey: qc.questionKey,
          questionPurpose: qc.questionPurpose ?? "",
          targetVariable: qc.targetVariable ?? "",
        });
        return {
          ...result,
          ...patchSessionContext(state, {
            awaiting_user: true,
            last_question_key: qc.questionKey,
            ...acceptPatch as Partial<CfsState["session_context"]>,
          }),
        };
      }
      if (ic.affirmativeCheckConfig.acceptStringKey) {
        const acceptMsg = configString(ic.affirmativeCheckConfig.acceptStringKey, "");
        return {
          ...pushAI(state, acceptMsg),
          ...patchSessionContext(state, {
            awaiting_user: false,
            last_question_key: null,
            ...acceptPatch as Partial<CfsState["session_context"]>,
          }),
        };
      }

      return patchSessionContext(state, {
        awaiting_user: false,
        last_question_key: null,
        ...acceptPatch as Partial<CfsState["session_context"]>,
      });
    }

    const updates = await applyUserAnswer(state);
    return {
      ...updates,
      ...patchSessionContext(state, {
        ...(updates.session_context ?? {}),
        awaiting_user: false,
      }),
    };
  };
}

export function createGenericHandler(
  node: NodeDef,
  _config: GraphConfig,
): NodeHandler {
  const nc = node.nodeConfig;
  if (!nc) {
    throw new Error(`Node "${node.id}" has no nodeConfig and no handlerRef — cannot create generic handler.`);
  }

  if (nc.question) return createQuestionHandler(nc.question);
  if (nc.greeting) return createGreetingHandler(nc.greeting);
  if (nc.display) return createDisplayHandler(nc.display);
  if (nc.ingest) return createIngestHandler(nc.ingest);

  if (node.kind === "ingest") return createIngestHandler();

  throw new Error(
    `Node "${node.id}" has nodeConfig but no recognized config block (question, greeting, display, ingest).`,
  );
}
