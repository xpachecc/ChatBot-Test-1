import type { CfsState } from "../../../state.js";
import { lastHumanMessage } from "../../helpers/messaging.js";
import { detectSentiment } from "../../helpers/sentiment.js";
import { sanitizeUserInput } from "../../guards/sanitize.js";
import { captureObjective } from "./capture-objective.js";
import { acknowledgeEmotion } from "./acknowledge-emotion.js";

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
    const cap = captureObjective.run({ ...state, ...updates } as CfsState, { rawGoal: cleanGoal });
    Object.assign(updates, cap);
  }
  if (key === "S1_TIMEFRAME") updates.user_context = { ...state.user_context, timeframe: await sanitizeUserInput("timeframe", answer) };

  return { ...acknowledgeEmotion.run(state, { sentiment }), ...updates, session_context: { ...state.session_context, awaiting_user: false } };
}
