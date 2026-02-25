import type { CfsState } from "../../../state.js";
import { Primitive } from "../base.js";
import { pushAI, lastHumanMessage } from "../../helpers/messaging.js";
import { mergeStatePatch, patchSessionContext } from "../../helpers/state.js";
import { sanitizeNumericSelectionInput, parseNumericSelectionIndices } from "../../helpers/parsing.js";

export type NumericSelectionIngestParams = {
  availableItems: Array<{ name: string; [key: string]: unknown }>;
  questionKey: string;
  retryMessage: string;
  successMessage: string;
  stateField: keyof CfsState;
  stateItemKey: string;
};

/**
 * Parse numeric user selection (e.g. "1" or "1,3"), validate against available items,
 * and return selected names + state patch. Replaces the inline pattern in nodeIngestUseCaseSelection.
 */
export class NumericSelectionIngestPrimitive extends Primitive {
  readonly name = "NumericSelectionIngest" as const;
  templateId = "numeric_selection_ingest_v1";

  run(state: CfsState, input: NumericSelectionIngestParams): Partial<CfsState> {
    const { t0 } = this.logStart(state);
    const { availableItems, questionKey, retryMessage, successMessage, stateField, stateItemKey } = input;
    const raw = (lastHumanMessage(state)?.content?.toString() ?? "").trim();
    const { normalized, invalid } = sanitizeNumericSelectionInput(raw);
    const parsed = invalid ? null : parseNumericSelectionIndices(normalized, availableItems.length);

    if (!parsed || parsed.length === 0) {
      const out = {
        ...pushAI(state, retryMessage),
        ...patchSessionContext(state, { awaiting_user: true, last_question_key: questionKey, step_clarifier_used: true }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    const selected = parsed
      .map((idx) => availableItems[idx - 1]?.name)
      .filter((name): name is string => Boolean(name?.trim()));

    if (selected.length === 0) {
      const out = {
        ...pushAI(state, retryMessage),
        ...patchSessionContext(state, { awaiting_user: true, last_question_key: questionKey, step_clarifier_used: true }),
      };
      return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
    }

    const out: Partial<CfsState> = {
      ...pushAI(state, successMessage),
      [stateField]: { ...(state[stateField] as object), [stateItemKey]: selected },
      ...patchSessionContext(state, { awaiting_user: false, last_question_key: null }),
    };
    return { ...out, ...this.logEnd(mergeStatePatch(state, out) as CfsState, t0) };
  }
}

export const numericSelectionIngest = new NumericSelectionIngestPrimitive();
