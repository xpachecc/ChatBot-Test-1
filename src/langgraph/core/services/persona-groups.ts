import { getSupabaseClient } from "./supabase.js";

declare global {
  // Optional test override for persona groups.
  // eslint-disable-next-line no-var
  var __mockPersonaGroups: string[] | undefined;
}

let cached: string[] | null = null;
let cachedUseCase: string[] | null = null;

export async function getPersonaGroups(): Promise<string[]> {
  if (globalThis.__mockPersonaGroups) return globalThis.__mockPersonaGroups;
  if (cached) return cached;
  const { data, error } = await getSupabaseClient().from("persona_groups").select("persona_group_name");
  if (error) throw error;
  const groups = (data ?? [])
    .map((row: { persona_group_name?: string | null }) => row.persona_group_name ?? "")
    .filter(Boolean);
  cached = Array.from(new Set(groups)).sort();
  return cached;
}

export async function getUseCaseGroups(): Promise<string[]> {
  if (cachedUseCase) return cachedUseCase;
  const { data, error } = await getSupabaseClient().from("use_case_groups").select("use_case_group_title");
  if (error) throw error;
  const groups = (data ?? [])
    .map((row: { use_case_group_title?: string | null }) => row.use_case_group_title ?? "")
    .filter(Boolean);
  cachedUseCase = Array.from(new Set(groups)).sort();
  return cachedUseCase;
}
