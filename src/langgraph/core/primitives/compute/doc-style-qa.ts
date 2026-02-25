import type { ChatOpenAI } from "@langchain/openai";
import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { invokeChatModelWithFallback } from "../../services/ai/invoke.js";

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

export const docStyleQa = new DocStyleQaPrimitive();
