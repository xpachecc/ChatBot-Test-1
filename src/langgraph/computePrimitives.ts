import type { ChatOpenAI } from "@langchain/openai";
import type { CfsState } from "./state.js";
import { AsyncPrimitive } from "./primitiveBase.js";
import { pushAI, mergeStatePatch, patchSessionContext } from "./utilities.js";
import { invokeChatModelWithFallback } from "./aiHelpers.js";

export type VectorSelectParams<T = unknown> = {
  retrieve: (state: CfsState) => Promise<{ candidates: T[]; snippets: string[] }>;
  selectWithAI: (params: { state: CfsState; candidates: T[]; snippets: string[] }) => Promise<T | null>;
  fallback: (candidates: T[]) => T;
  statePatch: (state: CfsState, selected: T, snippets: string[]) => Partial<CfsState>;
};

/**
 * Retrieve candidates from a source (e.g. vector store), select best with AI,
 * fallback to deterministic choice when AI unavailable. Returns state patch.
 */
export class VectorSelectPrimitive extends AsyncPrimitive {
  readonly name = "VectorSelect" as const;
  templateId = "vector_select_v1";

  async run(state: CfsState, input: VectorSelectParams<unknown>): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { retrieve, selectWithAI, fallback, statePatch } = input;

    let selected: unknown;
    let snippets: string[] = [];

    try {
      const { candidates, snippets: s } = await retrieve(state);
      snippets = s ?? [];
      if (!candidates?.length) {
        selected = fallback([]);
      } else {
        const aiSelected = await selectWithAI({ state, candidates, snippets });
        selected = aiSelected ?? fallback(candidates);
      }
    } catch {
      selected = fallback([]);
    }

    const out = statePatch(state, selected, snippets);
    const merged = mergeStatePatch(state, out) as CfsState;
    return { ...out, ...this.logEnd(merged, t0) };
  }
}

export type SectionBuildParams = {
  sectionKey: string;
  systemPrompt: string;
  userPayload: string;
  fallback: string;
};

export type MultiSectionDocBuilderParams = {
  model: ChatOpenAI | null;
  sectionKeys: string[];
  buildSectionParams: (sectionKey: string, context: Record<string, unknown>) => SectionBuildParams;
  context: Record<string, unknown>;
  outputBuilder: (sections: Record<string, string>, fullDraft: string) => Partial<CfsState>;
  qaCheck?: (fullDraft: string, context: Record<string, unknown>) => Promise<{ pass: boolean; repairs?: Array<{ sectionKey: string; repairInstruction: string }> }>;
  repairSection?: (sectionKey: string, original: string, instruction: string, context: Record<string, unknown>) => Promise<string>;
};

/**
 * Build a multi-section document by invoking the model per section,
 * with optional QA check and repair cycle.
 */
export class MultiSectionDocBuilderPrimitive extends AsyncPrimitive {
  readonly name = "MultiSectionDocBuilder" as const;
  templateId = "multi_section_doc_v1";

  async run(state: CfsState, input: MultiSectionDocBuilderParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { model, sectionKeys, buildSectionParams, context, outputBuilder, qaCheck, repairSection } = input;

    const sectionOutputs: Record<string, string> = {};

    for (const sectionKey of sectionKeys) {
      const params = buildSectionParams(sectionKey, context);
      if (model) {
        sectionOutputs[sectionKey] = await invokeChatModelWithFallback(
          model,
          params.systemPrompt,
          params.userPayload,
          { runName: `buildSection:${sectionKey}`, fallback: params.fallback }
        );
      } else {
        sectionOutputs[sectionKey] = params.fallback;
      }
    }

    let fullDraft = sectionKeys.map((k) => sectionOutputs[k]).join("\n\n");

    if (model && qaCheck && repairSection) {
      try {
        const qa = await qaCheck(fullDraft, context);
        if (!qa.pass && qa.repairs?.length) {
          for (const { sectionKey, repairInstruction } of qa.repairs) {
            if (sectionKey in sectionOutputs) {
              sectionOutputs[sectionKey] = await repairSection(
                sectionKey,
                sectionOutputs[sectionKey],
                repairInstruction,
                context
              );
            }
          }
          fullDraft = sectionKeys.map((k) => sectionOutputs[k]).join("\n\n");
        }
      } catch {
        // Keep generated draft on QA failure
      }
    }

    const out = outputBuilder(sectionOutputs, fullDraft);
    const merged = mergeStatePatch(state, out) as CfsState;
    return { ...out, ...this.logEnd(merged, t0) };
  }
}

// ── AiRecapPrimitive ─────────────────────────────────────────────────

export type AiRecapParams = {
  buildContext: (state: CfsState) => Record<string, string>;
  buildFallback: (ctx: Record<string, string>) => string;
  systemPrompt: string;
  buildUserPayload: (ctx: Record<string, string>, state: CfsState) => string;
  model: ChatOpenAI | null;
  runName: string;
  overrideValue?: string | null;
  questionKey: string;
};

/**
 * Override -> fallback -> AI-call chain used for recap/echo nodes.
 * Returns pushAI + patchSessionContext.
 */
export class AiRecapPrimitive extends AsyncPrimitive {
  readonly name = "AiRecap" as const;
  templateId = "ai_recap_v1";

  async run(state: CfsState, input: AiRecapParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const ctx = input.buildContext(state);
    const fallback = input.buildFallback(ctx);

    if (input.overrideValue !== undefined) {
      const text = input.overrideValue ?? fallback;
      const out = {
        ...pushAI(state, text),
        ...patchSessionContext(state, { awaiting_user: true, last_question_key: input.questionKey }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    if (!input.model) {
      const out = {
        ...pushAI(state, fallback),
        ...patchSessionContext(state, { awaiting_user: true, last_question_key: input.questionKey }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    const userPayload = input.buildUserPayload(ctx, state);
    const text = await invokeChatModelWithFallback(input.model, input.systemPrompt, userPayload, {
      runName: input.runName,
      fallback,
    });
    const out = {
      ...pushAI(state, text),
      ...patchSessionContext(state, { awaiting_user: true, last_question_key: input.questionKey }),
    };
    return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
  }
}

// ── CascadingResolvePrimitive ────────────────────────────────────────

export type CascadingResolveParams<T> = {
  sources: Array<{ name: string; fetch: () => Promise<T[]> }>;
  validate: (items: T[], allowed: T[]) => T[];
  fetchAllowed: () => Promise<T[]>;
  buildStateUpdate: (state: CfsState, items: T[]) => Partial<CfsState>;
  nextStep: CfsState["session_context"]["step"];
  tracePrefix: string;
};

/**
 * Try sources in order, validate against an allowed set, fallback to full allowed set.
 * Writes reason_trace and guardrail_log automatically.
 */
export class CascadingResolvePrimitive extends AsyncPrimitive {
  readonly name = "CascadingResolve" as const;
  templateId = "cascading_resolve_v1";

  async run(state: CfsState, input: CascadingResolveParams<unknown>): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { sources, validate, fetchAllowed, buildStateUpdate, nextStep, tracePrefix } = input;

    let allowed: unknown[] = [];
    try {
      allowed = await fetchAllowed();
    } catch { /* empty */ }

    if (!allowed.length) {
      const out = {
        ...buildStateUpdate(state, []),
        ...patchSessionContext(state, {
          step: nextStep,
          reason_trace: [...state.session_context.reason_trace, `${tracePrefix}:empty`],
          guardrail_log: [...state.session_context.guardrail_log, `guardrail:fail:${tracePrefix}_empty`],
        }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    for (const source of sources) {
      try {
        const items = await source.fetch();
        if (items.length) {
          const validated = validate(items, allowed);
          if (validated.length) {
            const out = {
              ...buildStateUpdate(state, validated),
              ...patchSessionContext(state, {
                step: nextStep,
                reason_trace: [...state.session_context.reason_trace, `${tracePrefix}:${source.name}_ok`],
              }),
            };
            return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
          }
        }
      } catch { /* try next source */ }
    }

    const out = {
      ...buildStateUpdate(state, allowed),
      ...patchSessionContext(state, {
        step: nextStep,
        reason_trace: [...state.session_context.reason_trace, `${tracePrefix}:fallback`],
        guardrail_log: [...state.session_context.guardrail_log, `guardrail:fail:${tracePrefix}_fallback`],
      }),
    };
    return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
  }
}

// ── DocStyleQaPrimitive ──────────────────────────────────────────────

export type DocStyleQaParams = {
  model: ChatOpenAI;
  fullDraft: string;
  sectionOutputs: Record<string, string>;
  sectionKeys: string[];
  buildStylePrompt: (draft: string) => { system: string; user: string };
  buildRepairPrompt: (sectionKey: string, original: string, instruction: string) => { system: string; user: string };
};

/**
 * Run a style/voice QA pass on a completed document and repair failing sections.
 * Returns updated sectionOutputs and fullDraft.
 */
export class DocStyleQaPrimitive extends AsyncPrimitive {
  readonly name = "DocStyleQa" as const;
  templateId = "doc_style_qa_v1";

  async run(state: CfsState, input: DocStyleQaParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { model, sectionKeys, buildStylePrompt, buildRepairPrompt } = input;
    const sectionOutputs = { ...input.sectionOutputs };
    let fullDraft = input.fullDraft;

    try {
      const stylePayload = buildStylePrompt(fullDraft);
      const styleRaw = await invokeChatModelWithFallback(model, stylePayload.system, stylePayload.user, {
        runName: "docStyleQa",
        fallback: "{}",
      });
      let styleJson: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(styleRaw);
        if (parsed && typeof parsed === "object") styleJson = parsed as Record<string, unknown>;
      } catch { /* invalid JSON */ }

      if (styleJson && styleJson.pass === false && Array.isArray(styleJson.section_style_results)) {
        for (const result of styleJson.section_style_results as Array<Record<string, unknown>>) {
          if (!result || result.pass !== false || !result.section_key || !result.repair_instruction) continue;
          const sk = String(result.section_key);
          if (!(sk in sectionOutputs)) continue;
          const repairPayload = buildRepairPrompt(sk, sectionOutputs[sk], String(result.repair_instruction));
          sectionOutputs[sk] = await invokeChatModelWithFallback(model, repairPayload.system, repairPayload.user, {
            runName: `docStyleRepair:${sk}`,
            fallback: sectionOutputs[sk],
          });
        }
        fullDraft = sectionKeys.map((k) => sectionOutputs[k]).join("\n\n");
      }
    } catch {
      // Keep structurally valid draft on failure.
    }

    const out = { _sectionOutputs: sectionOutputs, _fullDraft: fullDraft } as unknown as Partial<CfsState>;
    return { ...out, ...this.logEnd(state, t0) };
  }
}

export const vectorSelect = new VectorSelectPrimitive();
export const multiSectionDocBuilder = new MultiSectionDocBuilderPrimitive();
export const aiRecap = new AiRecapPrimitive();
export const cascadingResolve = new CascadingResolvePrimitive();
export const docStyleQa = new DocStyleQaPrimitive();
