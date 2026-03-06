/**
 * Template: Vector Search Custom Handler
 *
 * Use this pattern when your node needs to:
 * - Build vector search filters from state, retrieve documents, process results,
 *   and write selections back to state
 * - The logic requires custom filter building or result processing beyond what
 *   the generic `vectorSelect` nodeConfig block supports
 *
 * Imports come from the platform barrel (`infra.ts`) — never from deep platform paths.
 */
import type { CfsState } from "../../src/langgraph/infra.js";
import {
  vectorSelect,
  buildVectorFilters,
  configString,
  mergeStatePatch,
  patchSessionContext,
  pushAI,
  buildNestedPatch,
  getByPath,
} from "../../src/langgraph/infra.js";

export async function nodeMyVectorSearch(state: CfsState): Promise<Partial<CfsState>> {
  // 1. Build vector search filters from state
  const filters = buildVectorFilters(state, ["my_document_type"]);

  // 2. Call the vectorSelect primitive
  const result = await vectorSelect({
    state,
    filters,
    docType: "my_document_type",
    snippetLimit: 5,
    selectionPrompt: configString("myNode.selectionPrompt") ?? "Select the best match.",
  });

  // 3. Process the results (custom logic here)
  const selectedItem = result.selected ?? result.candidates?.[0] ?? null;
  if (!selectedItem) {
    return mergeStatePatch(
      pushAI("I couldn't find a matching document. Let me ask a different question."),
      patchSessionContext({ last_question_key: "FALLBACK_QUESTION_KEY" }),
    );
  }

  // 4. Write the selection to state
  const statePatch = buildNestedPatch(state, "use_case_context.selected_document", selectedItem);
  return mergeStatePatch(
    statePatch,
    pushAI(`I found: ${(selectedItem as Record<string, unknown>).title ?? "a relevant document"}`),
    patchSessionContext({ last_question_key: "NEXT_QUESTION_KEY" }),
  );
}
