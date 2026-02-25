import { getSupabaseClient } from "./supabase.js";

declare global {
  // Optional test override for pillar lookup by outcome.
  // eslint-disable-next-line no-var
  var __mockPillarsForOutcome: string[] | undefined;
  // Optional test override for full pillar list.
  // eslint-disable-next-line no-var
  var __mockAllPillars: string[] | undefined;
}

function normalizePillars(values: Array<string | null | undefined>): string[] {
  const cleaned = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

export async function getPillarsForOutcome(outcomeName: string): Promise<string[]> {
  if (globalThis.__mockPillarsForOutcome) return globalThis.__mockPillarsForOutcome;
  if (!outcomeName.trim()) return [];
  const { data, error } = await getSupabaseClient().rpc("get_pillars_for_outcome", { outcome_name: outcomeName });
  if (error) throw error;
  const rows = (data ?? []) as Array<{ pillar_name?: string | null }>;
  return normalizePillars(rows.map((row) => row.pillar_name ?? ""));
}

export async function getAllPillars(): Promise<string[]> {
  if (globalThis.__mockAllPillars) return globalThis.__mockAllPillars;
  const { data, error } = await getSupabaseClient().from("pillars").select("pillar_name");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ pillar_name?: string | null }>;
  return normalizePillars(rows.map((row) => row.pillar_name ?? ""));
}
