import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { requireGraphMessagingConfig } from "../../config/messaging.js";
import { getSanitizerModel, getRiskAssessmentModel } from "./models.js";

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
  } catch {
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

export async function selectOutcomeName(params: {
  outcomes: string[];
  personaGroup?: string | null;
  goal?: string | null;
  marketSegment?: string | null;
  snippets: string[];
}): Promise<string | null> {
  const outcomes = params.outcomes.filter((o) => typeof o === "string" && o.trim());
  if (!outcomes.length) return null;
  if (!process.env.OPENAI_API_KEY) return outcomes[0] ?? null;
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
