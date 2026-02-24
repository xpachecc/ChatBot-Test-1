import crypto from "node:crypto";
import { OpenAIEmbeddings } from "@langchain/openai";
import { traceAsGroup } from "@langchain/core/callbacks/manager";
import { getSupabaseClient } from "./supabaseClient.js";
import { CfsState, lastHumanMessage, SpanSanitizer, selectMarketSegment } from "./infra.js";

declare global {
  // Optional test override for vector search.
  // eslint-disable-next-line no-var
  var __mockSearchSupabaseVectors: ((params: VectorSearchParams) => Promise<VectorSearchResult[]>) | undefined;
}

// Single vector search row returned from Supabase.
export type VectorSearchResult = {
  document_id: string;
  document_type: string;
  content: unknown;
  metadata: unknown;
  relationships: unknown;
  similarity?: number;
};

export type MarketSegmentCandidate = {
  segment_name: string;
  scope_profile?: string | null;
};

// Supported strategic readout vector document types.
export const READOUT_DOCUMENT_TYPES = [
  "outcome_posture_document",
  "pillar_readiness_path_document",
  "capability_to_pillar_document",
  "feature_capability_mapping_document",
] as const;

export type ReadoutDocumentType = (typeof READOUT_DOCUMENT_TYPES)[number];

export type ReadoutRetrievalResult = {
  documentsByType: Record<string, VectorSearchResult[]>;
  snippetsByType: Record<string, string[]>;
  filtersByType: Record<string, Record<string, unknown>>;
};

// Minimal audit record of each retrieval call.
export type VectorContextSnapshot = {
  signature: string;
  filters: Record<string, unknown>;
  count: number;
  fetched_at: number;
};

// Full parameter set for a vector search call.
type VectorSearchParams = {
  queryText: string;
  tenantId: string;
  docTypes: string[] | null;
  metadataFilter: Record<string, unknown>;
  relationshipsFilter: Record<string, unknown>;
  topK: number;
};

// Cached clients/models to avoid re-instantiation on each call.
let embeddingModel: OpenAIEmbeddings | undefined;
let metadataMapCache: Record<string, string> | undefined;

const isLangSmithEnabled = () => process.env.LANGCHAIN_TRACING_V2 === "true" && Boolean(process.env.LANGCHAIN_API_KEY);

async function traceLangSmithRun<T>(
  name: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T>,
  outputs?: (result: T) => Record<string, unknown>
): Promise<T> {
  if (!isLangSmithEnabled()) return fn();
  try {
    let result: T;
    await traceAsGroup({ name, projectName: process.env.LANGCHAIN_PROJECT }, async () => {
      result = await fn();
      return outputs ? outputs(result) : {};
    });
    return result!;
  } catch (error) {
    throw error;
  }
}

async function traceQueryText(params: {
  queryText: string;
  tenantId: string | null | undefined;
  documentType?: string | null;
  personaGroupName?: string | null;
}) {
  if (!isLangSmithEnabled()) return;
  try {
    await traceAsGroup(
      {
        name: "vector_query_text",
        projectName: process.env.LANGCHAIN_PROJECT,
      },
      async () => ({})
    );
  } catch (error) {
    throw error;
  }
}

// Temporary tenant fallback for test environments.
const HARD_CODED_TENANT_ID = "21b7ed0f-00d6-4bc8-9ffd-ae0084738079";
// Default mapping from state fields to metadata keys in the vector store.
const DEFAULT_METADATA_MAP: Record<string, string> = {
  persona_role: "persona_role",
  industry: "industry",
  objective_normalized: "use_case_text",
  timeframe: "timeframe",
};

// Initialize and cache the embedding model used for query vectors.
function getEmbeddingModel(): OpenAIEmbeddings {
  if (embeddingModel) return embeddingModel;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to generate embeddings.");
  }
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  embeddingModel = new OpenAIEmbeddings({ model });
  return embeddingModel;
}

// Resolve metadata field mapping from env, with a safe default.
function getMetadataMap(): Record<string, string> {
  if (metadataMapCache) return metadataMapCache;
  const raw = process.env.VECTOR_METADATA_MAP_JSON;
  if (!raw) {
    metadataMapCache = DEFAULT_METADATA_MAP;
    return metadataMapCache!;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("VECTOR_METADATA_MAP_JSON must be a JSON object.");
    metadataMapCache = { ...DEFAULT_METADATA_MAP, ...parsed };
    return metadataMapCache!;
  } catch (error: any) {
    throw new Error(`Invalid VECTOR_METADATA_MAP_JSON: ${error?.message ?? "unknown error"}`);
  }
}

function pickStringField(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buildSnippets(results: VectorSearchResult[], limit = 2): string[] {
  return results
    .map((r) => {
      if (typeof r.content === "string") return r.content;
      if (r.content && typeof r.content === "object") {
        const vals = Object.values(r.content as Record<string, unknown>).filter((v) => typeof v === "string") as string[];
        return vals[0] ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, limit);
}

function extractMarketSegments(results: VectorSearchResult[]): MarketSegmentCandidate[] {
  const seen = new Set<string>();
  const candidates: MarketSegmentCandidate[] = [];
  for (const result of results) {
    const segmentName =
      pickStringField(result.metadata, ["segment_name", "market_segment"]) ??
      pickStringField(result.content, ["segment_name", "market_segment"]);
    if (!segmentName) continue;
    const normalized = segmentName.trim().toLowerCase();
    if (seen.has(normalized)) continue;
    const scopeProfile =
      pickStringField(result.metadata, ["scope_profile"]) ??
      pickStringField(result.content, ["scope_profile"]);
    seen.add(normalized);
    candidates.push({ segment_name: segmentName, scope_profile: scopeProfile });
  }
  return candidates;
}

function extractOutcomeNames(results: VectorSearchResult[]): string[] {
  const seen = new Set<string>();
  const outcomes: string[] = [];
  for (const result of results) {
    const outcomeName =
      pickStringField(result.metadata, ["outcome_name"]) ??
      pickStringField(result.content, ["outcome_name"]);
    if (!outcomeName) continue;
    const normalized = outcomeName.trim().toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    outcomes.push(outcomeName);
  }
  return outcomes;
}

function extractUseCaseTexts(results: VectorSearchResult[]): string[] {
  const seen = new Set<string>();
  const useCases: string[] = [];
  for (const result of results) {
    const useCase =
      pickStringField(result.metadata, ["use_case_text", "use_case_name"]) ??
      pickStringField(result.content, ["use_case_text", "use_case_name"]);
    if (!useCase) continue;
    const normalized = useCase.trim().toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    useCases.push(useCase);
  }
  return useCases;
}

function buildVectorContextUpdate(
  state: CfsState,
  params: {
    signature: string;
    filters: { tenantId: string; docTypes: string[] | null; metadataFilter: Record<string, unknown>; relationshipsFilter: Record<string, unknown> };
    results: VectorSearchResult[];
    snippets: string[];
  }
): Partial<CfsState> {
  const fetched_at = Date.now();
  const snapshot: VectorContextSnapshot = {
    signature: params.signature,
    filters: {
      tenant_id: params.filters.tenantId,
      doc_types: params.filters.docTypes,
      metadata_filter: params.filters.metadataFilter,
      relationships_filter: params.filters.relationshipsFilter,
    },
    count: params.results.length,
    fetched_at,
  };
  return {
    vector_context: {
      ...state.vector_context,
      last_query_signature: params.signature,
      last_filters: params.filters,
      results: params.results,
      fetched_at,
      snippets: params.snippets,
      history: [...state.vector_context.history, snapshot],
    },
  };
}

function cleanQuestionLine(text: string): string {
  return text.replace(/^\s*[\-\*\d]+[\.\)]\s*/, "").trim();
}

function normalizeQuestionBank(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item : ""))
      .map((item) => cleanQuestionLine(item))
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/\n+/)
      .map((line) => cleanQuestionLine(line))
      .filter(Boolean);
  }
  return [];
}

function extractDiscoveryQuestions(results: VectorSearchResult[]): string[] {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const result of results) {
    const raw =
      pickStringField(result.metadata, ["discovery_question_text"]) ??
      pickStringField(result.content, ["discovery_question_text"]);
    const items = normalizeQuestionBank(raw);
    for (const item of items) {
      const normalized = item.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      questions.push(item);
    }
  }
  return questions;
}

// Read default doc types from env, if provided.
function getDefaultDocTypes(): string[] {
  const raw = process.env.VECTOR_DOC_TYPES;
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// Build the query text used for similarity search.
export function buildQueryText(state: CfsState): string {
  const parts = [
    state.user_context.persona_role,
    state.user_context.industry,
    state.use_case_context.objective_normalized,
    state.user_context.timeframe,
    lastHumanMessage(state)?.content?.toString(),
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.join(" | ").trim();
}

// Create a deterministic signature to avoid redundant searches.
export function buildQuerySignature(
  queryText: string,
  filters: {
    tenantId: string;
    docTypes: string[] | null;
    metadataFilter: Record<string, unknown>;
    relationshipsFilter: Record<string, unknown>;
  }
): string {
  const payload = `${queryText}::${JSON.stringify(filters)}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// Convert current state into vector search filters.
export function buildVectorFilters(state: CfsState, docTypes: string[]) {
  const tenantId = state.session_context.tenant_id ?? HARD_CODED_TENANT_ID;
  if (!tenantId) {
    throw new Error("tenant_id is required to query the vector database.");
  }
  const map = getMetadataMap();
  const metadataFilter: Record<string, unknown> = {};

  if (state.user_context.persona_role) metadataFilter[map.persona_role] = state.user_context.persona_role;
  if (state.user_context.industry) metadataFilter[map.industry] = state.user_context.industry;
  if (state.use_case_context.objective_normalized) metadataFilter[map.objective_normalized] = state.use_case_context.objective_normalized;
  if (state.user_context.timeframe) metadataFilter[map.timeframe] = state.user_context.timeframe;

  return {
    tenantId,
    docTypes: docTypes.length ? docTypes : null,
    metadataFilter,
    relationshipsFilter: {},
  };
}

// Execute a vector search via Supabase RPC.
export async function searchSupabaseVectors(params: VectorSearchParams): Promise<VectorSearchResult[]> {
  if (globalThis.__mockSearchSupabaseVectors) {
    return globalThis.__mockSearchSupabaseVectors(params);
  }
  const { queryText, tenantId, docTypes, metadataFilter, relationshipsFilter, topK } = params;
  return traceLangSmithRun(
    "vector_search",
    {
      queryText,
      tenant_id: tenantId,
      doc_types: docTypes,
      metadata_filter: metadataFilter,
      relationships_filter: relationshipsFilter,
      topK,
    },
    async () => {
      const embeddings = getEmbeddingModel();
      const queryEmbedding = await embeddings.embedQuery(queryText);
      const rpcName = process.env.SUPABASE_VECTOR_RPC || "match_documents";

      const { data, error } = await getSupabaseClient().rpc(rpcName, {
        tenant_id: tenantId,
        query_embedding: queryEmbedding,
        match_count: topK,
        doc_types: docTypes,
        metadata_filter: metadataFilter,
        relationships_filter: relationshipsFilter,
      });

      if (error) throw error;
      return (data ?? []) as VectorSearchResult[];
    },
    (rows) => ({ result_count: rows.length })
  );
}

/**
 * Build metadata filters from state, apply optional overrides, and execute a vector search.
 *
 * Consolidates the repeated pattern of buildVectorFilters() -> override metadataFilter ->
 * searchSupabaseVectors() used by retrieveMarketSegmentCandidates, retrieveOutcomeCandidates,
 * retrieveUseCaseOptions, and retrieveUseCaseQuestionBank. Each of those functions retains
 * its public API but delegates individual search calls to this helper.
 *
 * @param params.state              - Conversation state (provides tenant, metadata fields).
 * @param params.docType            - The document_type to filter on.
 * @param params.metadataOverrides  - Complete metadata filter to use (replaces auto-built filter when provided).
 * @param params.topK               - Max results to return (default 6).
 * @param params.queryTextOverride  - Custom query text (defaults to buildQueryText(state)).
 * @param params.docTypesOverride   - Custom docTypes array (defaults to [docType]).
 * @returns Results, snippets, and the resolved filters object.
 */
export async function searchVectorStoreWithFilters(params: {
  state: CfsState;
  docType: string;
  metadataOverrides?: Record<string, unknown>;
  topK?: number;
  queryTextOverride?: string;
  docTypesOverride?: string[] | null;
}): Promise<{ results: VectorSearchResult[]; snippets: string[]; filters: ReturnType<typeof buildVectorFilters> }> {
  const emptyFilters = { tenantId: "", docTypes: null as string[] | null, metadataFilter: {}, relationshipsFilter: {} };
  const queryText = params.queryTextOverride ?? buildQueryText(params.state);
  if (!queryText) return { results: [], snippets: [], filters: emptyFilters };

  let filters: ReturnType<typeof buildVectorFilters>;
  try {
    filters = buildVectorFilters(params.state, [params.docType]);
  } catch {
    return { results: [], snippets: [], filters: emptyFilters };
  }

  const metadataFilter = params.metadataOverrides ?? filters.metadataFilter;
  const docTypes = params.docTypesOverride !== undefined ? params.docTypesOverride : filters.docTypes;

  const results = await searchSupabaseVectors({
    queryText,
    tenantId: filters.tenantId,
    docTypes,
    metadataFilter,
    relationshipsFilter: filters.relationshipsFilter,
    topK: params.topK ?? 6,
  });

  const snippets = buildSnippets(results, 3);
  const resolvedFilters = { ...filters, docTypes, metadataFilter };

  return { results, snippets, filters: resolvedFilters };
}

// Retrieve vector context and store it in state (with caching).
export async function retrieveVectorContext(
  state: CfsState,
  options?: { docTypes?: string[]; topK?: number; metadataFilterOverride?: Record<string, unknown> }
): Promise<Partial<CfsState>> {
  const queryText = buildQueryText(state);
  if (!queryText) return {};

  const docTypes = options?.docTypes ?? getDefaultDocTypes();
  let filters: { tenantId: string; docTypes: string[] | null; metadataFilter: Record<string, unknown>; relationshipsFilter: Record<string, unknown> };
  try {
    filters = buildVectorFilters(state, docTypes);
  } catch {
    return {};
  }
  // Allow call sites to force specific metadata filters.
  if (options?.metadataFilterOverride) {
    filters = { ...filters, metadataFilter: { ...filters.metadataFilter, ...options.metadataFilterOverride } };
  }
  await traceQueryText({
    queryText,
    tenantId: filters.tenantId,
    documentType: Array.isArray(filters.docTypes) ? filters.docTypes[0] ?? null : null,
  });
  // Skip if query + filters are identical to the last run.
  const signature = buildQuerySignature(queryText, filters);
  if (signature === state.vector_context.last_query_signature) return {};

  const topK = options?.topK ?? 6;
  // Execute the vector search against Supabase.
  const results = await searchSupabaseVectors({
    queryText,
    tenantId: filters.tenantId,
    docTypes: filters.docTypes,
    metadataFilter: filters.metadataFilter,
    relationshipsFilter: filters.relationshipsFilter,
    topK,
  });
  // Build short snippets to use as lightweight context injection.
  const snippets = results
    .map((r) => {
      if (typeof r.content === "string") return r.content;
      if (r.content && typeof r.content === "object") {
        const vals = Object.values(r.content as Record<string, unknown>).filter((v) => typeof v === "string") as string[];
        return vals[0] ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 2);
  return buildVectorContextUpdate(state, { signature, filters, results, snippets });
}

export async function retrieveMarketSegmentCandidates(
  state: CfsState
): Promise<{ segments: MarketSegmentCandidate[]; snippets: string[] }> {
  const metadataFilter: Record<string, unknown> = {
    tenant_id: HARD_CODED_TENANT_ID,
    document_type: "market_segment_use_case_group_document",
  };
  if (state.user_context.persona_group) metadataFilter.persona_group_name = state.user_context.persona_group;
  if (state.user_context.goal_statement) metadataFilter.use_case_group_title = state.user_context.goal_statement;

  const { results, snippets } = await searchVectorStoreWithFilters({
    state,
    docType: "market_segment_use_case_group_document",
    metadataOverrides: metadataFilter,
    topK: 8,
  });
  return { segments: extractMarketSegments(results), snippets };
}

export async function retrieveOutcomeCandidates(
  state: CfsState
): Promise<{ outcomes: string[]; snippets: string[] }> {
  if (!state.user_context.persona_group || !state.user_context.goal_statement) {
    return { outcomes: [], snippets: [] };
  }
  const docType = "market_segment_use_case_group_document";
  const tenantId = state.session_context.tenant_id ?? HARD_CODED_TENANT_ID;

  const { results, snippets } = await searchVectorStoreWithFilters({
    state,
    docType,
    metadataOverrides: {
      tenant_id: tenantId,
      document_type: docType,
      use_case_group_title: state.user_context.goal_statement,
      persona_group_name: state.user_context.persona_group,
    },
    topK: 8,
  });

  if (results.length === 0) {
    const fallback = await searchVectorStoreWithFilters({
      state,
      docType,
      metadataOverrides: {
        tenant_id: tenantId,
        document_type: docType,
        use_case_group_title: state.user_context.goal_statement,
      },
      topK: 8,
    });
    if (fallback.results.length) {
      return { outcomes: extractOutcomeNames(fallback.results), snippets: fallback.snippets };
    }
  }
  return { outcomes: extractOutcomeNames(results), snippets };
}

export async function retrieveUseCaseOptions(
  state: CfsState,
  queryText?: string
): Promise<{
  useCases: string[];
  snippets: string[];
  results: VectorSearchResult[];
  vectorContextUpdate: Partial<CfsState>;
}> {
  const resolvedQueryText =
    queryText?.trim() ||
    state.user_context.goal_statement ||
    buildQueryText(state) ||
    "use case";
  if (!resolvedQueryText.trim()) {
    return { useCases: [], snippets: [], results: [], vectorContextUpdate: {} };
  }

  const docType = "use_case_document";
  let baseFilters: ReturnType<typeof buildVectorFilters>;
  try {
    baseFilters = buildVectorFilters(state, [docType]);
  } catch {
    return { useCases: [], snippets: [], results: [], vectorContextUpdate: {} };
  }

  const metadataFilter: Record<string, unknown> = {
    tenant_id: baseFilters.tenantId,
    document_type: docType,
  };
  if (state.user_context.goal_statement) metadataFilter.use_case_group_title = state.user_context.goal_statement;
  if (state.user_context.persona_group) metadataFilter.persona_group_name = state.user_context.persona_group;

  await traceQueryText({
    queryText: resolvedQueryText,
    tenantId: baseFilters.tenantId,
    documentType: docType,
    personaGroupName: state.user_context.persona_group,
  });

  let search = await searchVectorStoreWithFilters({
    state,
    docType,
    metadataOverrides: metadataFilter,
    topK: 8,
    queryTextOverride: resolvedQueryText,
  });
  let resolvedFilters = search.filters;

  if (search.results.length === 0) {
    const relaxedFilter = { tenant_id: baseFilters.tenantId, document_type: docType };
    search = await searchVectorStoreWithFilters({
      state,
      docType,
      metadataOverrides: relaxedFilter,
      topK: 8,
      queryTextOverride: resolvedQueryText,
    });
    resolvedFilters = search.filters;
  }

  if (search.results.length === 0) {
    const tenantOnlyFilter = { tenant_id: baseFilters.tenantId };
    search = await searchVectorStoreWithFilters({
      state,
      docType,
      metadataOverrides: tenantOnlyFilter,
      topK: 8,
      queryTextOverride: resolvedQueryText,
      docTypesOverride: null,
    });
    resolvedFilters = search.filters;
  }

  if (search.results.length === 0) {
    return { useCases: [], snippets: [], results: [], vectorContextUpdate: {} };
  }

  const vectorContextUpdate = buildVectorContextUpdate(state, {
    signature: buildQuerySignature(resolvedQueryText, resolvedFilters),
    filters: resolvedFilters,
    results: search.results,
    snippets: search.snippets,
  });
  return {
    useCases: extractUseCaseTexts(search.results),
    snippets: search.snippets,
    results: search.results,
    vectorContextUpdate,
  };
}

export async function retrieveUseCaseQuestionBank(
  state: CfsState,
  queryText: string
): Promise<{
  questions: string[];
  snippets: string[];
  results: VectorSearchResult[];
  vectorContextUpdate: Partial<CfsState>;
}> {
  if (!queryText) {
    return { questions: [], snippets: [], results: [], vectorContextUpdate: {} };
  }
  if (!state.user_context.persona_group || !state.user_context.goal_statement) {
    return { questions: [], snippets: [], results: [], vectorContextUpdate: {} };
  }
  let baseFilters: ReturnType<typeof buildVectorFilters>;
  try {
    baseFilters = buildVectorFilters(state, ["use_cases_questions_document"]);
  } catch {
    return { questions: [], snippets: [], results: [], vectorContextUpdate: {} };
  }
  const docType = "use_cases_questions_document";
  const prioritizedNames = (state.use_case_context.use_cases_prioritized ?? [])
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return typeof record.name === "string" ? record.name.trim() : "";
    })
    .filter(Boolean);
  const prioritizedFilter = prioritizedNames.length ? Array.from(new Set(prioritizedNames)) : null;
  const metadataFilter: Record<string, unknown> = {
    tenant_id: baseFilters.tenantId,
    document_type: docType,
    use_case_group_title: state.user_context.goal_statement,
    persona_group_name: state.user_context.persona_group,
  };
  if (prioritizedFilter) metadataFilter.use_case_name = prioritizedFilter;
  await traceQueryText({
    queryText,
    tenantId: baseFilters.tenantId,
    documentType: docType,
    personaGroupName: state.user_context.persona_group,
  });

  let search = await searchVectorStoreWithFilters({
    state,
    docType,
    metadataOverrides: metadataFilter,
    topK: 6,
    queryTextOverride: queryText,
  });

  if (search.results.length === 0 && prioritizedFilter) {
    const relaxedFilter = {
      tenant_id: baseFilters.tenantId,
      document_type: docType,
      use_case_group_title: state.user_context.goal_statement,
      persona_group_name: state.user_context.persona_group,
    };
    const relaxed = await searchVectorStoreWithFilters({
      state,
      docType,
      metadataOverrides: relaxedFilter,
      topK: 6,
      queryTextOverride: queryText,
    });
    if (relaxed.results.length) {
      const relaxedVectorContextUpdate = buildVectorContextUpdate(state, {
        signature: buildQuerySignature(queryText, relaxed.filters),
        filters: relaxed.filters,
        results: relaxed.results,
        snippets: relaxed.snippets,
      });
      return {
        questions: extractDiscoveryQuestions(relaxed.results),
        snippets: relaxed.snippets,
        results: relaxed.results,
        vectorContextUpdate: relaxedVectorContextUpdate,
      };
    }
  }

  if (search.results.length === 0) {
    const fallbackFilter = {
      tenant_id: baseFilters.tenantId,
      document_type: docType,
      use_case_group_title: state.user_context.goal_statement,
    };
    const fallback = await searchVectorStoreWithFilters({
      state,
      docType,
      metadataOverrides: fallbackFilter,
      topK: 6,
      queryTextOverride: queryText,
    });
    if (fallback.results.length) {
      const fallbackVectorContextUpdate = buildVectorContextUpdate(state, {
        signature: buildQuerySignature(queryText, fallback.filters),
        filters: fallback.filters,
        results: fallback.results,
        snippets: fallback.snippets,
      });
      return {
        questions: extractDiscoveryQuestions(fallback.results),
        snippets: fallback.snippets,
        results: fallback.results,
        vectorContextUpdate: fallbackVectorContextUpdate,
      };
    }
  }

  const vectorContextUpdate = buildVectorContextUpdate(state, {
    signature: buildQuerySignature(queryText, search.filters),
    filters: search.filters,
    results: search.results,
    snippets: search.snippets,
  });
  return {
    questions: extractDiscoveryQuestions(search.results),
    snippets: search.snippets,
    results: search.results,
    vectorContextUpdate,
  };
}

// Build a deterministic readout query string using user and discovery context.
export function buildReadoutQueryText(state: CfsState): string {
  const discoveryLines = (state.use_case_context.discovery_questions ?? [])
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const question = typeof item.question === "string" ? item.question.trim() : "";
      const response = typeof item.response === "string" ? item.response.trim() : "";
      const risk = typeof item.risk === "string" ? item.risk.trim() : "";
      return [question, response, risk].filter(Boolean).join(" | ");
    })
    .filter(Boolean);

  const pillarText = (state.use_case_context.pillars ?? [])
    .map((pillar) => {
      const name = (pillar as { name?: unknown })?.name;
      return typeof name === "string" ? name.trim() : "";
    })
    .filter(Boolean)
    .join(" | ");
  const useCaseGroupText = (state.use_case_context.use_case_groups ?? []).join(" | ");
  const parts = [
    state.user_context.goal_statement ?? "",
    state.user_context.outcome ?? "",
    state.user_context.persona_group ?? "",
    state.user_context.persona_clarified_role ?? state.user_context.persona_role ?? "",
    pillarText,
    useCaseGroupText,
    ...discoveryLines,
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(" | ").trim();
}

// Retrieve readout context for all configured document types and scoped pillars.
export async function retrieveReadoutDocuments(state: CfsState): Promise<ReadoutRetrievalResult> {
  const queryText = buildReadoutQueryText(state);
  if (!queryText) {
    return { documentsByType: {}, snippetsByType: {}, filtersByType: {} };
  }

  const tenantId = state.session_context.tenant_id ?? HARD_CODED_TENANT_ID;
  if (!tenantId) {
    return { documentsByType: {}, snippetsByType: {}, filtersByType: {} };
  }

  const scopedPillars = Array.from(
    new Set(
      (state.use_case_context.pillars ?? [])
        .map((pillar) => {
          const name = (pillar as { name?: unknown })?.name;
          return typeof name === "string" ? name.trim() : "";
        })
        .filter(Boolean)
    )
  );

  const documentsByType: Record<string, VectorSearchResult[]> = {};
  const snippetsByType: Record<string, string[]> = {};
  const filtersByType: Record<string, Record<string, unknown>> = {};

  for (const documentType of READOUT_DOCUMENT_TYPES) {
    const collected: VectorSearchResult[] = [];
    const dedupe = new Set<string>();
    const perTypeFilters: Record<string, unknown> = {
      tenant_id: tenantId,
      document_type: documentType,
    };

    const targetPillars = scopedPillars.length > 0 ? scopedPillars : [""];
    for (const pillarName of targetPillars) {
      const metadataFilter: Record<string, unknown> = { ...perTypeFilters };
      if (pillarName) metadataFilter.pillar_name = pillarName;
      const rows = await searchSupabaseVectors({
        queryText,
        tenantId,
        docTypes: [documentType],
        metadataFilter,
        relationshipsFilter: {},
        topK: 8,
      });
      for (const row of rows) {
        const key = `${row.document_id}:${row.document_type}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        collected.push(row);
      }
    }

    documentsByType[documentType] = collected;
    snippetsByType[documentType] = buildSnippets(collected, 6);
    filtersByType[documentType] = {
      ...perTypeFilters,
      pillar_names: scopedPillars,
    };
  }

  return {
    documentsByType,
    snippetsByType,
    filtersByType,
  };
}

/**
 * Convenience wrapper: retrieve market segment candidates and select the best one.
 * Replaces the 3-line pattern duplicated in handleIndustry and handleRole.
 */
export async function resolveMarketSegment(state: CfsState): Promise<string | null> {
  const candidates = await retrieveMarketSegmentCandidates(state);
  const selection = await selectMarketSegment({
    industry: SpanSanitizer(state.user_context.industry, ""),
    snippets: candidates.snippets,
    segments: candidates.segments,
  });
  return selection.segment_name ?? null;
}
