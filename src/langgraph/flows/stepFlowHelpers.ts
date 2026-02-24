import type { CfsState } from "../state.js";
import { SpanSanitizer, TimeframeSanitizer, opsExamplesForGoal, truncateTextToWordLimit, configString, interpolate } from "../utilities.js";
import { STEP2_QUESTIONS } from "./stepFlowConfig.js";
import { requireGraphMessagingConfig } from "../utilities.js";

// ── Re-exports from utilities.ts (backward compatibility) ───────────
// These functions were moved to utilities.ts for reuse by future graphs.
// Renamed functions also have old-name aliases.
export {
  normalizeOptionalString,
  normalizeOptionalString as normalizeWeaveValue,
  normalizePillarValues,
  buildCaseInsensitiveLookupMap,
  buildCaseInsensitiveLookupMap as buildAllowedPillarMap,
  normalizeUseCasePillarEntries,
  parsePillarsFromAi,
  sanitizeDiscoveryAnswer,
  parseCompositeQuestions,
  normalizeDiscoveryQuestions,
  mergeDiscoveryQuestions,
  truncateTextToWordLimit,
  truncateTextToWordLimit as buildGoalSummary,
  isAffirmativeAnswer,
  extractStringValuesFromMixedArray,
  extractStringValuesFromMixedArray as extractRiskPhrases,
  sanitizeNumericSelectionInput,
  sanitizeNumericSelectionInput as sanitizeSelectionInput,
  parseNumericSelectionIndices,
  parseNumericSelectionIndices as parseSelectionIndices,
} from "../utilities.js";
export type { DiscoveryQuestionItem, PillarEntry } from "../utilities.js";

// ── Step 2 question builders ────────────────────────────────────────

export function buildStep2Q1(state: CfsState): string {
  const base = STEP2_QUESTIONS[0];
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const goal = SpanSanitizer(state.user_context.goal_statement ?? state.use_case_context.objective_normalized, "this standardization goal");
  const examples = opsExamplesForGoal(state.user_context.goal_statement ?? state.use_case_context.objective_normalized, state.user_context.industry).join(", ");
  return base.question.replace("{{name}}", name).replace("{{examples}}", examples).replace("this goal", goal);
}

export function buildStep2Q1Confirmation(state: CfsState, answer: string): string {
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const focus = SpanSanitizer(answer, "your focus areas");
  const industry = SpanSanitizer(state.user_context.industry, "your industry");
  const vectorCue = state.vector_context.snippets?.[0] ? ` Related context: ${state.vector_context.snippets[0]}.` : "";
  return `Understood, ${name} — ${focus} in ${industry} gives us a clear direction.${vectorCue}`;
}

export function buildStep2Q2Confirmation(state: CfsState, answer: string): string {
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const obstacle = SpanSanitizer(answer, "those obstacles");
  const goal = SpanSanitizer(state.user_context.goal_statement ?? state.use_case_context.objective_normalized, "your goal");
  const vectorCue = state.vector_context.snippets?.[0] ? ` Related context: ${state.vector_context.snippets[0]}.` : "";
  return `That makes perfect sense, ${name} — ${obstacle} can slow progress toward ${goal}.${vectorCue}`;
}

// ── Discovery question helpers ──────────────────────────────────────

export function buildDiscoveryQuestionPrompt(question: string, index: number, total: number): string {
  const header = `Question ${index + 1} of ${total}:`;
  return [header, question].filter(Boolean).join("\n");
}

// ── Pillar helpers ──────────────────────────────────────────────────

export function buildPillarsSelectionPrompt(params: { outcome?: string | null; selectedUseCases: string[]; allowedPillars: string[] }) {
  const system = requireGraphMessagingConfig().aiPrompts.selectPillars;
  const outcomeLine = params.outcome ? `outcome: ${params.outcome}` : "";
  const useCaseLine = params.selectedUseCases.length ? `selected_use_cases: ${params.selectedUseCases.join(" | ")}` : "selected_use_cases: none";
  const allowedLine = `allowed_pillars: ${params.allowedPillars.join(" | ")}`;
  const user = [outcomeLine, useCaseLine, allowedLine].filter(Boolean).join("\n");
  return { system, user };
}

// ── Use case question prompt builder ────────────────────────────────

const DEFAULT_USE_CASE_QUESTIONS_PROMPT = [
  "System Role: You are a Senior SAAS Systems Engineer and Strategic Coach. Your tone is curious, insightful, and professionally neutral. You excel at identifying the architectural and operational friction points within a business's goals.",
  "", "Task: Analyze the provided user context and the library of 30 standard questions. Your objective is to synthesize these into three (3) high-impact, mutually exclusive composite questions. You must first select three DISTINCT domains from the Synthesis Logic list below and generate one question for each selected domain.",
  "", "Output Requirements:", "",
  "Domain Diversity: Each of the 3 questions must address a completely different domain (e.g., one for Technology, one for Governance, one for Process). No two questions may share the same conceptual space or semantic meaning.",
  "Insightful: Dig deeper than surface-level metrics; target the 'why' and the 'how' of the system's success. Avoid generic business jargon.",
  "Concise: Each question must be a single, punchy sentence. No multi-part questions or 'and' clauses that combine two distinct thoughts.",
  "Targeted: If the user mentions a specific technical or business bottleneck, the question must address that intersection directly.",
  "Personalization: Weave in role, industry, and timeframe only if they have real values. Use each provided value exactly once across the total set of 3 questions. Do not repeat a value and do not use them as 'tags' at the end—integrate them naturally into the sentence structure.",
  "Linguistic Variety: Use different sentence openers for each question. Avoid repeating the same grammatical structure (e.g., do not start every question with 'How...').",
  "Second Person: Every question must be written in second person. Do not use I, we, or us.",
  "Format: Provide only the 3 questions in a numbered list. No introductory or concluding filler text.",
  "", "Synthesis Logic (Select 3 unique domains for your response):",
  "- Domain: Architecture & Alignment. Focus on the gap between the current Problem and the desired Goal.",
  "- Domain: Risk & Constraint. Focus on the friction points identified in the Vector Context.",
  "- Domain: Scalability & Future-Proofing. Focus on the long-term implications of achieving the Goal Statement.",
  "- Domain: Governance & Compliance. Focus on the decision-making authority and the regulatory guardrails required to oversee the Goal.",
  "- Domain: Process & Efficiency. Focus on the repeatability of the workflow and the specific hand-offs where friction currently exists.",
  "- Domain: Technology & Integration. Focus on the interoperability between the current technical stack and the new tools required to bridge the Problem gap.",
  "- Domain: Organization & Capability. Focus on the human capital requirements and the cultural readiness needed to support the long-term Goal Statement.",
].join("\n");

const DEFAULT_USE_CASE_SELECTION_PROMPT = [
  "System Role: You are a Senior SAAS Systems Engineer. Your approach is that of a technical coach: curious about potential, insightful regarding system efficiencies, and neutral in your evaluation. You specialize in aligning technical use cases with specific user personas and high-level goals.",
  "", "Task: Evaluate the provided use_case_text against the user's Persona Group and Goal Statement. Your objective is to select the top 4 use case options that offer the highest relevance and strategic value. You will then score each on a scale of 1–100.",
  "", "Scoring Criteria: Evaluate each selected use case based on:",
  "- Persona Alignment: How directly does this solve a pain point for the Persona Group?",
  "- Goal Velocity: How much does this use case accelerate the achievement of the Goal Statement?",
  "- Feasibility & Context: Based on the Vector Context, how well does this integrate with the existing environment?",
  "", "Output Format: Return a JSON array of the top 4 objects, each containing:",
  "- rank (1-4), force rank them", "- use_case_name (the original name)", "- relevance_score (1-100)",
  "- engineering_insight (1 sentence, less than 15 words, try not to restate state keys values, neutral explanation), expert driven concise reason that is not too wordy",
  "", "Constraints:",
  "- Be objective. If a use case is popular but doesn't serve the specific Goal Statement, do not select it.",
  "- Avoid marketing language; stay focused on technical and functional utility.",
  "- Use the context from the vector context retrieval to help create the engineering_insight so that the reasons are relevant to the user's goal",
  "- Return only JSON.",
].join("\n");

export function buildUseCaseQuestionsPrompt(params: {
  problemStatement: string;
  goalStatement: string;
  vectorContext: string;
  questionBank: string[];
  role?: string | null;
  industry?: string | null;
  timeframe?: string | null;
}): { system: string; user: string } {
  let system = DEFAULT_USE_CASE_QUESTIONS_PROMPT;
  try {
    const config = requireGraphMessagingConfig();
    system = config.aiPrompts.determineUseCaseQuestions ?? system;
  } catch { /* config not set — use hardcoded fallback */ }
  const user = [
    "Input Data:",
    "",
    `User Problem Statement: ${params.problemStatement}`,
    "",
    `User Goal Statement: ${params.goalStatement}`,
    "",
    `Vector/Relevant Context: ${params.vectorContext}`,
    "",
    `Role: ${params.role ?? ""}`,
    `Industry: ${params.industry ?? ""}`,
    `Timeframe: ${params.timeframe ?? ""}`,
    "",
    `Standard Question Bank: ${params.questionBank.join("\n")}`,
  ].join("\n");
  return { system, user };
}

// ── Use case selection helpers ───────────────────────────────────────

export type UseCaseSelection = {
  rank?: number;
  use_case_name: string;
  relevance_score: number;
  engineering_insight: string;
};

export function buildUseCaseSelectionPrompt(params: {
  personaGroup: string | null;
  goalStatement: string | null;
  useCaseText: string[];
  vectorContext: string;
}): { system: string; user: string } {
  let system = DEFAULT_USE_CASE_SELECTION_PROMPT;
  try {
    const config = requireGraphMessagingConfig();
    system = config.aiPrompts.determineUseCaseSelection ?? system;
  } catch { /* config not set — use hardcoded fallback */ }
  const user = [
    "Input Data:",
    "",
    `Persona Group: ${params.personaGroup ?? ""}`,
    "",
    `User Case Group (Goal Statement): ${params.goalStatement ?? ""}`,
    "",
    `Use Case Options (List): ${params.useCaseText.join("\n")}`,
    "",
    `Vector/Relevant Context: ${params.vectorContext}`,
  ].join("\n");
  return { system, user };
}

export function parseUseCaseSelections(raw: string): UseCaseSelection[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        const use_case_name = typeof obj.use_case_name === "string" ? obj.use_case_name.trim() : "";
        const relevance_score = typeof obj.relevance_score === "number" ? obj.relevance_score : Number(obj.relevance_score);
        const engineering_insight = typeof obj.engineering_insight === "string" ? obj.engineering_insight.trim() : "";
        const rank = typeof obj.rank === "number" ? obj.rank : Number(obj.rank);
        if (!use_case_name || !engineering_insight || !Number.isFinite(relevance_score)) return null;
        return { use_case_name, relevance_score, engineering_insight, rank: Number.isFinite(rank) ? rank : undefined };
      })
      .filter((item) => item !== null);
    return cleaned as UseCaseSelection[];
  } catch {
    return [];
  }
}

export function buildUseCaseSelectionMessage(params: {
  goalStatement: string;
  selections: Array<{ name: string; engineering_insight?: string | null }>;
}): string {
  const useCaseGroup = params.goalStatement || "your focus area";
  const header = interpolate(configString("step2.useCaseSelection.header", "Within {{useCaseGroup}}, and considering all you have shared, I'm listing the potential use cases that can apply, along with why I've chosen them. It's in order of what I believe is highest to lowest probability."), { useCaseGroup });
  const guidance = configString("step2.useCaseSelection.guidance", "Please review and let me know which one really jumps out at you, and that's where we will center on for our final discovery step.");
  const noInsight = configString("step2.useCaseSelection.noInsight", "No insight provided.");
  const itemFormat = configString("step2.useCaseSelection.itemFormat", "{{index}}. **{{name}}**\n{{insight}}");
  const list = params.selections
    .map((item, idx) => interpolate(itemFormat, {
      index: String(idx + 1),
      name: item.name,
      insight: item.engineering_insight?.trim() || noInsight,
    }))
    .join("\n\n");
  const prompt = configString("step2.useCaseSelection.prompt", "Enter the number of the use case(s) that are relevant to you");
  return [header, "", guidance, "", list, "", prompt].filter(Boolean).join("\n");
}

// ── KYC echo helpers ─────────────────────────────────────────────────

export function buildKnowYourCustomerEchoFallback(params: {
  name: string;
  role: string;
  industry: string;
  timeframe: string;
  goal: string;
  outcome: string;
  vectorSnippet?: string;
}): string {
  const summary = truncateTextToWordLimit(params.goal);
  const nameLine = params.name
    ? interpolate(configString("step1.kycEchoFallback.nameLineWithName", "Are we interpreting your priorities correctly, {{name}}?"), { name: params.name })
    : configString("step1.kycEchoFallback.nameLineNoName", "Are we interpreting your priorities correctly?");
  const vectorLine = params.vectorSnippet
    ? interpolate(configString("step1.kycEchoFallback.vectorLine", "\nRelated insight: {{vectorSnippet}}"), { vectorSnippet: params.vectorSnippet })
    : "";
  const intro = configString("step1.kycEchoFallback.intro", "I really appreciate the context. I can now tailor my recommendations to specifically make you successful!");
  const theme = interpolate(configString("step1.kycEchoFallback.theme", "As a {{role}} in {{industry}}, with a {{timeframe}} goal to {{summary}}, your initiative most strongly aligns with the strategic theme:"), {
    role: params.role,
    industry: params.industry,
    timeframe: params.timeframe,
    summary,
  });
  const outcome = interpolate(configString("step1.kycEchoFallback.outcome", "{{outcome}} — framed for {{industry}} teams pursuing {{summary}}."), {
    outcome: params.outcome,
    industry: params.industry,
    summary,
  }) + vectorLine;
  const bullets = configString("step1.kycEchoFallback.bullets", "This is typically the focus when:\n- Organizations need to support evolving AI/ML capabilities without infra constraints\n- Speed of iteration and environment responsiveness directly impact competitive advantage");
  return [intro, "", theme, "", outcome, "", bullets, "", nameLine].join("\n");
}

// ── Role assessment helpers ──────────────────────────────────────────

export function buildRoleAssessmentMessage(roleName: string | null, personaGroup: string | null, examples: string[]): string {
  const role = roleName ?? "your role";
  const group = personaGroup ?? "your persona group";
  const exampleText = examples.length ? examples.join(", ") : "your current goals";
  return interpolate(configString("step1.roleAssessment", "Thanks, it sounds like you are the {{role}} in the {{group}}. That is often challenging given {{exampleText}}. Please correct anything that is off so your ROI from this conversation is maximized."), { role, group, exampleText });
}

// Build a focused readiness prompt for one pillar and one assessment mode.
export function buildReadinessAssessmentPrompt(
  mode: "current" | "target",
  pillarName: string,
  evidence: string,
  userContext: {
    persona?: string | null;
    industry?: string | null;
    goal?: string | null;
    timeframe?: string | null;
  }
): { system: string; user: string } {
  const stageLabel = mode === "current" ? "current_readiness_level" : "target_readiness_level";
  const system = [
    "You are a deterministic readiness assessor.",
    `Infer ${stageLabel} for the specified pillar from evidence.`,
    "Use only these labels: ReadinessLevel1, ReadinessLevel2, ReadinessLevel3, ReadinessLevel4, ReadinessLevel5.",
    "Return JSON only with keys:",
    `{ "${stageLabel}": "...", "${stageLabel}_reasoning": "..." }`,
  ].join("\n");
  const user = [
    `pillar_name: ${pillarName}`,
    `persona: ${userContext.persona ?? "Not provided in today's conversation"}`,
    `industry: ${userContext.industry ?? "Not provided in today's conversation"}`,
    `goal: ${userContext.goal ?? "Not provided in today's conversation"}`,
    `timeframe: ${userContext.timeframe ?? "Not provided in today's conversation"}`,
    `evidence: ${evidence || "Not provided in today's conversation"}`,
  ].join("\n");
  return { system, user };
}

// Build the Stage 1 analysis prompt payload for full readout planning.
export function buildReadoutAnalysisPrompt(state: CfsState, readoutContext: { allowedEvidenceByDocType: Record<string, string[]> }) {
  const pillars = state.use_case_context.pillars ?? [];
  const discovery = (state.use_case_context.discovery_questions ?? []).map((item) => ({
    question: item.question,
    response: item.response,
    risk: item.risk,
  }));
  const user = JSON.stringify(
    {
      user_context: {
        first_name: state.user_context.first_name,
        persona_role: state.user_context.persona_role,
        persona_clarified_role: state.user_context.persona_clarified_role,
        persona_group: state.user_context.persona_group,
        industry: state.user_context.industry,
        goal_statement: state.user_context.goal_statement,
        outcome: state.user_context.outcome,
        timeframe: state.user_context.timeframe,
      },
      use_case_context: {
        pillars,
        use_case_groups: state.use_case_context.use_case_groups ?? [],
        selected_use_cases: state.use_case_context.selected_use_cases ?? [],
        discovery_questions: discovery,
      },
      allowed_evidence_by_doc_type: readoutContext.allowedEvidenceByDocType,
    },
    null,
    2
  );
  return { user };
}

/** Build a section generation prompt payload for the Stage 2 writer.
 *
 * Includes `discovery_risk_context` so the section writer has direct access
 * to the risk language captured during discovery questions, independent of
 * what the Stage 1 analysis engine chose to surface in `risk_summary_points`.
 */
export function buildReadoutSectionPrompt(
  sectionKey: string,
  analysisJson: Record<string, unknown>,
  state: CfsState,
  readoutContext: { allowedEvidenceByDocType: Record<string, string[]>; sectionContract: string }
): { user: string } {
  const discoveryRisks = (state.use_case_context.discovery_questions ?? [])
    .filter((dq) => dq.risk)
    .map((dq) => ({ question: dq.question, risk: dq.risk, risk_domain: dq.risk_domain }));

  const payload = {
    section_key: sectionKey,
    section_contract: readoutContext.sectionContract,
    analysis_json: analysisJson,
    user_context: {
      first_name: state.user_context.first_name,
      persona_role: state.user_context.persona_role,
      industry: state.user_context.industry,
      goal_statement: state.user_context.goal_statement,
      timeframe: state.user_context.timeframe,
    },
    allowed_evidence_by_doc_type: readoutContext.allowedEvidenceByDocType,
    discovery_risk_context: discoveryRisks,
  };
  return { user: JSON.stringify(payload, null, 2) };
}

// Build a structural QA payload for full readout validation.
export function buildReadoutQaPrompt(
  draft: string,
  analysisJson: Record<string, unknown>,
  readoutContext: {
    requiredTemplate: string;
    execSummaryDirectives: string;
    formattingRules: string;
    emojiRules: string;
    styleRoleVoiceRules: string;
  }
): { user: string } {
  const payload = {
    full_draft_readout: draft,
    analysis_json: analysisJson,
    required_output_template_verbatim: readoutContext.requiredTemplate,
    exec_summary_directives_verbatim: readoutContext.execSummaryDirectives,
    formatting_rules: readoutContext.formattingRules,
    emoji_rules: readoutContext.emojiRules,
    style_role_voice_rules: readoutContext.styleRoleVoiceRules,
  };
  return { user: JSON.stringify(payload, null, 2) };
}

// Build a style QA payload for language quality and voice conformance.
export function buildReadoutStyleQaPrompt(
  fullDraft: string,
  styleProfile: { rolePerspective: string; voiceCharacteristics: string; behavioralIntent: string }
): { user: string } {
  const payload = {
    full_draft_readout: fullDraft,
    style_profile: styleProfile,
  };
  return { user: JSON.stringify(payload, null, 2) };
}

// Re-exported from utilities.ts for backward compatibility.
export { buildCanonicalReadoutDocument } from "../utilities.js";
export type { CanonicalReadoutSection, CanonicalReadoutDocument } from "../utilities.js";

