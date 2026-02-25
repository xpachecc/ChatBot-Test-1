import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { CfsState, MessageType } from "../../state.js";

export function lastHumanMessage(state: CfsState): HumanMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m instanceof HumanMessage) return m;
  }
  return null;
}

export function lastAIMessage(state: CfsState): AIMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m instanceof AIMessage) return m;
  }
  return null;
}

export function pushAI(state: CfsState, text: string, messageType: MessageType = "default"): Partial<CfsState> {
  const message = new AIMessage({
    content: text,
    additional_kwargs: messageType ? { message_type: messageType } : undefined,
  });
  return { messages: [...(state.messages || []), message] };
}
