import type { CfsState } from "../../../state.js";
import { lastHumanMessage } from "../../helpers/messaging.js";
import { detectSentiment } from "../../helpers/sentiment.js";
import { sanitizeUserInput } from "../../guards/sanitize.js";
import { captureObjective } from "./capture-objective.js";
import { acknowledgeEmotion } from "./acknowledge-emotion.js";
import { requireGraphMessagingConfig } from "../../config/messaging.js";

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export async function applyUserAnswer(state: CfsState): Promise<Partial<CfsState>> {
  const hm = lastHumanMessage(state);
  const answer = (hm?.content?.toString() ?? "").trim();
  const sentiment = detectSentiment(answer);
  const key = state.session_context.last_question_key;
  const updates: Partial<CfsState> = {};

  let mapping: { targetField: string; sanitizeAs?: string; captureObjective?: boolean } | undefined;
  try {
    const config = requireGraphMessagingConfig();
    mapping = config.ingestFieldMappings?.[key ?? ""];
  } catch {
    /* config not set */
  }

  if (mapping) {
    const kind = (mapping.sanitizeAs ?? "goal") as "name" | "role" | "industry" | "goal" | "timeframe";
    const sanitized = await sanitizeUserInput(kind, answer);
    const parts = mapping.targetField.split(".");
    const slice = parts[0];
    const base = (state as Record<string, unknown>)[slice];
    const next = base && typeof base === "object" ? { ...base } : {};
    if (parts.length === 2) {
      (next as Record<string, unknown>)[parts[1]] = sanitized;
    } else {
      setNested(next as Record<string, unknown>, parts.slice(1).join("."), sanitized);
    }
    (updates as Record<string, unknown>)[slice] = next;
    if (mapping.captureObjective) {
      const cap = captureObjective.run({ ...state, ...updates } as CfsState, { rawGoal: sanitized });
      Object.assign(updates, cap);
    }
  } else {
    if (key === "S1_NAME") updates.user_context = { ...state.user_context, first_name: await sanitizeUserInput("name", answer) };
    if (key === "S1_ROLE") updates.user_context = { ...state.user_context, persona_role: await sanitizeUserInput("role", answer) };
    if (key === "S1_INDUSTRY") updates.user_context = { ...state.user_context, industry: await sanitizeUserInput("industry", answer) };
    if (key === "S1_GOAL") {
      const cleanGoal = await sanitizeUserInput("goal", answer);
      updates.user_context = { ...state.user_context, goal_statement: cleanGoal };
      const cap = captureObjective.run({ ...state, ...updates } as CfsState, { rawGoal: cleanGoal });
      Object.assign(updates, cap);
    }
    if (key === "S1_TIMEFRAME") updates.user_context = { ...state.user_context, timeframe: await sanitizeUserInput("timeframe", answer) };
  }

  return { ...acknowledgeEmotion.run(state, { sentiment }), ...updates, session_context: { ...state.session_context, awaiting_user: false } };
}
