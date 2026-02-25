import { searchSupabaseVectors } from "../vector.js";
import { selectPersonaGroup } from "./selection.js";

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
