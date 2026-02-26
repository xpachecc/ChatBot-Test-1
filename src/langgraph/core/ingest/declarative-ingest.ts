import type { CfsState } from "../../state.js";
import { applyUserAnswer } from "../primitives/interaction/apply-user-answer.js";

export type IngestHandler = (state: CfsState) => Promise<Partial<CfsState>> | Partial<CfsState>;

/**
 * Executes a simple ingest flow: applyUserAnswer (sanitize via config field mappings) -> thenAsk.
 * Returns the merged state patch. Complex handlers (clarifier, postProcess, multi-step logic)
 * remain as named handlers in core/nodes/ or core/ingest/handlers/.
 */
export async function executeSimpleIngest(
  state: CfsState,
  _thenAsk?: string
): Promise<Partial<CfsState>> {
  return applyUserAnswer(state);
}
