import * as z from "zod";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { CfsState, PrimitiveName } from "./state.js";
import { PrimitiveLogSchema } from "./state.js";
import {
  pushAI,
  lastHumanMessage,
  nowMs,
  clamp01,
  extractUserPhraseUpTo6Words,
  HumanizationGuard,
  GlobalDeterminismGuard,
  TimeframeSanitizer,
  SpanSanitizer,
  mergeStatePatch,
  patchSessionContext,
  setGraphMessagingConfig,
  requireGraphMessagingConfig,
  prependClarificationAcknowledgement,
  lastAIMessage,
  detectSentiment,
} from "./utilities.js";
import {
  rephraseQuestionWithAI,
  sanitizeUserInput,
  selectMarketSegment,
  selectOutcomeName,
  selectPersonaGroup,
} from "./aiHelpers.js";

export type OverlayName =
  | "SeniorSE_Curious"
  | "SeniorSE_Challenging"
  | "CTO_Consultative"
  | "Mentor_Supportive"
  | "Coach_Affirmative";

export type StepName = "STEP_1" | "STEP_2";

export type { CfsState, PrimitiveName } from "./state.js";
export { CfsStateSchema } from "./state.js";
export { createInitialState } from "./utilities.js";

export function contextTokensForQuestion(state: CfsState): string[] {
  const tokens: string[] = [];
  if (state.user_context.industry) tokens.push(state.user_context.industry);
  if (state.user_context.persona_role) tokens.push(state.user_context.persona_role);
  if (state.use_case_context.objective_normalized) tokens.push(state.use_case_context.objective_normalized);
  if (state.user_context.timeframe) tokens.push(state.user_context.timeframe);
  return tokens.filter(Boolean).slice(0, 2);
}

export { sanitizeUserInput } from "./aiHelpers.js";

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

  abstract run(state: CfsState, input?: unknown): Partial<CfsState>;
}

class AskQuestionPrimitive extends Primitive {
  name: PrimitiveName = "AskQuestion";
  templateId = "ask_question_v1";
  run(state: CfsState, input: { question: string; questionKey: string; questionPurpose?: string; targetVariable?: string; disableContextTokens?: boolean }): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const q = input.question;
    const out: Partial<CfsState> = {
      ...(q ? pushAI(state, q) : {}),
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
          quote ? `I'm keeping "${quote}" as a working anchor.` : "",
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
        ? "Understood. That pressure is real. We'll keep this tight and focused now."
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

// ── Re-exports ───────────────────────────────────────────────────────
export {
  prependClarificationAcknowledgement,
  lastAIMessage,
  lastHumanMessage,
  pushAI,
  requireGraphMessagingConfig,
  setGraphMessagingConfig,
  mergeStatePatch,
  patchSessionContext,
} from "./utilities.js";

export {
  rephraseQuestionWithAI,
  selectMarketSegment,
  selectOutcomeName,
  selectPersonaGroup,
  rankCandidatesWithAI,
} from "./aiHelpers.js";

export {
  SpanSanitizer,
  TimeframeSanitizer,
  interpolate,
  configString,
  buildDeterministicScores,
  buildFallbackFromSchema,
  computeFlowProgress,
  type StepProgressStatus,
  type StepProgress,
  type FlowProgress,
} from "./utilities.js";

// Reusable primitives and utilities for future graph flows
export {
  askWithRephrase,
  clarifyIfVague,
  questionnaireLoop,
  ingestDispatcher,
  numericSelectionIngest,
  type AskWithRephraseParams,
  type ClarifyIfVagueParams,
  type QuestionnaireLoopParams,
  type IngestDispatcherParams,
  type IngestHandler,
  type NumericSelectionIngestParams,
  type ResolveAndConfirmParams,
} from "./conversationPrimitives.js";
export {
  vectorSelect,
  multiSectionDocBuilder,
  aiRecap,
  cascadingResolve,
  docStyleQa,
  type VectorSelectParams,
  type MultiSectionDocBuilderParams,
  type SectionBuildParams,
  type AiRecapParams,
  type CascadingResolveParams,
  type DocStyleQaParams,
} from "./computePrimitives.js";
export {
  aiCallWithGuardrail,
  type AiCallGuardrailParams,
  type AiCallGuardrailResult,
  type AiCallSource,
} from "./aiCallGuardrail.js";
export { Primitive, AsyncPrimitive } from "./primitiveBase.js";

export async function applyUserAnswer(state: CfsState): Promise<Partial<CfsState>> {
  const hm = lastHumanMessage(state);
  const answer = (hm?.content?.toString() ?? "").trim();
  const sentiment = detectSentiment(answer);
  const key = state.session_context.last_question_key;
  const updates: Partial<CfsState> = {};

  if (key === "S1_NAME") updates.user_context = { ...state.user_context, first_name: await sanitizeUserInput("name", answer) };
  if (key === "S1_ROLE") updates.user_context = { ...state.user_context, persona_role: await sanitizeUserInput("role", answer) };
  if (key === "S1_INDUSTRY") updates.user_context = { ...state.user_context, industry: await sanitizeUserInput("industry", answer) };
  if (key === "S1_GOAL") {
    const cleanGoal = await sanitizeUserInput("goal", answer);
    updates.user_context = { ...state.user_context, goal_statement: cleanGoal };
    const cap = PrimitivesInstance.CaptureObjective.run({ ...state, ...updates } as CfsState, { rawGoal: cleanGoal });
    Object.assign(updates, cap);
  }
  if (key === "S1_TIMEFRAME") updates.user_context = { ...state.user_context, timeframe: await sanitizeUserInput("timeframe", answer) };

  return { ...PrimitivesInstance.AcknowledgeEmotion.run(state, { sentiment }), ...updates, session_context: { ...state.session_context, awaiting_user: false } };
}

export { z } from "zod";
export { default as crypto } from "node:crypto";
