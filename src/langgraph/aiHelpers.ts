import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { traceAsGroup } from "@langchain/core/callbacks/manager";
import { ChatOpenAI } from "@langchain/openai";
import type { CfsState, GraphMessagingConfig } from "./state.js";
import { requireGraphMessagingConfig } from "./utilities.js";
import { searchSupabaseVectors } from "./vector.js";

declare global {
  // Optional test override for AI rephrasing.
  // eslint-disable-next-line no-var
  var __rephraseQuestionOverride: string | null | undefined;
  // Optional test override for risk assessment.
  // eslint-disable-next-line no-var
  var __assessRiskOverride:
    | { risk_detected: boolean; risk_statement?: string | null; risk_domain?: string | null }
    | null
    | undefined;
}

let sanitizerModel: ChatOpenAI | undefined;
/**
 * Low-temperature model used for text sanitization tasks.
 *
 * @returns A lazily-initialized ChatOpenAI instance configured for sanitization.
 */
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

let riskAssessmentModel: ChatOpenAI | undefined;
/**
 * Dedicated model for risk assessment; tune independently from sanitization.
 *
 * @returns A lazily-initialized ChatOpenAI instance configured for risk assessment.
 */
const getRiskAssessmentModel = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to run the LangGraph backend.");
  if (!riskAssessmentModel) {
    riskAssessmentModel = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.8,
      maxRetries: 1,
    });
  }
  return riskAssessmentModel;
};

const isLangSmithEnabled = () =>
  process.env.LANGCHAIN_TRACING_V2 === "true" && Boolean(process.env.LANGCHAIN_API_KEY);

/**
 * Wrap a risk-assessment call with LangSmith tracing when tracing is enabled.
 *
 * If LangSmith is not configured, the wrapped function executes directly without tracing.
 *
 * @param inputs - Key-value metadata to attach to the trace group.
 * @param fn     - The async function to execute (and trace).
 * @returns The result of the wrapped function.
 */
async function traceRiskAssessmentRun<T>(
  inputs: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  if (!isLangSmithEnabled()) return fn();

  let callbackExecuted = false;
  let result: T | undefined;
  try {
    await traceAsGroup(
      {
        name: "assessRisk",
        projectName: process.env.LANGCHAIN_PROJECT,
        inputs,
      } as any,
      async () => {
        callbackExecuted = true;
        result = await fn();
        return { success: true };
      }
    );
    if (callbackExecuted && result !== undefined) return result;
  } catch (error) {
    // If tracing itself fails before the callback executes, run normally without tracing.
    if (callbackExecuted) throw error;
  }

  return fn();
}

/**
 * Invoke a ChatOpenAI model with a system/user message pair and return the trimmed text content.
 *
 * Wraps the repeated try/catch pattern found in 16+ call sites. On any error,
 * or if the model returns empty content, the fallback string is returned instead.
 *
 * @param model    - The ChatOpenAI instance to invoke.
 * @param system   - The system prompt text.
 * @param user     - The user/human prompt text.
 * @param options  - Configuration: `runName` for LangSmith tracing; optional `fallback` string.
 * @returns The trimmed model response text, or the fallback if invocation fails.
 *
 * @example
 * const result = await invokeChatModelWithFallback(model, systemPrompt, userPrompt, {
 *   runName: "selectPersonaGroup",
 *   fallback: "{}",
 * });
 */
export async function invokeChatModelWithFallback(
  model: ChatOpenAI,
  system: string,
  user: string,
  options: { runName: string; fallback?: string }
): Promise<string> {
  try {
    const resp = await model.invoke(
      [new SystemMessage(system), new HumanMessage(user)],
      { runName: options.runName }
    );
    const text = (resp.content as string | undefined)?.trim() ?? "";
    return text || (options.fallback ?? "");
  } catch {
    return options.fallback ?? "";
  }
}

/**
 * Assess the risk of a user's answer by extracting context fields from the current state.
 *
 * Convenience wrapper around assessRiskWithAI that pulls industry, role, goal, timeframe,
 * and prioritized use cases from the conversation state automatically. Eliminates the
 * duplicated parameter extraction found in applyUserAnswer and nodeAskUseCaseQuestions.
 *
 * @param state    - The current conversation state (provides context fields).
 * @param question - The question text that was asked.
 * @param answer   - The user's answer text to assess.
 * @returns The risk assessment result (risk_detected, risk_statement, risk_domain).
 */
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

/**
 * Use AI to pick the closest persona group from a list.
 *
 * Falls back to a token-overlap heuristic when the OpenAI API key is unavailable
 * or when the model response cannot be parsed.
 *
 * @param params - Object containing the user's role, context snippets, and available persona groups.
 * @returns The selected persona group name and a confidence score.
 */
export async function selectPersonaGroup(params: {
  role: string;
  snippets: string[];
  personaGroups: string[];
}): Promise<{ persona_group: string | null; confidence: number }> {
  const allGroups = params.personaGroups.filter((g) => typeof g === "string" && g.trim());
  if (!allGroups.length) return { persona_group: null, confidence: 0 };
  const nonDefaultGroups = allGroups.filter((g) => g.trim().toLowerCase() !== "default");
  const fallbackGroups = nonDefaultGroups.length ? nonDefaultGroups : allGroups;
  const pickClosestGroup = (role: string, snippets: string[], groups: string[]): string => {
    if (groups.length === 1) return groups[0];
    const haystack = [role, ...snippets].join(" ").toLowerCase();
    const tokens = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
    let best = groups[0];
    let bestScore = -1;
    for (const group of groups) {
      const score = group
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = group;
      }
    }
    return best;
  };

  if (!process.env.OPENAI_API_KEY) {
    return { persona_group: pickClosestGroup(params.role, params.snippets, fallbackGroups), confidence: 0.2 };
  }
  const model = getRiskAssessmentModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.selectPersonaGroup;
  const user = [
    `role: ${params.role}`,
    `persona_groups: ${allGroups.join(" | ")}`,
    params.snippets.length ? `context: ${params.snippets.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  let resp;
  try {
    resp = await model.invoke([new SystemMessage(system), new HumanMessage(user)], { runName: "selectPersonaGroup" });
  } catch (error) {
    const fallback = pickClosestGroup(params.role, params.snippets, fallbackGroups);
    return { persona_group: fallback, confidence: 0.2 };
  }
  try {
    const parsed = JSON.parse((resp.content as string) ?? "{}");
    const persona_group =
      typeof parsed.persona_group === "string" && allGroups.includes(parsed.persona_group) ? parsed.persona_group : null;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.2;
    const resolved =
      persona_group && persona_group.trim().toLowerCase() !== "default"
        ? persona_group
        : pickClosestGroup(params.role, params.snippets, fallbackGroups);
    return { persona_group: resolved, confidence };
  } catch {
    return { persona_group: pickClosestGroup(params.role, params.snippets, fallbackGroups), confidence: 0.2 };
  }
}

/**
 * Use AI to pick the closest market segment from a list.
 *
 * Falls back to a token-overlap heuristic when the OpenAI API key is unavailable.
 *
 * @param params - Object containing the industry, context snippets, and available segments.
 * @returns The selected segment name and a confidence score.
 */
export async function selectMarketSegment(params: {
  industry: string;
  snippets: string[];
  segments: Array<{ segment_name: string; scope_profile?: string | null }>;
}): Promise<{ segment_name: string | null; confidence: number }> {
  const fallbackSegment = "Cross-Industry / General";
  const segments = params.segments.filter((s) => typeof s.segment_name === "string" && s.segment_name.trim());
  if (!segments.length) return { segment_name: fallbackSegment, confidence: 0.1 };
  if (!process.env.OPENAI_API_KEY) {
    const haystack = [params.industry, ...params.snippets].join(" ").toLowerCase();
    const tokens = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
    const scoreSegment = (segment: { segment_name: string; scope_profile?: string | null }) => {
      const text = `${segment.segment_name} ${segment.scope_profile ?? ""}`.toLowerCase();
      return text
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
    };
    let best = segments[0];
    let bestScore = scoreSegment(best);
    for (const seg of segments.slice(1)) {
      const s = scoreSegment(seg);
      if (s > bestScore) {
        best = seg;
        bestScore = s;
      }
    }
    return { segment_name: best?.segment_name ?? fallbackSegment, confidence: 0.2 };
  }
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.selectMarketSegment;
  const segmentLines = segments.map((s) => `${s.segment_name}${s.scope_profile ? ` | ${s.scope_profile}` : ""}`);
  const user = [
    `industry: ${params.industry}`,
    `segments: ${segmentLines.join(" || ")}`,
    params.snippets.length ? `context: ${params.snippets.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(user)], { runName: "selectMarketSegment" });
  try {
    const parsed = JSON.parse((resp.content as string) ?? "{}");
    const candidate = typeof parsed.segment_name === "string" ? parsed.segment_name : null;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.2;
    const allowed = new Set(segments.map((s) => s.segment_name.trim().toLowerCase()));
    if (candidate && allowed.has(candidate.trim().toLowerCase())) {
      return { segment_name: candidate, confidence };
    }
    return { segment_name: segments[0]?.segment_name ?? fallbackSegment, confidence: 0.2 };
  } catch {
    return { segment_name: segments[0]?.segment_name ?? fallbackSegment, confidence: 0.2 };
  }
}

/**
 * Use AI to pick the closest outcome name from a list.
 *
 * Returns the first outcome as a fallback when the API key is missing or the
 * model response does not match an allowed outcome.
 *
 * @param params - Object containing candidate outcomes, optional persona/goal/segment context, and snippets.
 * @returns The best-matching outcome name, or null if no outcomes are provided.
 */
export async function selectOutcomeName(params: {
  outcomes: string[];
  personaGroup?: string | null;
  goal?: string | null;
  marketSegment?: string | null;
  snippets: string[];
}): Promise<string | null> {
  const outcomes = params.outcomes.filter((o) => typeof o === "string" && o.trim());
  if (!outcomes.length) return null;
  if (!process.env.OPENAI_API_KEY) {
    return outcomes[0] ?? null;
  }
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.selectOutcomeName;
  const user = [
    params.goal ? `goal: ${params.goal}` : "",
    params.marketSegment ? `market_segment: ${params.marketSegment}` : "",
    params.personaGroup ? `persona_group: ${params.personaGroup}` : "",
    `outcomes: ${outcomes.join(" | ")}`,
    params.snippets.length ? `context: ${params.snippets.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(user)], { runName: "selectOutcomeName" });
  const candidate = (resp.content as string) ?? "";
  const normalize = (value: string) => value.trim().toLowerCase();
  const allowed = new Set(outcomes.map(normalize));
  const normalized = normalize(candidate);
  if (normalized && allowed.has(normalized)) {
    return outcomes.find((o) => normalize(o) === normalized) ?? outcomes[0] ?? null;
  }
  return outcomes[0] ?? null;
}

/**
 * Use AI to refine the use-case groups from a candidate list.
 *
 * Filters candidates against an allowed set, then uses AI to rank and trim
 * the list to at most six entries. Falls back to the intersection without AI
 * when the OpenAI API key is unavailable.
 *
 * @param params - Object containing candidate groups, allowed groups, and optional role/persona/industry/goal context.
 * @returns An array of up to six refined use-case group names.
 */
export async function selectUseCaseGroups(params: {
  candidates: string[];
  allowed: string[];
  role?: string | null;
  personaGroup?: string | null;
  industry?: string | null;
  goal?: string | null;
}): Promise<string[]> {
  const candidates = params.candidates.filter(Boolean);
  const allowed = params.allowed.filter(Boolean);
  if (!candidates.length || !allowed.length) return candidates.slice(0, 6);
  const normalize = (value: string) => value.trim().toLowerCase();
  const allowedSet = new Set(allowed.map(normalize));
  const intersection = candidates.filter((c: string) => allowedSet.has(normalize(c)));
  if (!process.env.OPENAI_API_KEY) return intersection.slice(0, 6);

  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.selectUseCaseGroups;
  const context = [
    params.role ? `role: ${params.role}` : "",
    params.personaGroup ? `persona_group: ${params.personaGroup}` : "",
    params.industry ? `industry: ${params.industry}` : "",
    params.goal ? `goal: ${params.goal}` : "",
    `candidates: ${candidates.join(" | ")}`,
    `allowed: ${allowed.join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(context)], { runName: "selectUseCaseGroups" });
  try {
    const parsed = JSON.parse((resp.content as string) ?? "{}");
    const groups = Array.isArray(parsed.use_case_groups) ? parsed.use_case_groups.filter((g: unknown) => typeof g === "string") : [];
    const refined = (groups as string[]).filter((g: string) => allowedSet.has(normalize(g)));
    return refined.slice(0, 6);
  } catch {
    return intersection.slice(0, 6);
  }
}

/**
 * Ask the model to clean user input into a short, safe value.
 *
 * Returns the original text unchanged when the OpenAI API key is unavailable.
 *
 * @param kind - The category of input being sanitized (name, role, industry, goal, or timeframe).
 * @param text - The raw user-provided text to sanitize.
 * @returns The sanitized text, or the original text if sanitization is unavailable or fails.
 */
export async function sanitizeUserInput(kind: "name" | "role" | "industry" | "goal" | "timeframe", text: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return text;
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.sanitizeUserInput;
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(`kind=${kind}; text="${text}"`)], { runName: "sanitizeUserInput" });
  const cleaned = (resp.content as string | undefined)?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : text;
}

export type RiskAssessmentResult = {
  risk_detected: boolean;
  risk_statement: string | null;
  risk_domain: "compliance" | "security" | "financial" | "operational" | null;
};

/**
 * Assess whether a user's answer to a conversation question poses any risk.
 *
 * Sends the question, answer, and surrounding context to an AI model that returns
 * a structured risk verdict. Supports test overrides via globalThis.__assessRiskOverride.
 *
 * @param params - Object containing the question, answer, and optional context (industry, role, goal, timeframe, use cases).
 * @returns A RiskAssessmentResult indicating whether risk was detected, with an optional statement and domain.
 */
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

/**
 * Rephrase a conversation question using AI to make it more natural and context-aware.
 *
 * Rewrites the base question in the voice of the configured actor role and tone,
 * infusing industry/role/use-case context. Returns null when rephrasing is disabled,
 * the API key is missing, or the model produces empty output.
 *
 * @param params - Object containing the base question, context fields, and rephrasing options.
 * @returns The rephrased question text, or null if rephrasing was skipped or failed.
 */
export async function rephraseQuestionWithAI(params: {
  baseQuestion: string;
  industry?: string | null;
  role?: string | null;
  useCaseGroups?: string[];
  allowAIRephrase?: boolean;
  actorRole?: string;
  tone?: string;
}): Promise<string | null> {
  if (globalThis.__rephraseQuestionOverride !== undefined) {
    return globalThis.__rephraseQuestionOverride;
  }
  const allow = params.allowAIRephrase ?? false;
  if (!allow) return null;
  if (!process.env.OPENAI_API_KEY) return null;

  const model = getSanitizerModel();
  const actorRole = params.actorRole ?? "SAAS Enterprise Account Executive";
  const tone = params.tone ?? "conversational, curious";
  const context = {
    industry: params.industry ?? null,
    role: params.role ?? null,
    use_case_groups: params.useCaseGroups ?? [],
  };
  const system = [
    `Role: ${actorRole}.`,
    `Tone: ${tone}.`,
    "Rewrite the base question as a single, concise question.",
    "Infuse the provided context naturally if relevant.",
    "Preserve the original intent; do not add new questions.",
    "Return only the rewritten question text.",
  ].join(" ");
  const user = `Base question: "${params.baseQuestion}"\nContext: ${JSON.stringify(context)}`;
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(user)], { runName: "rephraseQuestion" });
  const text = (resp.content as string | undefined)?.trim();
  return text && text.length > 0 ? text : null;
}

/**
 * Review and polish an AI-generated response before sending it to the user.
 *
 * Optionally rewrites first-person references to second-person. Returns the
 * original text unchanged when the API key is missing or the model call fails.
 *
 * @param text    - The draft response text to review.
 * @param options - Optional settings; set forbidFirstPerson to rewrite I/me/my/we/our to second-person.
 * @returns The reviewed (and potentially rewritten) response text.
 */
export async function reviewResponseWithAI(text: string, options?: { forbidFirstPerson?: boolean }): Promise<string> {
  const original = text ?? "";
  if (!original.trim()) return original;
  if (!process.env.OPENAI_API_KEY) return original;
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = options?.forbidFirstPerson
    ? `${aiPrompts.reviewResponse} Rewrite any first-person references to second-person addressing the user. Avoid I, me, my, we, our.`
    : aiPrompts.reviewResponse;
  try {
    const resp = await model.invoke([new SystemMessage(system), new HumanMessage(original)], { runName: "reviewResponse" });
    const cleaned = (resp.content as string | undefined)?.trim();
    return cleaned && cleaned.length > 0 ? cleaned : original;
  } catch {
    return original;
  }
}

/**
 * Resolve a persona group classification from a user's role text using vector context and AI.
 *
 * Performs a vector search for persona documents, builds snippet context, then delegates
 * to selectPersonaGroup for AI-based classification. Falls back to existing group/confidence
 * values if the vector search or AI call fails.
 *
 * @param params.roleText                - The user-provided role description.
 * @param params.queryText               - Context string for the vector similarity search.
 * @param params.vectorDocType           - Vector document type to query (e.g., "persona_usecase_document").
 * @param params.vectorMetadataOverrides - Additional metadata filters for the vector search.
 * @param params.personaGroups           - The allowed persona group names.
 * @param params.existingGroup           - The currently assigned persona group (fallback).
 * @param params.existingConfidence      - The current confidence score (fallback).
 * @returns Resolved persona group, confidence, context examples, and cleaned role name.
 */
export async function resolvePersonaGroupFromRole(params: {
  roleText: string;
  queryText: string;
  vectorDocType: string;
  vectorMetadataOverrides?: Record<string, unknown>;
  personaGroups: string[];
  existingGroup: string | null;
  existingConfidence: number;
}): Promise<{
  persona_group: string | null;
  confidence: number;
  context_examples: string[];
  role_name: string;
}> {
  const role = params.roleText.trim();
  if (!role) {
    return {
      persona_group: params.existingGroup,
      confidence: params.existingConfidence,
      context_examples: [],
      role_name: "",
    };
  }

  const queryText = params.queryText.trim();
  if (!queryText) {
    return {
      persona_group: params.existingGroup,
      confidence: params.existingConfidence,
      context_examples: [],
      role_name: role,
    };
  }

  try {
    const overrides = params.vectorMetadataOverrides ?? {};
    const tenantId = typeof overrides.tenant_id === "string" ? overrides.tenant_id : "";

    const results = await searchSupabaseVectors({
      queryText,
      tenantId,
      docTypes: [params.vectorDocType],
      metadataFilter: overrides,
      relationshipsFilter: {},
      topK: 6,
    });

    const examples = results
      .map((r) => {
        if (typeof r.content === "string") return r.content;
        if (r.content && typeof r.content === "object") {
          const vals = Object.values(r.content as Record<string, unknown>).filter((v) => typeof v === "string") as string[];
          return vals[0] ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 3);

    const selection = await selectPersonaGroup({
      role,
      snippets: examples,
      personaGroups: params.personaGroups,
    });

    return {
      persona_group: selection.persona_group,
      confidence: selection.confidence,
      context_examples: examples,
      role_name: role,
    };
  } catch {
    return {
      persona_group: params.existingGroup,
      confidence: params.existingConfidence,
      context_examples: [],
      role_name: role,
    };
  }
}

/**
 * Reusable AI-driven ranking: send candidates + context to a model, parse a JSON array response.
 * Extracts ranked items with scores and insights. Returns empty array on failure.
 */
export async function rankCandidatesWithAI<T extends Record<string, unknown>>(params: {
  model: ChatOpenAI;
  systemPrompt: string;
  userPayload: string;
  runName: string;
  parseItem: (raw: unknown) => T | null;
  maxItems?: number;
}): Promise<T[]> {
  const { model, systemPrompt, userPayload, runName, parseItem, maxItems = 4 } = params;
  const raw = await invokeChatModelWithFallback(model, systemPrompt, userPayload, {
    runName,
    fallback: "",
  });
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseItem)
      .filter((item): item is T => item !== null)
      .slice(0, maxItems);
  } catch {
    return [];
  }
}
