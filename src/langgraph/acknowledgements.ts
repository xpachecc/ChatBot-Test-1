import type { GraphMessagingConfig } from "./state.js";

const DEFAULT_CLARIFICATION_ACK = "Thank you for the clarification.";

// Single source of truth for acknowledgement variety.
export const ACKNOWLEDGEMENT_PHRASES = [
  DEFAULT_CLARIFICATION_ACK,
  "Understood",
  "Noted.",
  "Got it—thank you",
  "I follow you.",
];

function normalizePhrases(input: GraphMessagingConfig["clarificationAcknowledgement"] | undefined): string[] {
  const candidate = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const cleaned = candidate.map((item) => item.trim()).filter((item) => item.length > 0);
  return cleaned.length ? cleaned : [DEFAULT_CLARIFICATION_ACK];
}

export function selectClarificationAcknowledgement(
  input: GraphMessagingConfig["clarificationAcknowledgement"] | undefined,
  options?: { random?: () => number }
): string {
  const phrases = normalizePhrases(input);
  const randomValue = options?.random ? options.random() : Math.random();
  const normalized = Number.isFinite(randomValue) ? Math.abs(randomValue) : 0;
  const idx = Math.floor(normalized * phrases.length) % phrases.length;
  return phrases[idx] ?? DEFAULT_CLARIFICATION_ACK;
}

export function prependClarificationAcknowledgement(
  text: string,
  input: GraphMessagingConfig["clarificationAcknowledgement"] | undefined,
  options?: { random?: () => number }
): string {
  const ack = selectClarificationAcknowledgement(input, options);
  const normalized = text.trim();
  return normalized ? `${ack} ${normalized}` : ack;
}
