import crypto from "node:crypto";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CfsStateSchema, type CfsState, type GraphMessagingConfig, type MessageType } from "./state.js";
import {
  prependClarificationAcknowledgement as prependClarificationAcknowledgementText,
  selectClarificationAcknowledgement,
} from "./acknowledgements.js";

let graphMessagingConfig: GraphMessagingConfig | null = null;

export function setGraphMessagingConfig(config: GraphMessagingConfig): void {
  graphMessagingConfig = config;
}

export function clearGraphMessagingConfig(): void {
  graphMessagingConfig = null;
}

export function requireGraphMessagingConfig(): GraphMessagingConfig {
  if (!graphMessagingConfig) {
    throw new Error("Graph messaging config not set. Call setGraphMessagingConfig from stepFlow before running the graph.");
  }
  return graphMessagingConfig;
}

export function getClarificationAcknowledgement(options?: { random?: () => number }): string {
  const config = requireGraphMessagingConfig();
  return selectClarificationAcknowledgement(config.clarificationAcknowledgement, options);
}

export function prependClarificationAcknowledgement(text: string, options?: { random?: () => number }): string {
  const config = requireGraphMessagingConfig();
  return prependClarificationAcknowledgementText(text, config.clarificationAcknowledgement, options);
}

/**
 * Replace `{{key}}` placeholders in a template string with values from a vars map.
 * Unknown placeholders are left intact.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

/**
 * Retrieve a named string from the GraphMessagingConfig.strings map.
 * Returns the hardcoded `fallback` when the key is missing or config has no strings.
 */
export function configString(key: string, fallback: string): string {
  try {
    const config = requireGraphMessagingConfig();
    return config.strings?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Current timestamp in milliseconds.
 *
 * @returns The current time in milliseconds since epoch.
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Clamp a number to the 0..1 range.
 *
 * @param n - The number to clamp.
 * @returns The clamped value between 0 and 1.
 */
export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Find the most recent human message in the conversation.
 *
 * @param state - The current conversation state.
 * @returns The last HumanMessage, or null if none exists.
 */
export function lastHumanMessage(state: CfsState): HumanMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m instanceof HumanMessage) return m;
  }
  return null;
}

/**
 * Find the most recent AI message in the conversation.
 *
 * @param state - The current conversation state.
 * @returns The last AIMessage, or null if none exists.
 */
export function lastAIMessage(state: CfsState): AIMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m instanceof AIMessage) return m;
  }
  return null;
}

/**
 * Append a new AI message to state.
 *
 * @param state       - The current conversation state.
 * @param text        - The AI message content.
 * @param messageType - The message type tag (defaults to "default").
 * @returns A partial state update containing the appended message.
 */
export function pushAI(state: CfsState, text: string, messageType: MessageType = "default"): Partial<CfsState> {
  const message = new AIMessage({
    content: text,
    additional_kwargs: messageType ? { message_type: messageType } : undefined,
  });
  return { messages: [...(state.messages || []), message] };
}

/**
 * Append a new system message to state.
 *
 * @param state - The current conversation state.
 * @param text  - The system message content.
 * @returns A partial state update containing the appended message.
 */
export function pushSystem(state: CfsState, text: string): Partial<CfsState> {
  return { messages: [...(state.messages || []), new SystemMessage(text)] };
}

/**
 * Extract up to the first 6 words from a user's answer for summarization.
 *
 * @param raw - The raw user input text.
 * @returns The first 6 words of the input, or null if empty.
 */
export function extractUserPhraseUpTo6Words(raw: string): string | null {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 6).join(" ");
}

/**
 * Simple keyword-based sentiment detection for reuse.
 *
 * @param answer - The user's answer text.
 * @returns One of "positive", "neutral", or "concerned".
 */
export function detectSentiment(answer: string): "positive" | "neutral" | "concerned" {
  const lower = answer.toLowerCase();
  if (/\b(stressed|blocked|stuck|frustrated|urgent|risk|concerned|worried)\b/.test(lower)) return "concerned";
  if (/\b(great|good|perfect|exactly|yes)\b/.test(lower)) return "positive";
  return "neutral";
}

/**
 * Map question keys to message types for policy decisions.
 *
 * @param questionKey - The question key identifier (e.g., "S1_NAME", "S1_INDUSTRY").
 * @returns The corresponding MessageType.
 */
export function messageTypeFromQuestionKey(questionKey: string): MessageType {
  if (questionKey === "S1_NAME") return "name";
  if (questionKey === "S1_INDUSTRY") return "industry";
  if (questionKey === "S1_ROLE") return "role";
  return "default";
}

/**
 * Parse short yes/no answers consistently.
 *
 * @param answer - The user's answer text.
 * @returns "yes", "no", or null if the answer is unrecognized.
 */
export function parseYesNo(answer: string): "yes" | "no" | null {
  const lower = answer.trim().toLowerCase();
  if (lower === "yes" || lower === "y") return "yes";
  if (lower === "no" || lower === "n") return "no";
  return null;
}

/**
 * Provide example operational areas based on goal and industry.
 *
 * @param goal     - The user's stated goal.
 * @param industry - The user's industry.
 * @returns An array of example operational area strings.
 */
export function opsExamplesForGoal(goal: string | null | undefined, industry: string | null | undefined): string[] {
  const g = (goal ?? "").toLowerCase();
  const ind = (industry ?? "").toLowerCase();
  if (ind.includes("health")) return ["patient administration", "data management", "clinical systems"];
  if (g.includes("data") || g.includes("analytics") || g.includes("reporting")) return ["data ingestion", "data quality", "reporting workflows"];
  if (g.includes("process") || g.includes("workflow") || g.includes("standard")) return ["intake workflows", "handoff approvals", "release cadence"];
  return ["intake processes", "data management", "reporting cycles"];
}

/**
 * Pick a few context tokens to make questions feel contextual.
 *
 * @param state - The current conversation state.
 * @returns Up to 2 context tokens drawn from industry, role, objective, and timeframe.
 */
export function contextTokensForQuestion(state: CfsState): string[] {
  const tokens: string[] = [];
  if (state.user_context.industry) tokens.push(state.user_context.industry);
  if (state.user_context.persona_role) tokens.push(state.user_context.persona_role);
  if (state.use_case_context.objective_normalized) tokens.push(state.use_case_context.objective_normalized);
  if (state.user_context.timeframe) tokens.push(state.user_context.timeframe);
  return tokens.filter(Boolean).slice(0, 2);
}

/**
 * Check whether the answer mentions actor, system, and time signals.
 *
 * @param answer - The user's answer text.
 * @returns An object with `specificity_pass` (true if all fields present) and `fields_missing` (list of missing categories).
 */
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

/**
 * Remove robotic or template-looking markers from output.
 *
 * @param rendered - The rendered text to sanitize.
 * @returns The cleaned text with template markers removed.
 */
export function HumanizationGuard(rendered: string): string {
  return rendered.replace(/\b(primitive|bridgecue|explainwhy|summarizecontext)\b/gi, "").replace(/^\s*[-–>*]{1,3}\s*/gm, "").trim();
}

/**
 * Avoid phrasing that asks the user to choose options.
 *
 * @param rendered - The rendered text to check.
 * @returns The text with choice-asking phrases replaced by declarative statements.
 */
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

/**
 * Update trust score based on recent sentiment.
 *
 * @param state - The current conversation state.
 * @returns A partial state update with the recalculated trust score.
 */
export function ContextMerge(state: CfsState): Partial<CfsState> {
  const logs = state.session_context.primitive_log.slice(-5);
  const meanSent = logs.length ? logs.reduce((a, b) => a + b.sentiment_score, 0) / logs.length : state.relationship_context.sentiment_score;
  const prevTrust = state.relationship_context.trust_score;
  const trust = clamp01(0.8 * meanSent + 0.2 * prevTrust);
  return { relationship_context: { ...state.relationship_context, trust_score: trust } };
}

/**
 * Simple telemetry marker to show a logical commit point.
 *
 * @param state - The current conversation state.
 * @returns A partial state update with a telemetry commit entry appended to the guardrail log.
 */
export function TelemetryCommit(state: CfsState): Partial<CfsState> {
  return { session_context: { ...state.session_context, guardrail_log: [...state.session_context.guardrail_log, `telemetry_commit:${state.session_context.primitive_counter}`] } };
}

/**
 * Normalize timeframe phrasing into a consistent pattern.
 *
 * @param raw - The raw timeframe string from user input.
 * @returns A normalized timeframe string prefixed with a preposition.
 */
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

/**
 * Remove trailing punctuation and fall back to a safe phrase.
 *
 * @param raw      - The raw text to sanitize.
 * @param fallback - The fallback string if raw is null, undefined, or empty.
 * @returns The sanitized text without trailing punctuation, or the fallback.
 */
export function SpanSanitizer(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed.replace(/[.?!]+$/g, "") || fallback;
}

// ── Generic parsing & normalization helpers ──────────────────────────
// These functions have no graph-specific dependency and are reusable
// by any future graph. Originally lived in stepFlowHelpers.ts.

/** A single discovery question with its captured response and risk data. */
export type DiscoveryQuestionItem = {
  question: string;
  response: string | null;
  risk: string | null;
  risk_domain: string | null;
};

/** A pillar entry with a name and a 0–1 confidence score. */
export type PillarEntry = { name: string; confidence: number };

/**
 * Normalize a nullable string by trimming whitespace and treating "default" as null.
 *
 * Returns null if the value is empty, undefined, null, or the literal string "default".
 *
 * @param value - The optional string to normalize.
 * @returns The trimmed string, or null if the value is empty or "default".
 */
export function normalizeOptionalString(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "default") return null;
  return trimmed;
}

/**
 * Clean and deduplicate an array of pillar name strings.
 *
 * Strips control characters, collapses whitespace, removes empty strings,
 * and deduplicates by exact match.
 *
 * @param values - Raw pillar name strings.
 * @returns A deduplicated array of cleaned pillar names.
 */
export function normalizePillarValues(values: string[]): string[] {
  const cleaned = values
    .map((value) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

/**
 * Build a case-insensitive lookup map from an array of canonical string values.
 *
 * Keys are lowercased, values are the original-cased strings. Useful for
 * validating AI-returned values against an allowed list while preserving casing.
 *
 * @param allowed - The canonical list of allowed string values.
 * @returns A Map from lowercase key to original-cased value.
 */
export function buildCaseInsensitiveLookupMap(allowed: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of allowed) {
    const key = item.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, item);
  }
  return map;
}

/**
 * Normalize a mixed array of pillar entries (strings or objects) into a uniform PillarEntry array.
 *
 * Handles both plain strings (assigned confidence 1.0) and objects with optional
 * `name`/`confidence` fields. Deduplicates by lowercase name and clamps confidence to 0–1.
 *
 * @param pillars - An array of strings or `{ name, confidence }` objects.
 * @returns A deduplicated array of PillarEntry objects.
 */
export function normalizeUseCasePillarEntries(
  pillars: Array<string | { name?: unknown; confidence?: unknown }>
): PillarEntry[] {
  const seen = new Set<string>();
  const entries: PillarEntry[] = [];
  for (const pillar of pillars) {
    const nameRaw = typeof pillar === "string" ? pillar : typeof pillar?.name === "string" ? pillar.name : "";
    const name = nameRaw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const confidenceRaw = typeof pillar === "string" ? 1 : pillar?.confidence;
    const confidence =
      typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 1;
    entries.push({ name, confidence });
  }
  return entries;
}

/**
 * Parse an AI-returned JSON string into an array of PillarEntry objects.
 *
 * Expects the AI to return `{ "pillars": [ { "name": "...", "confidence": N }, ... ] }`.
 * Handles both object and plain-string entries in the array. Returns an empty
 * array if parsing fails or the structure is unexpected.
 *
 * @param text - The raw AI response text (expected JSON).
 * @returns An array of validated PillarEntry objects.
 */
export function parsePillarsFromAi(text: string): PillarEntry[] {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { pillars?: unknown }).pillars)) {
      return (parsed as { pillars: unknown[] }).pillars
        .map((p) => {
          if (p && typeof p === "object") {
            const record = p as Record<string, unknown>;
            const name = typeof record.name === "string" ? record.name.trim() : "";
            const confidence = typeof record.confidence === "number" ? Math.max(0, Math.min(1, record.confidence)) : 0;
            if (name) return { name, confidence };
          }
          if (typeof p === "string" && p.trim()) return { name: p.trim(), confidence: 0 };
          return null;
        })
        .filter((entry): entry is PillarEntry => entry !== null);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Strip control characters and collapse whitespace in a discovery answer, capping length at 600 chars.
 *
 * @param raw - The raw user answer text.
 * @returns A sanitized, truncated string safe for storage and AI consumption.
 */
export function sanitizeDiscoveryAnswer(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 600);
}

/**
 * Split a multi-line AI response into individual question strings (up to 3).
 *
 * Strips list markers (bullets, numbers) from each line and filters out blanks.
 *
 * @param text - Raw multi-line text, typically from an AI response.
 * @returns An array of up to 3 cleaned question strings.
 */
export function parseCompositeQuestions(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[\-\*\d]+[\.\)]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Convert an array of question strings into DiscoveryQuestionItem objects with null responses.
 *
 * @param questions - Plain question strings.
 * @returns DiscoveryQuestionItem objects with response/risk/risk_domain set to null.
 */
export function normalizeDiscoveryQuestions(questions: string[]): DiscoveryQuestionItem[] {
  return questions
    .map((question) => question.trim())
    .filter(Boolean)
    .map((question) => ({ question, response: null, risk: null, risk_domain: null }));
}

/**
 * Merge new discovery questions into an existing list, replacing duplicates by question text.
 *
 * Existing entries whose question text matches a new entry are removed; the new entries
 * are appended at the end. Existing entries with no matching new entry are preserved.
 *
 * @param existing - The current list of discovery questions (typed loosely for resilience).
 * @param next     - The new questions to merge in.
 * @returns A combined array with no duplicate question texts.
 */
export function mergeDiscoveryQuestions(
  existing: unknown,
  next: DiscoveryQuestionItem[]
): DiscoveryQuestionItem[] {
  const existingItems = Array.isArray(existing)
    ? existing
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const question = typeof record.question === "string" ? record.question.trim() : "";
          if (!question) return null;
          const response = typeof record.response === "string" ? record.response : null;
          const risk = typeof record.risk === "string" ? record.risk : null;
          const risk_domain = typeof record.risk_domain === "string" ? record.risk_domain : null;
          return { question, response, risk, risk_domain };
        })
        .filter(
          (item): item is DiscoveryQuestionItem =>
            Boolean(item && item.question && typeof item.question === "string")
        )
    : [];
  const nextSet = new Set(next.map((item) => item.question));
  const filteredExisting = existingItems.filter((item) => !nextSet.has(item.question));
  return [...filteredExisting, ...next];
}

/**
 * Truncate a text string to a maximum number of words (default 12).
 *
 * If the text has fewer words than the limit, it is returned unchanged.
 *
 * @param text     - The input text to truncate.
 * @param maxWords - Maximum number of words to keep (default 12).
 * @returns The truncated text.
 */
export function truncateTextToWordLimit(text: string, maxWords = 12): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ");
}

/**
 * Detect whether a user's answer is affirmative (yes, yeah, sure, correct, etc.).
 *
 * @param answer - The raw user answer text.
 * @returns True if the answer matches an affirmative keyword pattern.
 */
export function isAffirmativeAnswer(answer: string): boolean {
  const lower = answer.trim().toLowerCase();
  return /\b(yes|yeah|yep|correct|right|affirmative|sure|sounds good|exactly|that's right|that's right)\b/.test(lower);
}

/**
 * Extract string values from a mixed array of strings and objects.
 *
 * For objects, picks the first string-typed property value. Useful for extracting
 * risk phrases or other labeled text from heterogeneous arrays.
 *
 * @param raw - An array of strings, objects, or mixed values.
 * @returns An array of non-empty trimmed strings found in the input.
 */
export function extractStringValuesFromMixedArray(raw: unknown[]): string[] {
  return raw
    .map((risk) => {
      if (typeof risk === "string") return risk;
      if (risk && typeof risk === "object") {
        const value = Object.values(risk).find((v) => typeof v === "string");
        return typeof value === "string" ? value : "";
      }
      return "";
    })
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Strip non-numeric characters from a selection input and detect invalid content.
 *
 * Returns the normalized string (digits, commas, spaces only) and a flag indicating
 * whether the original input contained non-numeric characters.
 *
 * @param raw - The raw user input string (e.g., "1, 3" or "first one").
 * @returns An object with `normalized` string and `invalid` boolean.
 */
export function sanitizeNumericSelectionInput(raw: string): { normalized: string; invalid: boolean } {
  const invalid = raw.replace(/[0-9,\s]/g, "").trim().length > 0;
  const normalized = raw.replace(/[^0-9,\s]/g, " ").replace(/\s+/g, " ").trim();
  return { normalized, invalid };
}

/**
 * Parse a comma-separated string of 1-based indices into a unique number array.
 *
 * Returns null if the input is empty, contains no valid numbers, or any index
 * falls outside the 1..maxIndex range.
 *
 * @param raw      - The raw input string (e.g., "1,3").
 * @param maxIndex - The maximum valid index (inclusive).
 * @returns An array of unique 1-based indices, or null if invalid.
 */
export function parseNumericSelectionIndices(raw: string, maxIndex: number): number[] | null {
  if (!raw) return null;
  const matches = raw.match(/\d+/g) ?? [];
  if (matches.length === 0) return null;
  const indices = matches.map((value) => Number.parseInt(value, 10)).filter((n) => Number.isFinite(n));
  if (indices.length === 0) return null;
  const unique = Array.from(new Set(indices));
  if (unique.some((n) => n < 1 || n > maxIndex)) return null;
  return unique;
}

// ── Infrastructure helpers ───────────────────────────────────────────

/**
 * Shallow-merge one or more partial state patches onto a base conversation state.
 *
 * Replaces the verbose `{ ...(state as CfsState), ...(update as CfsState) } as CfsState`
 * pattern. Each patch is applied in order (later patches override earlier ones).
 *
 * @param base    - The current full conversation state.
 * @param patches - One or more partial state updates to apply sequentially.
 * @returns A new CfsState with all patches merged. Does not mutate the original.
 *
 * @example
 * const withGreet = pushAI(state, greetText);
 * const merged = mergeStatePatch(state, withGreet);
 */
export function mergeStatePatch(base: CfsState, ...patches: Partial<CfsState>[]): CfsState {
  let result: CfsState = base;
  for (const patch of patches) {
    result = { ...result, ...patch } as CfsState;
  }
  return result;
}

/**
 * Create a session_context update by shallow-merging a patch onto the existing context.
 *
 * Replaces the repetitive `session_context: { ...state.session_context, awaiting_user: ..., ... }`
 * pattern used 59+ times across node files and primitives.
 *
 * @param state - The current full conversation state (reads session_context from it).
 * @param patch - The fields to override in the session context.
 * @returns An object `{ session_context: ... }` ready to spread into a node return value.
 *
 * @example
 * return { ...pushAI(state, questionText), ...patchSessionContext(state, { awaiting_user: true }) };
 */
export function patchSessionContext(
  state: CfsState,
  patch: Partial<CfsState["session_context"]>
): Pick<CfsState, "session_context"> {
  return { session_context: { ...state.session_context, ...patch } };
}

/**
 * Create an initial conversation state for a new session.
 *
 * @param params.sessionId - Optional session ID; defaults to a new UUID.
 * @returns A valid CfsState ready for the first turn.
 */
export function createInitialState(params?: { sessionId?: string }): CfsState {
  const session_id = params?.sessionId ?? crypto.randomUUID();
  return CfsStateSchema.parse({
    messages: [],
    overlay_active: "SeniorSE_Curious",
    session_context: {
      session_id,
      step: "STEP1_KNOW_YOUR_CUSTOMER",
      step_question_index: 0,
      step_clarifier_used: false,
      last_question_key: null,
      awaiting_user: false,
      started: false,
      primitive_counter: 0,
    },
  });
}

// ── Canonical readout document types ─────────────────────────────────

/** A single section in a canonical readout document. */
export type CanonicalReadoutSection = {
  id: string;
  title: string;
  markdown: string;
};

/** A structured readout document, output-agnostic, for downstream adapters. */
export type CanonicalReadoutDocument = {
  document_id: string;
  version: string;
  metadata: Record<string, unknown>;
  sections: CanonicalReadoutSection[];
  tables: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  evidence_refs: string[];
};

/**
 * Build an output-agnostic canonical readout document for downstream adapters.
 *
 * Produces a structured document with typed sections, optional tables,
 * citations, and evidence references. Defaults arrays to empty when omitted.
 *
 * @param params.documentId   - Unique identifier for the document.
 * @param params.metadata     - Arbitrary metadata to attach to the document.
 * @param params.sections     - The ordered sections of the readout.
 * @param params.tables       - Optional table data.
 * @param params.citations    - Optional citation records.
 * @param params.evidenceRefs - Optional evidence reference strings.
 * @returns A fully constructed CanonicalReadoutDocument.
 */
export function buildCanonicalReadoutDocument(params: {
  documentId: string;
  metadata: Record<string, unknown>;
  sections: CanonicalReadoutSection[];
  tables?: Array<Record<string, unknown>>;
  citations?: Array<Record<string, unknown>>;
  evidenceRefs?: string[];
}): CanonicalReadoutDocument {
  return {
    document_id: params.documentId,
    version: "1.0",
    metadata: params.metadata,
    sections: params.sections,
    tables: params.tables ?? [],
    citations: params.citations ?? [],
    evidence_refs: params.evidenceRefs ?? [],
  };
}

/**
 * Build deterministic scores for named items based on vector search similarity.
 * Fallback used when AI scoring is unavailable.
 */
export function buildDeterministicScores(
  results: Array<{ content?: unknown; metadata?: unknown; similarity?: number }>,
  names: string[],
  opts?: { max?: number; fieldKey?: string }
): Array<{ name: string; score: number }> {
  const fieldKey = opts?.fieldKey ?? "use_case_text";
  const max = opts?.max ?? 4;
  const scoreMap = new Map<string, number>();
  for (const result of results) {
    const text =
      (typeof result.content === "object" && result.content ? (result.content as Record<string, unknown>)[fieldKey] : undefined) ??
      (typeof result.metadata === "object" && result.metadata ? (result.metadata as Record<string, unknown>)[fieldKey] : undefined);
    const name = typeof text === "string" ? text.trim() : "";
    if (!name) continue;
    const score = typeof result.similarity === "number" ? Math.round(result.similarity * 100) : 0;
    const prev = scoreMap.get(name) ?? 0;
    if (score > prev) scoreMap.set(name, score);
  }
  return names.slice(0, max).map((name, idx) => ({
    name,
    score: scoreMap.get(name) ?? Math.max(20, 100 - idx * 10),
  }));
}

/**
 * Build a fallback analysis object from state, filling missing fields with a default value.
 * Generic version of the step4 buildFallbackAnalysis pattern.
 */
export function buildFallbackFromSchema(
  state: CfsState,
  pillars: string[],
  defaultValue = "Not provided in today's conversation"
): Record<string, unknown> {
  const discoveryRisks = (state.use_case_context.discovery_questions ?? [])
    .filter((dq) => dq.risk)
    .map((dq) => dq.risk as string);
  const fallbackRiskPoints = discoveryRisks.length
    ? discoveryRisks
    : ["No risk signals identified in today's conversation"];

  return {
    analysis_version: "1.0",
    overall_posture: "Managed",
    highest_business_outcome: state.user_context.goal_statement ?? defaultValue,
    posture_rationale: defaultValue,
    selected_solution_areas: pillars.map((pillar) => ({
      pillar_name: pillar,
      current_readiness_level: "ReadinessLevel2",
      current_readiness_level_reasoning: defaultValue,
      current_readiness_level_verbatim_description: defaultValue,
      target_readiness_level: "ReadinessLevel3",
      target_readiness_level_reasoning: defaultValue,
      target_readiness_level_benefits: defaultValue,
      timeline_alignment: state.user_context.timeframe ?? defaultValue,
      risk_summary_points: fallbackRiskPoints,
      insights_summary: defaultValue,
      recommendations: [defaultValue],
      immediate_tactics: [{ action: defaultValue, why: defaultValue }],
      feature_mapping_candidates: [],
      evidence_refs: [],
    })),
    other_benefits: [],
    final_thoughts_inputs: {
      persona: state.user_context.persona_clarified_role ?? state.user_context.persona_role ?? defaultValue,
      industry: state.user_context.industry ?? defaultValue,
      goals: state.user_context.goal_statement ?? defaultValue,
      platforms: defaultValue,
      friction_points: defaultValue,
      timeline: state.user_context.timeframe ?? defaultValue,
      priority_pillar: pillars[0] ?? defaultValue,
      priority_use_case: state.use_case_context.selected_use_cases?.[0] ?? defaultValue,
      readiness_level_progression: defaultValue,
      strategic_posture_note: defaultValue,
      non_technical_focus_areas: ["process", "governance", "metrics"],
      better_together_note: defaultValue,
    },
  };
}

// ── Flow progress (re-exported from flowProgress.ts) ────────────────────────
export {
  computeFlowProgress,
  type StepProgressStatus,
  type StepProgress,
  type FlowProgress,
} from "./flowProgress.js";

export { crypto };
