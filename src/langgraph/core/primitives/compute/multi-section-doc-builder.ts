import type { ChatOpenAI } from "@langchain/openai";
import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { mergeStatePatch } from "../../helpers/state.js";
import { invokeChatModelWithFallback } from "../../services/ai/invoke.js";

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

export const multiSectionDocBuilder = new MultiSectionDocBuilderPrimitive();
