export type DiscoveryQuestionItem = {
  question: string;
  response: string | null;
  risk: string | null;
  risk_domain: string | null;
};

export type PillarEntry = { name: string; confidence: number };

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

export function parseCompositeQuestions(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[\-\*\d]+[\.\)]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function sanitizeNumericSelectionInput(raw: string): { normalized: string; invalid: boolean } {
  const invalid = raw.replace(/[0-9,\s]/g, "").trim().length > 0;
  const normalized = raw.replace(/[^0-9,\s]/g, " ").replace(/\s+/g, " ").trim();
  return { normalized, invalid };
}

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
