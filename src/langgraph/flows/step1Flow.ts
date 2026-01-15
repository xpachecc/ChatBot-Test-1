import crypto from "node:crypto";
import { StateGraph, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  CfsState,
  CfsStateSchema,
  PrimitivesInstance,
  TimeframeSanitizer,
  SpanSanitizer,
  SpecificityCheck,
  ExampleGenerator,
  HumanizationGuard,
  GlobalDeterminismGuard,
  ContextMerge,
  TelemetryCommit,
  extractUserPhraseUpTo6Words,
  lastHumanMessage,
  pushAI,
  loadDomainVectorsForLedger,
  sanitizeUserInput,
} from "../infra.js";

const STEP1_MAX_QUESTIONS = 6;
const STEP2_MAX_QUESTIONS = 2;

type Step1QuestionKey = "S1_NAME" | "S1_READY" | "S1_ROLE" | "S1_INDUSTRY" | "S1_GOAL" | "S1_TIMEFRAME";
type Step2QuestionKey = "S2_CONFIRM_PLAN" | "S2_OBSTACLE";

const STEP2_QUESTIONS: Record<number, { key: Step2QuestionKey; question: string }> = {
  0: {
    key: "S2_CONFIRM_PLAN",
    question: `[Step 2 – What We Will Accomplish Today – Question 1 of ${STEP2_MAX_QUESTIONS}]\nTo make the best use of our time, we’ll focus on uncovering which processes most need alignment and what barriers may slow that progress.\n\n{{name}}, could you share which specific operational areas (for example, {{examples}}) are currently most inconsistent or fragmented as you pursue this goal?`,
  },
  1: {
    key: "S2_OBSTACLE",
    question: `[Step 2 – What We Will Accomplish Today – Question 2 of ${STEP2_MAX_QUESTIONS}]\nTo ensure we explore the right depth, what would you say is the biggest obstacle slowing improvement in those areas — technology limitations, process gaps, or staff adoption?`,
  },
};

function detectSentiment(answer: string): "positive" | "neutral" | "concerned" {
  const lower = answer.toLowerCase();
  if (/\b(stressed|blocked|stuck|frustrated|urgent|risk|concerned|worried)\b/.test(lower)) return "concerned";
  if (/\b(great|good|perfect|exactly|yes)\b/.test(lower)) return "positive";
  return "neutral";
}

function parseYesNo(answer: string): "yes" | "no" | null {
  const lower = answer.trim().toLowerCase();
  if (lower === "yes" || lower === "y") return "yes";
  if (lower === "no" || lower === "n") return "no";
  return null;
}

function step1QuestionForIndex(idx: number): { key: Step1QuestionKey; question: string; topic: "name" | "ready" | "role" | "industry" | "goal" | "timeframe" } {
  switch (idx) {
    case 0:
      return { key: "S1_NAME", question: `Welcome!\n\nStep 1 — Knowing our user.\nBefore we proceed, what is your first name?`, topic: "name" };
    case 1:
      return { key: "S1_READY", question: `Thank you, {{name}}.\n\nBefore we continue, are you ready to move forward?\nPlease answer Yes or No.`, topic: "ready" };
    case 2:
      return {
        key: "S1_ROLE",
        question: `[Step 1 – Knowing Our User – Question 1 of 4]\n{{name}}, to begin, what is your current role or title within your organization?`,
        topic: "role",
      };
    case 3:
      return {
        key: "S1_INDUSTRY",
        question: `[Step 1 – Knowing Our User – Question 2 of 4]\nWhich industry or sector best describes your organization’s focus?`,
        topic: "industry",
      };
    case 4:
      return {
        key: "S1_GOAL",
        question: `[Step 1 – Knowing Our User – Question 3 of 4]\nWhat is the main business or operational outcome you’re hoping to achieve this year through your technology initiatives?`,
        topic: "goal",
      };
    default:
      return {
        key: "S1_TIMEFRAME",
        question: `[Step 1 – Knowing Our User – Question 4 of 4]\nWhat is your target timeframe for achieving measurable progress on this standardization goal?`,
        topic: "timeframe",
      };
  }
}

function opsExamplesForGoal(goal: string | null | undefined, industry: string | null | undefined): string[] {
  const g = (goal ?? "").toLowerCase();
  const ind = (industry ?? "").toLowerCase();
  if (ind.includes("health")) return ["patient administration", "data management", "clinical systems"];
  if (g.includes("data") || g.includes("analytics") || g.includes("reporting")) return ["data ingestion", "data quality", "reporting workflows"];
  if (g.includes("process") || g.includes("workflow") || g.includes("standard")) return ["intake workflows", "handoff approvals", "release cadence"];
  return ["intake processes", "data management", "reporting cycles"];
}

function buildStep2Q1(state: CfsState): string {
  const base = STEP2_QUESTIONS[0];
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const goal = SpanSanitizer(state.user_context.goal_statement ?? state.use_case_context.objective_normalized, "this standardization goal");
  const examples = opsExamplesForGoal(state.user_context.goal_statement ?? state.use_case_context.objective_normalized, state.user_context.industry).join(", ");
  return base.question.replace("{{name}}", name).replace("{{examples}}", examples).replace("this goal", goal);
}

function buildStep2Q1Confirmation(state: CfsState, answer: string): string {
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const focus = SpanSanitizer(answer, "your focus areas");
  const industry = (state.user_context.industry ?? "").toLowerCase();
  const industryLine = industry.includes("health")
    ? "critical for healthcare continuity and compliance"
    : industry.includes("finance")
    ? "critical for financial controls and audit readiness"
    : "a solid lever for reliable operations";
  return `Understood, ${name} — ${focus} are ${industryLine}. That focus gives us a clear direction.`;
}

function buildStep2Q2Confirmation(state: CfsState, answer: string): string {
  const name = SpanSanitizer(state.user_context.first_name, "there");
  const obstacle = SpanSanitizer(answer, "those obstacles");
  const industry = (state.user_context.industry ?? "").toLowerCase();
  const industryLine = industry.includes("health")
    ? "often create risk and slow standardization in healthcare environments"
    : industry.includes("finance")
    ? "often create risk and slow controls in financial environments"
    : "often create risk and slow standardization";
  return `That makes perfect sense, ${name} — ${obstacle} ${industryLine}.`;
}

const STEP2_WRAP_TEXT = "That wraps up Step 2.\nWe’ll keep momentum.";

async function applyUserAnswer(state: CfsState): Promise<Partial<CfsState>> {
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

function maybeAskClarifierOrProceed(state: CfsState): Partial<CfsState> {
  const hm = lastHumanMessage(state);
  const answer = (hm?.content?.toString() ?? "").trim();

  if (state.session_context.step === "STEP_1" && ["S1_NAME", "S1_ROLE", "S1_INDUSTRY", "S1_TIMEFRAME"].includes(state.session_context.last_question_key || "")) {
    return {};
  }

  if (state.session_context.step === "STEP_1" && state.session_context.last_question_key === "S1_READY") {
    const yn = parseYesNo(answer);
    if (yn) return {};
    const retry = "Please answer with yes or no.";
    const out = pushAI(state, retry);
    return { ...out, session_context: { ...state.session_context, step_clarifier_used: true, awaiting_user: true } };
  }

  if (state.session_context.step === "STEP_2") {
    const key = state.session_context.last_question_key;
    const lower = answer.toLowerCase();

    if (key === "S2_CONFIRM_PLAN") {
      if (answer.length >= 3) return {};
      const retry =
        "To keep this moving, please name one or two operational areas (e.g., patient administration, data management, clinical systems) that feel most fragmented.";
      const out = pushAI(state, retry);
      return { ...out, session_context: { ...state.session_context, step_clarifier_used: true, awaiting_user: true } };
    }

    if (key === "S2_OBSTACLE") {
      if (/\b(tech|technology|process|processes|staff|people|adoption|training|tooling|system)\b/.test(lower)) return {};
      const retry = "Pick the biggest obstacle: technology limitations, process gaps, or staff adoption.";
      const out = pushAI(state, retry);
      return { ...out, session_context: { ...state.session_context, step_clarifier_used: true, awaiting_user: true } };
    }

    return {};
  }

  const spec = SpecificityCheck(answer);
  if (spec.specificity_pass) return {};
  if (state.session_context.step_clarifier_used) return {};

  const qIdx = state.session_context.step_question_index;
  const q = step1QuestionForIndex(qIdx);
  const examples =
    q.topic === "name" || q.topic === "ready"
      ? []
      : ExampleGenerator({
          industry: state.user_context.industry,
          role: state.user_context.persona_role,
          topic: q.topic === "industry" ? "industry" : q.topic === "role" ? "role" : q.topic === "goal" ? "goal" : "timeframe",
        });
  const text = HumanizationGuard(
    GlobalDeterminismGuard(
      [spec.fields_missing.length ? `To keep this specific, include: ${spec.fields_missing.join(", ")}. Give a short, concrete answer.` : "", examples.length ? examples.map((e) => `- ${e}`).join("\n") : ""]
        .filter(Boolean)
        .join("\n")
    )
  );
  const out: Partial<CfsState> = { ...pushAI(state, text), session_context: { ...state.session_context, step_clarifier_used: true, awaiting_user: true } };
  return out;
}

function step2QuestionForIndex(idx: number): { key: Step2QuestionKey; question: string } {
  return STEP2_QUESTIONS[idx] ?? STEP2_QUESTIONS[0];
}

function nodeInit(state: CfsState): Partial<CfsState> {
  const loaded = loadDomainVectorsForLedger();
  const base: Partial<CfsState> = loaded
    ? { encyclopedia: { ...state.encyclopedia, file_path: loaded.filePath, encyclopedia_hash: loaded.encyclopediaHash, loaded: true } }
    : { encyclopedia: { ...state.encyclopedia, loaded: false } };

  const greet = "Welcome to SUNDAY SKY!";
  const greetState: CfsState = { ...(state as CfsState), ...base, messages: [...state.messages, new AIMessage(greet)], session_context: { ...state.session_context, started: true, awaiting_user: false, last_question_key: null } };
  const nameQ = step1QuestionForIndex(0);
  const nameAsk = PrimitivesInstance.AskQuestion.run(greetState, { question: nameQ.question, questionKey: nameQ.key });
  return { ...greetState, ...nameAsk };
}

function nodeStep1Next(state: CfsState): Partial<CfsState> {
  if (state.session_context.awaiting_user) return {};
  const idx = state.session_context.step_question_index;
  if (idx >= STEP1_MAX_QUESTIONS) {
    const bridge = PrimitivesInstance.BridgeCue.run(state, { text: "That’s helpful. Next, I will set expectations for what we will accomplish today." });
    return {
      ...bridge,
      session_context: { ...state.session_context, step: "STEP_2", step_question_index: 0, step_clarifier_used: false, last_question_key: null, awaiting_user: false },
      overlay_active: "Mentor_Supportive",
    };
  }
  const q = step1QuestionForIndex(idx);
  let questionText = q.question;
  if (q.key === "S1_READY" || q.key === "S1_ROLE") {
    const name = state.user_context.first_name || "there";
    questionText = q.question.replace("{{name}}", name);
  }
  return PrimitivesInstance.AskQuestion.run(state, { question: questionText, questionKey: q.key });
}

async function nodeStep1Ingest(state: CfsState): Promise<Partial<CfsState>> {
  if (!state.session_context.awaiting_user) return {};
  const applied = await applyUserAnswer(state);

  if (state.session_context.last_question_key === "S1_NAME") {
    const name = (applied as any)?.user_context?.first_name || "there";
    const readyQ = step1QuestionForIndex(1);
    const asked = PrimitivesInstance.AskQuestion.run({ ...(state as CfsState), ...(applied as CfsState) }, { question: readyQ.question.replace("{{name}}", name), questionKey: readyQ.key });
    return { ...applied, ...asked, session_context: { ...state.session_context, ...(applied.session_context ?? {}), step_question_index: 1, awaiting_user: true, step_clarifier_used: false, last_question_key: "S1_READY" } };
  }

  if (state.session_context.last_question_key === "S1_READY") {
    const clarifier = maybeAskClarifierOrProceed({ ...state, ...applied } as CfsState);
    if ((clarifier as any)?.session_context?.awaiting_user) return { ...applied, ...clarifier };
    const roleQ = step1QuestionForIndex(2);
    const name = (applied as any)?.user_context?.first_name || "there";
    const asked = PrimitivesInstance.AskQuestion.run({ ...(state as CfsState), ...(applied as CfsState) }, { question: roleQ.question.replace("{{name}}", name), questionKey: roleQ.key });
    return { ...applied, ...asked, session_context: { ...state.session_context, ...(applied.session_context ?? {}), step_question_index: 2, awaiting_user: true, step_clarifier_used: false, last_question_key: "S1_ROLE" } };
  }

  if (state.session_context.last_question_key === "S1_ROLE") {
    const industryQ = step1QuestionForIndex(3);
    const asked = PrimitivesInstance.AskQuestion.run({ ...(state as CfsState), ...(applied as CfsState) }, { question: industryQ.question, questionKey: industryQ.key });
    return { ...applied, ...asked, session_context: { ...state.session_context, ...(applied.session_context ?? {}), step_question_index: 3, awaiting_user: true, step_clarifier_used: false, last_question_key: "S1_INDUSTRY" } };
  }

  if (state.session_context.last_question_key === "S1_INDUSTRY") {
    const goalQ = step1QuestionForIndex(4);
    const name = (applied as any)?.user_context?.first_name || "there";
    const industry = (applied as any)?.user_context?.industry || "your industry";
    const combined = `Got it, ${name} — ${industry} brings both operational and compliance complexity.\n\n${goalQ.question}`;
    const asked = PrimitivesInstance.AskQuestion.run({ ...(state as CfsState), ...(applied as CfsState) }, { question: combined, questionKey: goalQ.key });
    return { ...applied, ...asked, session_context: { ...state.session_context, ...(applied.session_context ?? {}), step_question_index: 4, awaiting_user: true, step_clarifier_used: false, last_question_key: "S1_GOAL" } };
  }

  if (state.session_context.last_question_key === "S1_GOAL") {
    const timeframeQ = step1QuestionForIndex(5);
    const name = (applied as any)?.user_context?.first_name || "there";
    const industry = SpanSanitizer((applied as any)?.user_context?.industry, "your industry");
    const combined = `That’s clear and valuable, ${name} — standardization can dramatically reduce errors and improve accountability across ${industry}.\n\n${timeframeQ.question}`;
    const asked = PrimitivesInstance.AskQuestion.run({ ...(state as CfsState), ...(applied as CfsState) }, { question: combined, questionKey: timeframeQ.key });
    return { ...applied, ...asked, session_context: { ...state.session_context, ...(applied.session_context ?? {}), step_question_index: 5, awaiting_user: true, step_clarifier_used: false, last_question_key: "S1_TIMEFRAME" } };
  }

  const merged = ContextMerge({ ...state, ...applied } as CfsState);
  const clarifier = maybeAskClarifierOrProceed({ ...state, ...applied, ...merged } as CfsState);
  if ((clarifier as any)?.session_context?.awaiting_user) return { ...applied, ...merged, ...clarifier };

  let confirmation: Partial<CfsState> = {};
  if (state.session_context.last_question_key === "S1_TIMEFRAME") {
    const rawTimeframe =
      (applied as any)?.user_context?.timeframe ??
      state.user_context.timeframe ??
      lastHumanMessage({ ...state, ...applied } as CfsState)?.content?.toString() ??
      "";
    const timeframeText = TimeframeSanitizer(SpanSanitizer(rawTimeframe, "this timeframe"));
    const name = SpanSanitizer((applied as any)?.user_context?.first_name ?? state.user_context.first_name, "there");
    const role = SpanSanitizer((applied as any)?.user_context?.persona_role ?? state.user_context.persona_role, "your role");
    const industry = SpanSanitizer((applied as any)?.user_context?.industry ?? state.user_context.industry, "your industry");
    const goal = SpanSanitizer((applied as any)?.user_context?.goal_statement ?? state.user_context.goal_statement, "your goal");
    const summaryText = [
      `Perfect — ${timeframeText} creates a strong focus for measurable impact.`,
      "",
      `That completes Step 1, ${name}. We now understand:`,
      "",
      `Role: ${role}`,
      "",
      `Industry: ${industry}`,
      "",
      `Goal: ${goal}`,
      "",
      `Timeframe: ${timeframeText}`,
      "",
      `That’s a solid foundation.`,
      `Let’s continue.`,
    ].join("\n");
    confirmation = pushAI({ ...(state as CfsState), ...(applied as CfsState), ...(merged as CfsState) } as CfsState, summaryText);
  }

  if (state.session_context.last_question_key === "S1_TIMEFRAME") {
    const baseState: CfsState = {
      ...(state as CfsState),
      ...(applied as CfsState),
      ...(merged as CfsState),
      ...(confirmation as CfsState),
      session_context: {
        ...state.session_context,
        ...(applied.session_context ?? {}),
        step: "STEP_2",
        step_question_index: 0,
        step_clarifier_used: false,
        awaiting_user: false,
        last_question_key: null,
      },
    };
    const qText = buildStep2Q1(baseState);
    const asked = PrimitivesInstance.AskQuestion.run(baseState, { question: qText, questionKey: "S2_CONFIRM_PLAN" });
    return {
      ...applied,
      ...merged,
      ...confirmation,
      ...asked,
      overlay_active: "CTO_Consultative",
      session_context: {
        ...baseState.session_context,
        ...(asked.session_context ?? {}),
      },
    };
  }

  return {
    ...applied,
    ...merged,
    ...confirmation,
    session_context: {
      ...state.session_context,
      ...(applied.session_context ?? {}),
      step_question_index: state.session_context.step_question_index + 1,
      awaiting_user: false,
      step_clarifier_used: false,
      last_question_key: null,
    },
  };
}

function nodeStep2Next(state: CfsState): Partial<CfsState> {
  if (state.session_context.awaiting_user) return {};
  const idx = state.session_context.step_question_index;
  if (idx === 0) {
    const qText = buildStep2Q1(state);
    const asked = PrimitivesInstance.AskQuestion.run(state, { question: qText, questionKey: "S2_CONFIRM_PLAN" });
    return { ...asked, overlay_active: "CTO_Consultative" };
  }
  if (idx === 1) {
    const q = step2QuestionForIndex(1);
    return PrimitivesInstance.AskQuestion.run(state, { question: q.question, questionKey: q.key });
  }
  const mw = PrimitivesInstance.MicroWin.run(state, { text: "Good. We now have a clean structure for the rest of the discovery." });
  const telem = TelemetryCommit({ ...(state as CfsState), ...mw } as CfsState);
  return { ...mw, ...telem, session_context: { ...state.session_context, awaiting_user: false } };
}

async function nodeStep2Ingest(state: CfsState): Promise<Partial<CfsState>> {
  if (!state.session_context.awaiting_user) return {};
  const applied = await applyUserAnswer(state);
  let confirmation: Partial<CfsState> = {};

  if (state.session_context.last_question_key === "S2_CONFIRM_PLAN") {
    const answer = lastHumanMessage(state)?.content?.toString() ?? "";
    const text = buildStep2Q1Confirmation({ ...(state as CfsState), ...(applied as CfsState) } as CfsState, answer);
    confirmation = pushAI({ ...(state as CfsState), ...(applied as CfsState) } as CfsState, text);
  }

  const clarifier = maybeAskClarifierOrProceed({ ...state, ...applied, ...confirmation } as CfsState);
  if ((clarifier as any)?.session_context?.awaiting_user) return { ...applied, ...confirmation, ...clarifier };
  if (state.session_context.last_question_key === "S2_CONFIRM_PLAN") {
    const baseState: CfsState = { ...(state as CfsState), ...(applied as CfsState), ...(confirmation as CfsState) } as CfsState;
    const q = step2QuestionForIndex(1);
    const asked = PrimitivesInstance.AskQuestion.run(baseState, { question: q.question, questionKey: q.key });
    return {
      ...applied,
      ...confirmation,
      ...asked,
      session_context: {
        ...state.session_context,
        ...(applied.session_context ?? {}),
        ...(asked.session_context ?? {}),
        step_question_index: 1,
        step_clarifier_used: false,
      },
    };
  }

  if (state.session_context.last_question_key === "S2_OBSTACLE") {
    const answer = lastHumanMessage(state)?.content?.toString() ?? "";
    const confirmText = buildStep2Q2Confirmation({ ...(state as CfsState), ...(applied as CfsState) } as CfsState, answer);
    const confirmation2 = pushAI({ ...(state as CfsState), ...(applied as CfsState), ...(confirmation as CfsState) } as CfsState, confirmText);
    const wrap = pushAI({ ...(state as CfsState), ...(applied as CfsState), ...(confirmation as CfsState), ...(confirmation2 as CfsState) } as CfsState, STEP2_WRAP_TEXT);
    return {
      ...applied,
      ...confirmation,
      ...confirmation2,
      ...wrap,
      session_context: {
        ...state.session_context,
        ...(applied.session_context ?? {}),
        step_question_index: state.session_context.step_question_index + 1,
        awaiting_user: false,
        step_clarifier_used: false,
        last_question_key: null,
      },
    };
  }
  return {
    ...applied,
    ...confirmation,
    session_context: {
      ...state.session_context,
      ...(applied.session_context ?? {}),
      step_question_index: state.session_context.step_question_index + 1,
      awaiting_user: false,
      step_clarifier_used: false,
      last_question_key: null,
    },
  };
}

function router(state: CfsState): string {
  if ((state.session_context?.primitive_counter ?? 0) === 0 && (state.messages?.length ?? 0) === 0) return "init_session";
  if (state.session_context.started === false) return "init_session";
  if (state.session_context.step === "STEP_2" && (state.session_context.step_question_index ?? 0) >= STEP2_MAX_QUESTIONS) return "end";
  if (state.session_context.step === "STEP_2") return state.session_context.awaiting_user ? "step2_ingest" : "step2_next";
  if (state.session_context.step === "STEP_1") return state.session_context.awaiting_user ? "step1_ingest" : "step1_next";
  return "end";
}

export function buildStep1Graph() {
  const graph: any = new StateGraph<CfsState>({
    channels: {
      messages: { reducer: (_left = [], right = []) => right ?? _left, default: () => [] },
      session_context: { reducer: (left: any = {}, right: any = {}) => ({ ...left, ...(right ?? {}) }), default: () => ({}) },
      overlay_active: { reducer: (_left: any, right: any) => right ?? _left, default: () => undefined },
      user_context: { reducer: (_left: any, right: any) => right ?? _left, default: () => ({}) },
      use_case_context: { reducer: (_left: any, right: any) => right ?? _left, default: () => ({}) },
      relationship_context: { reducer: (_left: any, right: any) => right ?? _left, default: () => ({}) },
      encyclopedia: { reducer: (_left: any, right: any) => right ?? _left, default: () => ({}) },
      context_weave_index: { reducer: (_left: any, right: any) => right ?? _left, default: () => ({}) },
    },
  } as any);

  graph.addNode("router", (s: CfsState) => s);
  graph.addNode("init_session", nodeInit);
  graph.addNode("step1_next", nodeStep1Next);
  graph.addNode("step1_ingest", nodeStep1Ingest);
  graph.addNode("step2_next", nodeStep2Next);
  graph.addNode("step2_ingest", nodeStep2Ingest);

  graph.setEntryPoint("router");
  graph.addConditionalEdges("router", router, {
    init_session: "init_session",
    step1_next: "step1_next",
    step1_ingest: "step1_ingest",
    step2_next: "step2_next",
    step2_ingest: "step2_ingest",
    end: END,
  });
  graph.addEdge("init_session", END);
  graph.addEdge("step1_next", END);
  graph.addEdge("step1_ingest", END);
  graph.addEdge("step2_next", END);
  graph.addEdge("step2_ingest", END);

  return graph.compile();
}

export function createInitialState(params?: { sessionId?: string; firstName?: string | null }): CfsState {
  const session_id = params?.sessionId ?? crypto.randomUUID();
  return CfsStateSchema.parse({
    messages: [],
    overlay_active: "SeniorSE_Curious",
    user_context: { first_name: params?.firstName ?? null },
    session_context: {
      session_id,
      step: "STEP_1",
      step_question_index: 0,
      step_clarifier_used: false,
      last_question_key: null,
      awaiting_user: false,
      started: false,
      primitive_counter: 0,
      primitive_log: [],
      summary_log: [],
      reason_trace: [],
      guardrail_log: [],
      transition_log: [],
    },
  });
}

export async function runTurn(graphApp: ReturnType<typeof buildStep1Graph>, state: CfsState, userText?: string) {
  const nextState: CfsState = CfsStateSchema.parse({
    ...state,
    session_context: { ...state.session_context },
    messages: userText ? [...state.messages, new HumanMessage(userText)] : state.messages,
  });
  const result = await graphApp.invoke(nextState);
  return CfsStateSchema.parse(result);
}

export const buildCfsGraph = buildStep1Graph;
