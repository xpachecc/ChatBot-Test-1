import type { DiscoveryQuestionItem, PillarEntry } from "./parsing.js";

export function normalizeOptionalString(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "default") return null;
  return trimmed;
}

export function normalizePillarValues(values: string[]): string[] {
  const cleaned = values
    .map((value) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

export function buildCaseInsensitiveLookupMap(allowed: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of allowed) {
    const key = item.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, item);
  }
  return map;
}

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

export function normalizeDiscoveryQuestions(questions: string[]): DiscoveryQuestionItem[] {
  return questions
    .map((question) => question.trim())
    .filter(Boolean)
    .map((question) => ({ question, response: null, risk: null, risk_domain: null }));
}

export function mergeDiscoveryQuestions(existing: unknown, next: DiscoveryQuestionItem[]): DiscoveryQuestionItem[] {
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
