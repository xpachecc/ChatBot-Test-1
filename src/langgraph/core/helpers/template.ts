import type { CfsState } from "../../state.js";
import { requireGraphMessagingConfig } from "../config/messaging.js";
import { prependClarificationAcknowledgement as prependClarificationAcknowledgementText } from "../../acknowledgements.js";

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

export function configString(key: string, fallback: string): string {
  try {
    const config = requireGraphMessagingConfig();
    return config.strings?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

export function opsExamplesForGoal(goal: string | null | undefined, industry: string | null | undefined): string[] {
  const g = (goal ?? "").toLowerCase();
  const ind = (industry ?? "").toLowerCase();
  if (ind.includes("health")) return ["patient administration", "data management", "clinical systems"];
  if (g.includes("data") || g.includes("analytics") || g.includes("reporting")) return ["data ingestion", "data quality", "reporting workflows"];
  if (g.includes("process") || g.includes("workflow") || g.includes("standard")) return ["intake workflows", "handoff approvals", "release cadence"];
  return ["intake processes", "data management", "reporting cycles"];
}

export function prependClarificationAcknowledgement(text: string, options?: { random?: () => number }): string {
  const config = requireGraphMessagingConfig();
  return prependClarificationAcknowledgementText(text, config.clarificationAcknowledgement, options);
}

export type CanonicalReadoutSection = { id: string; title: string; markdown: string };
export type CanonicalReadoutDocument = {
  document_id: string;
  version: string;
  metadata: Record<string, unknown>;
  sections: CanonicalReadoutSection[];
  tables: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  evidence_refs: string[];
};

export function buildCanonicalReadoutDocument(params: {
  documentId: string;
  metadata: Record<string, unknown>;
  sections: CanonicalReadoutSection[];
  tables?: Array<Record<string, unknown>>;
  citations?: Array<Record<string, unknown>>;
  evidenceRefs?: string[];
}): CanonicalReadoutDocument {
  return {
    document_id: params.documentId,
    version: "1.0",
    metadata: params.metadata,
    sections: params.sections,
    tables: params.tables ?? [],
    citations: params.citations ?? [],
    evidence_refs: params.evidenceRefs ?? [],
  };
}

export function buildDeterministicScores(
  results: Array<{ content?: unknown; metadata?: unknown; similarity?: number }>,
  names: string[],
  opts?: { max?: number; fieldKey?: string }
): Array<{ name: string; score: number }> {
  const fieldKey = opts?.fieldKey ?? "use_case_text";
  const max = opts?.max ?? 4;
  const scoreMap = new Map<string, number>();
  for (const result of results) {
    const text =
      (typeof result.content === "object" && result.content ? (result.content as Record<string, unknown>)[fieldKey] : undefined) ??
      (typeof result.metadata === "object" && result.metadata ? (result.metadata as Record<string, unknown>)[fieldKey] : undefined);
    const name = typeof text === "string" ? text.trim() : "";
    if (!name) continue;
    const score = typeof result.similarity === "number" ? Math.round(result.similarity * 100) : 0;
    const prev = scoreMap.get(name) ?? 0;
    if (score > prev) scoreMap.set(name, score);
  }
  return names.slice(0, max).map((name, idx) => ({
    name,
    score: scoreMap.get(name) ?? Math.max(20, 100 - idx * 10),
  }));
}

export function buildFallbackFromSchema(
  state: CfsState,
  pillars: string[],
  defaultValue = "Not provided in today's conversation"
): Record<string, unknown> {
  const discoveryRisks = (state.use_case_context.discovery_questions ?? [])
    .filter((dq) => dq.risk)
    .map((dq) => dq.risk as string);
  const fallbackRiskPoints = discoveryRisks.length
    ? discoveryRisks
    : ["No risk signals identified in today's conversation"];
  return {
    analysis_version: "1.0",
    overall_posture: "Managed",
    highest_business_outcome: state.user_context.goal_statement ?? defaultValue,
    posture_rationale: defaultValue,
    selected_solution_areas: pillars.map((pillar) => ({
      pillar_name: pillar,
      current_readiness_level: "ReadinessLevel2",
      current_readiness_level_reasoning: defaultValue,
      current_readiness_level_verbatim_description: defaultValue,
      target_readiness_level: "ReadinessLevel3",
      target_readiness_level_reasoning: defaultValue,
      target_readiness_level_benefits: defaultValue,
      timeline_alignment: state.user_context.timeframe ?? defaultValue,
      risk_summary_points: fallbackRiskPoints,
      insights_summary: defaultValue,
      recommendations: [defaultValue],
      immediate_tactics: [{ action: defaultValue, why: defaultValue }],
      feature_mapping_candidates: [],
      evidence_refs: [],
    })),
    other_benefits: [],
    final_thoughts_inputs: {
      persona: state.user_context.persona_clarified_role ?? state.user_context.persona_role ?? defaultValue,
      industry: state.user_context.industry ?? defaultValue,
      goals: state.user_context.goal_statement ?? defaultValue,
      platforms: defaultValue,
      friction_points: defaultValue,
      timeline: state.user_context.timeframe ?? defaultValue,
      priority_pillar: pillars[0] ?? defaultValue,
      priority_use_case: state.use_case_context.selected_use_cases?.[0] ?? defaultValue,
      readiness_level_progression: defaultValue,
      strategic_posture_note: defaultValue,
      non_technical_focus_areas: ["process", "governance", "metrics"],
      better_together_note: defaultValue,
    },
  };
}
