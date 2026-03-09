import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { CfsState } from "../../state.js";
import type { SignalContext } from "./signal-types.js";

const CONFIRM_QUESTION_KEYS = new Set(["CONFIRM_START", "S1_KYC_CONFIRM", "CONFIRM_ROLE"]);
const SELECTION_QUESTION_KEYS = new Set(["S1_USE_CASE_GROUP", "S3_USE_CASE_SELECT"]);

function inferQuestionPurpose(questionKey: string | null): string | null {
  if (!questionKey) return null;
  if (CONFIRM_QUESTION_KEYS.has(questionKey)) return "confirm";
  if (SELECTION_QUESTION_KEYS.has(questionKey)) return "select";
  if (questionKey.startsWith("S1_") || questionKey.startsWith("S2_") || questionKey.startsWith("S3_")) return "collect";
  return null;
}

function getMessageContent(m: unknown): string {
  if (m && typeof m === "object" && "content" in m) {
    const c = (m as { content?: unknown }).content;
    return c != null ? String(c) : "";
  }
  return "";
}

/**
 * Build SignalContext from CfsState and current user text.
 */
export function buildSignalContext(state: CfsState, userText: string): SignalContext {
  const messages = state.messages ?? [];
  const questionKey = state.session_context?.last_question_key ?? null;
  const questionPurpose = inferQuestionPurpose(questionKey);

  let lastBotMessage: string | null = null;
  const priorPairs: Array<{ bot: string; user: string }> = [];
  let foundCurrent = false;

  for (let i = messages.length - 1; i >= 0 && priorPairs.length < 3; i--) {
    const m = messages[i];
    if (m instanceof HumanMessage) {
      const userContent = getMessageContent(m);
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev instanceof AIMessage) {
          const botContent = getMessageContent(prev);
          if (lastBotMessage === null) lastBotMessage = botContent;
          if (!foundCurrent) {
            foundCurrent = true;
          } else if (botContent || userContent) {
            priorPairs.unshift({ bot: botContent, user: userContent });
          }
          break;
        }
      }
    }
  }

  return {
    userText,
    lastBotMessage,
    questionKey,
    questionPurpose,
    priorPairs,
  };
}
