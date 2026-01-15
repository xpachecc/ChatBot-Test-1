import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as z from "zod";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

export type OverlayName =
  | "SeniorSE_Curious"
  | "SeniorSE_Challenging"
  | "CTO_Consultative"
  | "Mentor_Supportive"
  | "Coach_Affirmative";

export type StepName = "STEP_1" | "STEP_2";

export type PrimitiveName =
  | "AskQuestion"
  | "ExplainWhy"
  | "CaptureObjective"
  | "ProbeRisk"
  | "EvaluateReadiness"
  | "SummarizeContext"
  | "ConfirmAssumption"
  | "GenerateRecommendation"
  | "AcknowledgeEmotion"
  | "RankAndSelect"
  | "ValidateGuardrail"
  | "CelebrateAchievement"
  | "ChallengeAssumption"
  | "MicroWin"
  | "RecallCue"
  | "MotivationalCue"
  | "BridgeCue"
  | "EndSession";

const PrimitiveLogSchema = z.object({
  primitive_name: z.string(),
  template_id: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  overlay_active: z.string().optional(),
  context_updates: z.array(z.string()).default([]),
  guardrail_status: z.enum(["pass", "fail"]).default("pass"),
  trust_score: z.number().min(0).max(1).default(0.5),
  sentiment_score: z.number().min(0).max(1).default(0.5),
  hash_verified: z.boolean().default(true),
});

const ContextWeaveIndexSchema = z.object({
  user_phrases: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
});

const UserContextSchema = z.object({
  first_name: z.string().nullable().default(null),
  persona_role: z.string().nullable().default(null),
  industry: z.string().nullable().default(null),
  goal_statement: z.string().nullable().default(null),
  timeframe: z.string().nullable().default(null),
});

const UseCaseContextSchema = z.object({
  objective_normalized: z.string().nullable().default(null),
});

const RelationshipContextSchema = z.object({
  trust_score: z.number().min(0).max(1).default(0.6),
  sentiment_score: z.number().min(0).max(1).default(0.7),
  engagement_level: z.number().min(0).max(1).default(0.7),
});

const SessionContextSchema = z.object({
  session_id: z.string(),
  step: z.enum(["STEP_1", "STEP_2"]).default("STEP_1"),
  step_question_index: z.number().int().min(0).default(0),
  step_clarifier_used: z.boolean().default(false),
  last_question_key: z.string().nullable().default(null),
  awaiting_user: z.boolean().default(false),
  started: z.boolean().default(false),
  primitive_counter: z.number().int().min(0).default(0),
  primitive_log: z.array(PrimitiveLogSchema).default([]),
  summary_log: z.array(z.string()).default([]),
  reason_trace: z.array(z.string()).default([]),
  guardrail_log: z.array(z.string()).default([]),
  transition_log: z.array(z.string()).default([]),
});

const EncyclopediaSchema = z.object({
  file_path: z.string().nullable().default(null),
  hash_algorithm: z.literal("SHA256").default("SHA256"),
  encyclopedia_hash: z.string().nullable().default(null),
  loaded: z.boolean().default(false),
});

export const CfsStateSchema = z.object({
  messages: z.array(z.custom<any>()).default([]),
  overlay_active: z
    .enum(["SeniorSE_Curious", "SeniorSE_Challenging", "CTO_Consultative", "Mentor_Supportive", "Coach_Affirmative"] as const)
    .default("SeniorSE_Curious"),
  context_weave_index: ContextWeaveIndexSchema.default({ user_phrases: [], entities: [] }),
  user_context: UserContextSchema.default({}),
  use_case_context: UseCaseContextSchema.default({}),
  relationship_context: RelationshipContextSchema.default({}),
  session_context: SessionContextSchema,
  encyclopedia: EncyclopediaSchema.default({}),
});

export type CfsState = z.infer<typeof CfsStateSchema>;

export function nowMs(): number {
  return Date.now();
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function lastHumanMessage(state: CfsState): HumanMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m instanceof HumanMessage) return m;
  }
  return null;
}

export function pushAI(state: CfsState, text: string): Partial<CfsState> {
  return { messages: [...(state.messages || []), new AIMessage(text)] };
}

export function pushSystem(state: CfsState, text: string): Partial<CfsState> {
  return { messages: [...(state.messages || []), new SystemMessage(text)] };
}

export function extractUserPhraseUpTo6Words(raw: string): string | null {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 6).join(" ");
}

export function contextTokensForQuestion(state: CfsState): string[] {
  const tokens: string[] = [];
  if (state.user_context.industry) tokens.push(state.user_context.industry);
  if (state.user_context.persona_role) tokens.push(state.user_context.persona_role);
  if (state.use_case_context.objective_normalized) tokens.push(state.use_case_context.objective_normalized);
  if (state.user_context.timeframe) tokens.push(state.user_context.timeframe);
  return tokens.filter(Boolean).slice(0, 2);
}

export function resolveDomainVectorsPath(): string | null {
  const candidates = [
    process.env.SS_DOMAIN_VECTORS_PATH,
    path.resolve(process.cwd(), "SundaySky - Domain Vectors v01_06_26.xlsx"),
    path.resolve(process.cwd(), "SundaySky - Domain Vectors v01_06_26"),
    path.resolve(process.cwd(), "data", "SundaySky - Domain Vectors v01_06_26.xlsx"),
    path.resolve(process.cwd(), "data", "SundaySky - Domain Vectors v01_06_26"),
    "/data/SundaySky - Domain Vectors v01_06_26.xlsx",
    "/data/SundaySky - Domain Vectors v01_06_26",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export function loadDomainVectorsForLedger(): { filePath: string; encyclopediaHash: string } | null {
  const filePath = resolveDomainVectorsPath();
  if (!filePath) return null;
  const bytes = fs.readFileSync(filePath);
  const encyclopediaHash = crypto.createHash("sha256").update(bytes).digest("hex");
  return { filePath, encyclopediaHash };
}

export function SpecificityCheck(answer: string): { specificity_pass: boolean; fields_missing: string[] } {
  const text = answer.trim();
  const lower = text.toLowerCase();
  const hasActor =
    /\b(i|we|our|team|teams|engineering|it|security|ops|operations|marketing|finance|legal|compliance|data)\b/i.test(text) ||
    /\b(vp|director|head|manager|lead|cio|cto|ciso|svp)\b/i.test(text);
  const hasSystem =
    /\b(system|platform|pipeline|workflow|process|workload|integration|api|data|lake|warehouse|crm|erp|billing|identity|access|analytics|reporting)\b/i.test(
      text
    );
  const hasTime =
    /\b(today|this quarter|this month|this year|q[1-4]|weekly|daily|monthly|by\b\s+\w+|\bwithin\b\s+\d+\s+(day|days|week|weeks|month|months|year|years))\b/i.test(
      lower
    ) || /\b\d{4}\b/.test(text);
  const missing: string[] = [];
  if (!hasActor) missing.push("actor/owner");
  if (!hasSystem) missing.push("system/workload/process");
  if (!hasTime) missing.push("timeframe/frequency");
  return { specificity_pass: missing.length === 0, fields_missing: missing };
}

export function ExampleGenerator(params: { industry?: string | null; role?: string | null; topic: "role" | "industry" | "goal" | "timeframe" }): string[] {
  const industry = params.industry ?? "your industry";
  switch (params.topic) {
    case "role":
      return [
        `Example: “I lead the team that owns our analytics workflow and reporting cadence.”`,
        `Example: “I’m accountable for the platform operations process and weekly release governance.”`,
      ];
    case "industry":
      return [
        `Example: “We’re in ${industry}, supporting regulated workflows and recurring reporting cycles.”`,
        `Example: “We operate in ${industry}, with multiple teams depending on shared data processes.”`,
      ];
    case "goal":
      return [
        `Example: “Reduce manual handoffs in the workflow so the process runs consistently every week.”`,
        `Example: “Improve data availability for reporting so leadership decisions aren’t delayed each month.”`,
      ];
    case "timeframe":
      return [
        `Example: “We need this operating reliably by end of this quarter, with weekly governance checks.”`,
        `Example: “Within 90 days, we need a repeatable process across teams, reviewed monthly.”`,
      ];
  }
}

export function HumanizationGuard(rendered: string): string {
  return rendered.replace(/\b(primitive|bridgecue|explainwhy|summarizecontext)\b/gi, "").replace(/^\s*[-–>*]{1,3}\s*/gm, "").trim();
}

export function GlobalDeterminismGuard(rendered: string): string {
  const lower = rendered.toLowerCase();
  const forbidden = ["would you like", "shall i", "can i", "should we", "want me to", "do you prefer"];
  if (!forbidden.some((p) => lower.includes(p))) return rendered;
  return rendered
    .replace(/would you like to/gi, "We will")
    .replace(/shall i/gi, "I will")
    .replace(/can i/gi, "I will")
    .replace(/should we/gi, "We will")
    .replace(/do you prefer/gi, "We will use");
}

export function ContextMerge(state: CfsState): Partial<CfsState> {
  const logs = state.session_context.primitive_log.slice(-5);
  const meanSent = logs.length ? logs.reduce((a, b) => a + b.sentiment_score, 0) / logs.length : state.relationship_context.sentiment_score;
  const prevTrust = state.relationship_context.trust_score;
  const trust = clamp01(0.8 * meanSent + 0.2 * prevTrust);
  return { relationship_context: { ...state.relationship_context, trust_score: trust } };
}

export function TelemetryCommit(state: CfsState): Partial<CfsState> {
  return { session_context: { ...state.session_context, guardrail_log: [...state.session_context.guardrail_log, `telemetry_commit:${state.session_context.primitive_counter}`] } };
}

export function TimeframeSanitizer(raw: string | null | undefined): string {
  if (!raw) return "this timeframe";
  let t = raw.trim();
  t = t.replace(/^for\s+/i, "");
  t = t.replace(/^in\s+/i, "");
  t = t.replace(/^a\s+/i, "");
  t = t.replace(/^an\s+/i, "");
  if (!/^(in|within|by|over|during|throughout)\b/i.test(t)) t = `in ${t}`;
  return t;
}

export function SpanSanitizer(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed.replace(/[.?!]+$/g, "") || fallback;
}

let sanitizerModel: ChatOpenAI | undefined;

const getSanitizerModel = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to run the LangGraph backend.");
  if (!sanitizerModel) {
    sanitizerModel = new ChatOpenAI({
      model: "gpt-3.5-turbo",
      temperature: 0,
      maxRetries: 1,
    });
  }
  return sanitizerModel;
};

export async function sanitizeUserInput(kind: "name" | "role" | "industry" | "goal" | "timeframe", text: string): Promise<string> {
  const model = getSanitizerModel();
  const system = `You sanitize user answers for a chatbot. Return only the cleaned value, no extra words or punctuation. 
Rules:
- name: return just the likely first name.
- role: return a concise title.
- industry: return the industry term only.
- goal: return a short goal phrase.
- timeframe: return a short timeframe phrase (e.g., "in 6 months", "within 90 days").
If the text is empty, return "unknown".`;
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(`kind=${kind}; text="${text}"`)], { runName: "sanitizeUserInput" });
  const cleaned = (resp.content as string | undefined)?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : text;
}

abstract class Primitive {
  abstract name: PrimitiveName;
  templateId?: string;

  protected logStart(state: CfsState): { t0: number } {
    return { t0: nowMs() };
  }

  protected logEnd(state: CfsState, t0: number, extra?: Partial<z.infer<typeof PrimitiveLogSchema>>): Partial<CfsState> {
    const t1 = nowMs();
    const entry = PrimitiveLogSchema.parse({
      primitive_name: this.name,
      template_id: this.templateId,
      start_time: t0,
      end_time: t1,
      overlay_active: state.overlay_active,
      trust_score: state.relationship_context.trust_score,
      sentiment_score: state.relationship_context.sentiment_score,
      hash_verified: true,
      guardrail_status: "pass",
      ...(extra ?? {}),
    });
    return {
      session_context: {
        ...state.session_context,
        primitive_counter: state.session_context.primitive_counter + 1,
        primitive_log: [...state.session_context.primitive_log, entry],
      },
    };
  }

  abstract run(state: CfsState, input?: any): Partial<CfsState>;
}

class AskQuestionPrimitive extends Primitive {
  name: PrimitiveName = "AskQuestion";
  templateId = "ask_question_v1";
  run(state: CfsState, input: { question: string; questionKey: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const q = input.question;
    const out: Partial<CfsState> = {
      ...pushAI(state, q),
      session_context: { ...state.session_context, last_question_key: input.questionKey, awaiting_user: true, step_clarifier_used: false },
    };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class ExplainWhyPrimitive extends Primitive {
  name: PrimitiveName = "ExplainWhy";
  templateId = "explain_why_v1";
  run(state: CfsState, input: { text: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const text = HumanizationGuard(GlobalDeterminismGuard(input.text));
    const out: Partial<CfsState> = {
      ...pushAI(state, text),
      session_context: { ...state.session_context, reason_trace: [...state.session_context.reason_trace, text] },
    };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class CaptureObjectivePrimitive extends Primitive {
  name: PrimitiveName = "CaptureObjective";
  templateId = "capture_objective_v1";
  run(state: CfsState, input: { rawGoal: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const normalized = input.rawGoal.trim().replace(/\s+/g, " ");
    const out: Partial<CfsState> = { use_case_context: { ...state.use_case_context, objective_normalized: normalized } };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class ProbeRiskPrimitive extends Primitive {
  name: PrimitiveName = "ProbeRisk";
  templateId = "probe_risk_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    return this.logEnd(state, t0);
  }
}

class EvaluateReadinessPrimitive extends Primitive {
  name: PrimitiveName = "EvaluateReadiness";
  templateId = "evaluate_readiness_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    return this.logEnd(state, t0);
  }
}

class SummarizeContextPrimitive extends Primitive {
  name: PrimitiveName = "SummarizeContext";
  templateId = "summarize_context_v1";
  run(state: CfsState, _input: { scope: "step1" | "step2" }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const parts: string[] = [];
    if (state.user_context.persona_role) parts.push(`Role: ${state.user_context.persona_role}`);
    if (state.user_context.industry) parts.push(`Industry: ${state.user_context.industry}`);
    if (state.use_case_context.objective_normalized) parts.push(`Goal: ${state.use_case_context.objective_normalized}`);
    if (state.user_context.timeframe) parts.push(`Timeframe: ${state.user_context.timeframe}`);
    const lastUser = lastHumanMessage(state)?.content?.toString() ?? "";
    const quote = extractUserPhraseUpTo6Words(lastUser);
    const summary = HumanizationGuard(
      GlobalDeterminismGuard(
        [
          parts.length ? `Got it. ${parts.join(". ")}.` : `Got it.`,
          quote ? `I’m keeping “${quote}” as a working anchor.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      )
    );
    const out: Partial<CfsState> = { ...pushAI(state, summary), session_context: { ...state.session_context, summary_log: [...state.session_context.summary_log, summary] } };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class ConfirmAssumptionPrimitive extends Primitive {
  name: PrimitiveName = "ConfirmAssumption";
  templateId = "confirm_assumption_v1";
  run(state: CfsState, input: { statement: string; questionKey: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const text = HumanizationGuard(GlobalDeterminismGuard(`${input.statement} Please confirm yes or no.`));
    const out: Partial<CfsState> = {
      ...pushAI(state, text),
      session_context: { ...state.session_context, last_question_key: input.questionKey, awaiting_user: true, step_clarifier_used: false },
    };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class GenerateRecommendationPrimitive extends Primitive {
  name: PrimitiveName = "GenerateRecommendation";
  templateId = "generate_recommendation_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    return this.logEnd(state, t0);
  }
}

class AcknowledgeEmotionPrimitive extends Primitive {
  name: PrimitiveName = "AcknowledgeEmotion";
  templateId = "acknowledge_emotion_v1";
  run(state: CfsState, input: { sentiment: "positive" | "neutral" | "concerned" }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const text =
      input.sentiment === "concerned"
        ? "Understood. That pressure is real. We’ll keep this tight and focused now."
        : input.sentiment === "positive"
        ? "Understood. That clarity helps us move faster."
        : "Understood.";
    const out = pushAI(state, text);
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class RankAndSelectPrimitive extends Primitive {
  name: PrimitiveName = "RankAndSelect";
  templateId = "rank_and_select_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    return this.logEnd(state, t0);
  }
}

class ValidateGuardrailPrimitive extends Primitive {
  name: PrimitiveName = "ValidateGuardrail";
  templateId = "validate_guardrail_v1";
  run(state: CfsState, input?: { require?: Array<"role" | "industry" | "goal" | "timeframe"> }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const require = input?.require ?? [];
    const missing: string[] = [];
    for (const r of require) {
      if (r === "role" && !state.user_context.persona_role) missing.push("role");
      if (r === "industry" && !state.user_context.industry) missing.push("industry");
      if (r === "goal" && !state.use_case_context.objective_normalized) missing.push("goal");
      if (r === "timeframe" && !state.user_context.timeframe) missing.push("timeframe");
    }
    const ok = missing.length === 0;
    const out: Partial<CfsState> = {
      session_context: {
        ...state.session_context,
        guardrail_log: [...state.session_context.guardrail_log, ok ? "guardrail:pass" : `guardrail:fail:${missing.join(",")}`],
      },
    };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0, { guardrail_status: ok ? "pass" : "fail" }) };
  }
}

class CelebrateAchievementPrimitive extends Primitive {
  name: PrimitiveName = "CelebrateAchievement";
  templateId = "celebrate_achievement_v1";
  run(state: CfsState, input: { text: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const out = pushAI(state, HumanizationGuard(GlobalDeterminismGuard(input.text)));
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class ChallengeAssumptionPrimitive extends Primitive {
  name: PrimitiveName = "ChallengeAssumption";
  templateId = "challenge_assumption_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    return this.logEnd(state, t0);
  }
}

class MicroWinPrimitive extends Primitive {
  name: PrimitiveName = "MicroWin";
  templateId = "microwin_v1";
  run(state: CfsState, input: { text: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const out = pushAI(state, HumanizationGuard(GlobalDeterminismGuard(input.text)));
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class RecallCuePrimitive extends Primitive {
  name: PrimitiveName = "RecallCue";
  templateId = "recall_cue_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    return this.logEnd(state, t0);
  }
}

class MotivationalCuePrimitive extends Primitive {
  name: PrimitiveName = "MotivationalCue";
  templateId = "motivational_cue_v1";
  run(state: CfsState, input: { text: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const out = pushAI(state, HumanizationGuard(GlobalDeterminismGuard(input.text)));
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class BridgeCuePrimitive extends Primitive {
  name: PrimitiveName = "BridgeCue";
  templateId = "bridge_cue_v1";
  run(state: CfsState, input: { text: string }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const text = HumanizationGuard(GlobalDeterminismGuard(input.text));
    const out: Partial<CfsState> = { ...pushAI(state, text), session_context: { ...state.session_context, transition_log: [...state.session_context.transition_log, text] } };
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

class EndSessionPrimitive extends Primitive {
  name: PrimitiveName = "EndSession";
  templateId = "end_session_v1";
  run(state: CfsState): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const out = pushAI(state, "Session closed.");
    return { ...out, ...this.logEnd({ ...(state as CfsState), ...out } as CfsState, t0) };
  }
}

export const PrimitivesInstance = {
  AskQuestion: new AskQuestionPrimitive(),
  ExplainWhy: new ExplainWhyPrimitive(),
  CaptureObjective: new CaptureObjectivePrimitive(),
  ProbeRisk: new ProbeRiskPrimitive(),
  EvaluateReadiness: new EvaluateReadinessPrimitive(),
  SummarizeContext: new SummarizeContextPrimitive(),
  ConfirmAssumption: new ConfirmAssumptionPrimitive(),
  GenerateRecommendation: new GenerateRecommendationPrimitive(),
  AcknowledgeEmotion: new AcknowledgeEmotionPrimitive(),
  RankAndSelect: new RankAndSelectPrimitive(),
  ValidateGuardrail: new ValidateGuardrailPrimitive(),
  CelebrateAchievement: new CelebrateAchievementPrimitive(),
  ChallengeAssumption: new ChallengeAssumptionPrimitive(),
  MicroWin: new MicroWinPrimitive(),
  RecallCue: new RecallCuePrimitive(),
  MotivationalCue: new MotivationalCuePrimitive(),
  BridgeCue: new BridgeCuePrimitive(),
  EndSession: new EndSessionPrimitive(),
} as const;

export { z, crypto };
