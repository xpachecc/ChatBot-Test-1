import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { CfsState } from "../../state.js";
import { requireGraphMessagingConfig } from "../config/messaging.js";
import { getSanitizerModel, traceRiskAssessmentRun } from "../services/ai/models.js";

declare global {
  var __assessRiskOverride:
    | { risk_detected: boolean; risk_statement?: string | null; risk_domain?: string | null }
    | null
    | undefined;
}

export type RiskAssessmentResult = {
  risk_detected: boolean;
  risk_statement: string | null;
  risk_domain: "compliance" | "security" | "financial" | "operational" | null;
};

export async function assessAnswerRiskFromState(
  state: CfsState,
  question: string,
  answer: string
): Promise<RiskAssessmentResult> {
  return assessRiskWithAI({
    question,
    answer,
    industry: state.user_context.industry,
    role: state.user_context.persona_clarified_role ?? state.user_context.persona_role,
    goal: state.user_context.goal_statement ?? state.use_case_context.objective_normalized,
    timeframe: state.user_context.timeframe,
    use_cases_prioritized: state.use_case_context.use_cases_prioritized,
  });
}

export async function assessRiskWithAI(params: {
  question: string;
  answer: string;
  industry?: string | null;
  role?: string | null;
  goal?: string | null;
  timeframe?: string | null;
  use_cases_prioritized?: Array<{ name?: string | null }> | null;
}): Promise<RiskAssessmentResult> {
  const fallback: RiskAssessmentResult = { risk_detected: false, risk_statement: null, risk_domain: null };
  if (globalThis.__assessRiskOverride !== undefined) {
    const override = globalThis.__assessRiskOverride;
    if (!override) return fallback;
    const risk_statement = typeof override.risk_statement === "string" ? override.risk_statement : null;
    const risk_domain = typeof override.risk_domain === "string" ? (override.risk_domain as RiskAssessmentResult["risk_domain"]) : null;
    return {
      risk_detected: Boolean(override.risk_detected),
      risk_statement,
      risk_domain,
    };
  }
  if (!process.env.OPENAI_API_KEY) return fallback;
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.assessRisk;
  const useCases = (params.use_cases_prioritized ?? [])
    .map((item) => (item && typeof item.name === "string" ? item.name.trim() : ""))
    .filter(Boolean);
  const user = [
    `question: ${params.question}`,
    `answer: ${params.answer}`,
    `industry: ${params.industry ?? ""}`,
    `role: ${params.role ?? ""}`,
    `goal: ${params.goal ?? ""}`,
    `timeframe: ${params.timeframe ?? ""}`,
    `use_cases_prioritized: ${useCases.join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const resp = await traceRiskAssessmentRun(
      {
        question_length: params.question.length,
        answer_length: params.answer.length,
        industry: params.industry ?? null,
        role: params.role ?? null,
        goal: params.goal ?? null,
        timeframe: params.timeframe ?? null,
        use_case_count: useCases.length,
      },
      () => model.invoke([new SystemMessage(system), new HumanMessage(user)], { runName: "assessRisk" })
    );
    const raw = (resp.content as string | undefined)?.trim() ?? "";
    const parsed = JSON.parse(raw);
    const risk_detected = parsed?.risk_detected === true;
    const statementRaw = typeof parsed?.risk_statement === "string" ? parsed.risk_statement.trim() : "";
    const domainRaw = typeof parsed?.risk_domain === "string" ? parsed.risk_domain.trim().toLowerCase() : "";
    const allowed = new Set<RiskAssessmentResult["risk_domain"]>(["compliance", "security", "financial", "operational"]);
    const risk_domain = allowed.has(domainRaw as RiskAssessmentResult["risk_domain"])
      ? (domainRaw as RiskAssessmentResult["risk_domain"])
      : null;
    const risk_statement = statementRaw ? statementRaw.replace(/\s+/g, " ").trim() : null;
    if (!risk_detected || !risk_statement || !risk_domain) return fallback;
    const truncated = risk_statement.split(/\s+/).slice(0, 20).join(" ");
    return {
      risk_detected: true,
      risk_statement: truncated,
      risk_domain,
    };
  } catch {
    return fallback;
  }
}
