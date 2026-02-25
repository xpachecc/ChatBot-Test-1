import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { pushAI } from "../../helpers/messaging.js";
import { mergeStatePatch, patchSessionContext } from "../../helpers/state.js";

export type ClarifyIfVagueParams = {
  value: string;
  isVague: (value: string) => Promise<boolean> | boolean;
  fetchSuggestions: (value: string) => Promise<{ suggestions: string[]; results?: unknown }>;
  buildClarificationMessage: (value: string, suggestions: string[]) => string;
  buildExamplesMessage?: (suggestions: string[]) => string;
  questionKey: string;
  extraPatch?: (suggestions: string[], results?: unknown) => Partial<CfsState>;
};

/**
 * When a value is vague, fetch suggestions and ask for clarification.
 * Sets step_clarifier_used and stores suggestions in state (e.g. internet_search_context).
 */
export class ClarifyIfVaguePrimitive extends AsyncPrimitive {
  readonly name = "ClarifyIfVague" as const;
  templateId = "clarify_if_vague_v1";

  async run(state: CfsState, input: ClarifyIfVagueParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const {
      value,
      isVague,
      fetchSuggestions,
      buildClarificationMessage,
      buildExamplesMessage,
      questionKey,
      extraPatch,
    } = input;

    const vague = await isVague(value);
    if (!vague) {
      return this.logEnd(state, t0);
    }

    try {
      const { suggestions, results } = await fetchSuggestions(value);
      if (!suggestions?.length) return this.logEnd(state, t0);

      const alignMessage = buildClarificationMessage(value, suggestions);
      const withAlign = pushAI(state, alignMessage, "industryClarifier");
      const examplesMsg = buildExamplesMessage
        ? buildExamplesMessage(suggestions)
        : `For instance: ${suggestions.join(", ")}.`;
      const withExamples = pushAI(mergeStatePatch(state, withAlign), examplesMsg, "industryClarifier");

      const out: Partial<CfsState> = {
        ...withExamples,
        ...patchSessionContext(state, {
          step_clarifier_used: true,
          awaiting_user: true,
          last_question_key: questionKey,
        }),
      };
      if (extraPatch) {
        Object.assign(out, extraPatch(suggestions, results));
      }
      const merged = mergeStatePatch(state, out) as CfsState;
      return { ...out, ...this.logEnd(merged, t0) };
    } catch {
      return this.logEnd(state, t0);
    }
  }
}

export const clarifyIfVague = new ClarifyIfVaguePrimitive();
