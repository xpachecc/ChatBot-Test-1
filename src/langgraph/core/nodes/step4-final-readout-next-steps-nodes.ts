import type { CfsState } from "../../state.js";
import {
  pushAI,
  requireGraphMessagingConfig,
  multiSectionDocBuilder,
  configString,
} from "../../infra.js";
import { docStyleQa } from "../primitives/compute/index.js";
import {
  mergeStatePatch,
  patchSessionContext,
  buildFallbackFromSchema,
} from "../../infra.js";
import { invokeChatModelWithFallback } from "../services/ai/invoke.js";
import {
  READOUT_DOCUMENT_TYPES,
  retrieveReadoutDocuments,
} from "../services/vector.js";
import { getModel } from "../config/model-factory.js";
import {
  buildCanonicalReadoutDocument,
  buildReadinessAssessmentPrompt,
  buildReadoutAnalysisPrompt,
  buildReadoutQaPrompt,
  buildReadoutSectionPrompt,
  buildReadoutStyleQaPrompt,
  normalizeUseCasePillarEntries,
} from "./step-flow-helpers.js";

declare global {
  // Optional test override for readout section generation.
  // eslint-disable-next-line no-var
  var __buildReadoutSectionOverride: string | null | undefined;
}

function parseJsonObject(text: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
    return null;
  } catch {
    return null;
  }
}

const DEFAULT_SECTION_CONTRACT = [
  "<<No Section number>> : Strategic Framing Header",
  "Section 1: Exec Summary",
  "Section 2: Solution Areas",
  "Section 3: Recommendations for Progression",
  "Section 4: PURE Feature Mapping Table",
  "Section 5: Immediate Actions (Tactics)",
  "Section 6: Other Benefits Available to You from PURE STORAGE",
  "Section 7: Final Thoughts",
  "Use ReadinessLevel naming and preserve order with no omissions.",
].join("\n");

const DEFAULT_SECTION_KEYS = [
  "framing_header",
  "section_1_exec_summary",
  "section_2_solution_areas",
  "section_3_recommendations",
  "section_4_feature_mapping",
  "section_5_immediate_actions",
  "section_6_other_benefits",
  "section_7_final_thoughts",
];

function getSectionContract(): string {
  try {
    const config = requireGraphMessagingConfig();
    return config.readout?.sectionContract || DEFAULT_SECTION_CONTRACT;
  } catch {
    return DEFAULT_SECTION_CONTRACT;
  }
}

function getSectionKeys(): string[] {
  try {
    const config = requireGraphMessagingConfig();
    const keys = config.readout?.sectionKeys;
    return keys?.length ? keys : DEFAULT_SECTION_KEYS;
  } catch {
    return DEFAULT_SECTION_KEYS;
  }
}

function buildFallbackAnalysis(state: CfsState, pillars: string[]): Record<string, unknown> {
  return buildFallbackFromSchema(state, pillars);
}

export async function nodeBuildReadout(state: CfsState): Promise<Partial<CfsState>> {
  const config = requireGraphMessagingConfig();
  const scopedPillarEntries = normalizeUseCasePillarEntries(state.use_case_context.pillars ?? []);
  const scopedPillars = scopedPillarEntries.map((entry) => entry.name);
  if (!scopedPillars.length) {
    return {
      ...pushAI(state, configString("step4.noPillars", "I could not build the strategic readout because no pillars were available.")),
      readout_context: {
        ...state.readout_context,
        status: "error",
        generated_at: Date.now(),
      },
    };
  }

  const retrieval = await retrieveReadoutDocuments(
    mergeStatePatch(state, { use_case_context: { ...state.use_case_context, pillars: scopedPillarEntries } })
  );
  const allowedEvidenceByDocType = Object.fromEntries(
    READOUT_DOCUMENT_TYPES.map((docType) => [docType, retrieval.snippetsByType[docType] ?? []])
  );
  const model = process.env.OPENAI_API_KEY ? getModel("readout") : null;

  const readinessByPillar: Record<string, Record<string, string>> = {};
  for (const pillarName of scopedPillars) {
    const pillarEvidence = READOUT_DOCUMENT_TYPES.flatMap((docType) => retrieval.snippetsByType[docType] ?? []).join("\n");
    const currentPrompt = buildReadinessAssessmentPrompt("current", pillarName, pillarEvidence, {
      persona: state.user_context.persona_clarified_role ?? state.user_context.persona_role,
      industry: state.user_context.industry,
      goal: state.user_context.goal_statement ?? state.user_context.outcome,
      timeframe: state.user_context.timeframe,
    });
    const targetPrompt = buildReadinessAssessmentPrompt("target", pillarName, pillarEvidence, {
      persona: state.user_context.persona_clarified_role ?? state.user_context.persona_role,
      industry: state.user_context.industry,
      goal: state.user_context.goal_statement ?? state.user_context.outcome,
      timeframe: state.user_context.timeframe,
    });
    let currentJson: Record<string, any> = {};
    let targetJson: Record<string, any> = {};
    if (model) {
      const currentRaw = await invokeChatModelWithFallback(model, currentPrompt.system, currentPrompt.user, {
        runName: "readinessCurrentAssessment",
        fallback: "{}",
      });
      currentJson = parseJsonObject(currentRaw) ?? {};
      const targetRaw = await invokeChatModelWithFallback(model, targetPrompt.system, targetPrompt.user, {
        runName: "readinessTargetAssessment",
        fallback: "{}",
      });
      targetJson = parseJsonObject(targetRaw) ?? {};
    }
    readinessByPillar[pillarName] = {
      current_readiness_level: currentJson.current_readiness_level ?? "ReadinessLevel2",
      current_readiness_level_reasoning:
        currentJson.current_readiness_level_reasoning ?? "Not provided in today's conversation",
      target_readiness_level: targetJson.target_readiness_level ?? "ReadinessLevel3",
      target_readiness_level_reasoning:
        targetJson.target_readiness_level_reasoning ?? "Not provided in today's conversation",
    };
  }

  let analysisJson = buildFallbackAnalysis(state, scopedPillars);
  if (model) {
    const analysisPayload = buildReadoutAnalysisPrompt(state, { allowedEvidenceByDocType });
    const mergedPayload = JSON.stringify(
      { ...(parseJsonObject(analysisPayload.user) ?? {}), readiness_by_pillar: readinessByPillar },
      null,
      2
    );
    const analysisRaw = await invokeChatModelWithFallback(model, config.aiPrompts.buildReadoutAnalysis ?? "", mergedPayload, {
      runName: "buildReadoutAnalysis",
      fallback: "{}",
    });
    analysisJson = parseJsonObject(analysisRaw) ?? analysisJson;
  }

  const sectionKeys = getSectionKeys();
  const sectionContract = getSectionContract();

  const builderResult = await multiSectionDocBuilder.run(state, {
    model,
    sectionKeys,
    context: { analysisJson, state, allowedEvidenceByDocType, sectionContract, config },
    buildSectionParams: (sectionKey, ctx) => {
      if (globalThis.__buildReadoutSectionOverride) {
        return {
          sectionKey,
          systemPrompt: "",
          userPayload: "",
          fallback: globalThis.__buildReadoutSectionOverride,
        };
      }
      const payload = buildReadoutSectionPrompt(sectionKey, ctx.analysisJson as Record<string, unknown>, ctx.state as CfsState, {
        allowedEvidenceByDocType: ctx.allowedEvidenceByDocType as Record<string, string[]>,
        sectionContract: ctx.sectionContract as string,
      });
      return {
        sectionKey,
        systemPrompt: (ctx.config as any).aiPrompts.buildReadoutSection ?? "",
        userPayload: payload.user,
        fallback: `## ${sectionKey}\nNot provided in today's conversation`,
      };
    },
    qaCheck: async (fullDraft, ctx) => {
      const qaPayload = buildReadoutQaPrompt(fullDraft, ctx.analysisJson as Record<string, unknown>, {
        requiredTemplate: getSectionContract(),
        execSummaryDirectives: "Section 1 directives must be present.",
        formattingRules: "Follow required formatting and ordering rules.",
        emojiRules: "Use one emoji for pillar headers and one for sub-sub headers.",
        styleRoleVoiceRules: "Coach_Affirmative role perspective is required.",
      });
      const qaRaw = await invokeChatModelWithFallback(model!, (ctx.config as any).aiPrompts.readoutQaChecklist ?? "", qaPayload.user, {
        runName: "readoutStructuralQa",
        fallback: "{}",
      });
      const qaJson = parseJsonObject(qaRaw);
      if (qaJson && qaJson.pass === false && Array.isArray(qaJson.section_results)) {
        const repairs = qaJson.section_results
          .filter((r: any) => r && r.pass === false && r.section_key && r.repair_instruction)
          .map((r: any) => ({ sectionKey: String(r.section_key), repairInstruction: String(r.repair_instruction) }));
        return { pass: false, repairs };
      }
      return { pass: true };
    },
    repairSection: async (sectionKey, original, instruction, ctx) => {
      const repairPayload = JSON.stringify({
        section_key: sectionKey,
        original_section: original,
        repair_instruction: instruction,
        section_contract: ctx.sectionContract,
        analysis_json: ctx.analysisJson,
      }, null, 2);
      return invokeChatModelWithFallback(model!, (ctx.config as any).aiPrompts.buildReadoutSectionRepair ?? "", repairPayload, {
        runName: `readoutRepair:${sectionKey}`,
        fallback: original,
      });
    },
    outputBuilder: (sectionOutputs, fullDraft) => {
      return { _sectionOutputs: sectionOutputs, _fullDraft: fullDraft } as any;
    },
  });

  let sectionOutputs: Record<string, string> = (builderResult as any)._sectionOutputs ?? {};
  let fullDraft: string = (builderResult as any)._fullDraft ?? sectionKeys.map((k) => sectionOutputs[k] ?? "").join("\n\n");

  if (model) {
    const styleResult = await docStyleQa.run(state, {
      model,
      fullDraft,
      sectionOutputs,
      sectionKeys,
      buildStylePrompt: (draft) => {
        const payload = buildReadoutStyleQaPrompt(draft, {
          rolePerspective: config.readoutRolePerspective ?? "Coach_Affirmative",
          voiceCharacteristics: config.readoutVoiceCharacteristics ?? "Energetic and optimistic; celebrates progress.",
          behavioralIntent: config.readoutBehavioralIntent ?? "Close sessions on a motivational note.",
        });
        return { system: config.aiPrompts.readoutStyleQa ?? "", user: payload.user };
      },
      buildRepairPrompt: (sk, original, instruction) => ({
        system: config.aiPrompts.buildReadoutSectionRepair ?? "",
        user: JSON.stringify({
          section_key: sk,
          original_section: original,
          repair_instruction: instruction,
          section_contract: sectionContract,
          analysis_json: analysisJson,
        }, null, 2),
      }),
    });
    if ((styleResult as any)._sectionOutputs) sectionOutputs = (styleResult as any)._sectionOutputs;
    if ((styleResult as any)._fullDraft) fullDraft = (styleResult as any)._fullDraft;
  }

  const canonicalSections = sectionKeys.map((sectionKey) => ({
    id: sectionKey,
    title: sectionKey,
    markdown: sectionOutputs[sectionKey],
  }));
  const canonicalDocument = buildCanonicalReadoutDocument({
    documentId: `${state.session_context.session_id}-readout`,
    metadata: {
      session_id: state.session_context.session_id,
      tenant_id: state.session_context.tenant_id,
      generated_at: Date.now(),
      persona: state.user_context.persona_clarified_role ?? state.user_context.persona_role,
      industry: state.user_context.industry,
      timeline: state.user_context.timeframe,
    },
    sections: canonicalSections,
    tables: [],
    citations: [],
    evidenceRefs: scopedPillars,
  });
  const markdown = canonicalSections.map((section) => section.markdown).join("\n\n");

  const runtimeTargets =
    ((state as any).session_context?.archive?.readout_output_targets as Array<"download" | "email" | "database"> | undefined) ?? [];
  const tenantTargets =
    (state.session_context.tenant_id && config.outputTargetOverridesByTenant?.[state.session_context.tenant_id]) || [];
  const configuredTargets = runtimeTargets.length
    ? runtimeTargets
    : tenantTargets.length
    ? tenantTargets
    : (config.defaultReadoutOutputTargets ?? ["download"]);
  const selectedTargets = config.allowMultiTargetDelivery ?? true ? configuredTargets : configuredTargets.slice(0, 1);
  const delivery = {
    targets_requested: selectedTargets,
    download: {
      status: selectedTargets.includes("download") ? "ready" : "skipped",
      url: selectedTargets.includes("download") ? `/readout/${state.session_context.session_id}.md` : null,
    },
    email: { status: selectedTargets.includes("email") ? "ready" : "skipped", message_id: null },
    database: { status: selectedTargets.includes("database") ? "ready" : "skipped", record_id: null },
  };

  return {
    readout_context: {
      ...state.readout_context,
      status: "ready",
      generated_at: Date.now(),
      retrieval_filters: retrieval.filtersByType,
      documents_by_type: retrieval.documentsByType,
      analysis_json: analysisJson,
      qa_checks: { structural: true, style: true },
      canonical: canonicalDocument,
      rendered_outputs: {
        markdown,
        html: null,
        text: null,
      },
      delivery,
    },
    ...patchSessionContext(state, { step: "STEP5_READOUT_SUMMARY_NEXT_STEPS" }),
  };
}

/**
 * Step 5: Display the readout document and download option.
 * Runs after nodeBuildReadout; pushes the readout content to messages.
 */
export function nodeDisplayReadout(state: CfsState): Partial<CfsState> {
  const rc = state.readout_context;
  if (!rc || rc.status !== "ready") {
    return {};
  }
  const markdown = rc.rendered_outputs?.markdown ?? "";
  const downloadUrl = rc.delivery?.download?.url ?? `/readout/${state.session_context.session_id}.md`;
  const message = markdown
    ? `${markdown}\n\n---\nDownload: ${downloadUrl}`
    : `Your strategic readout is ready. Download: ${downloadUrl}`;
  return pushAI(state, message);
}
