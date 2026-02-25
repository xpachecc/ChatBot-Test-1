import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { mergeStatePatch } from "../../helpers/state.js";

export type VectorSelectParams<T = unknown> = {
  retrieve: (state: CfsState) => Promise<{ candidates: T[]; snippets: string[] }>;
  selectWithAI: (params: { state: CfsState; candidates: T[]; snippets: string[] }) => Promise<T | null>;
  fallback: (candidates: T[]) => T;
  statePatch: (state: CfsState, selected: T, snippets: string[]) => Partial<CfsState>;
};

/**
 * Retrieve candidates from a source (e.g. vector store), select best with AI,
 * fallback to deterministic choice when AI unavailable. Returns state patch.
 */
export class VectorSelectPrimitive extends AsyncPrimitive {
  readonly name = "VectorSelect" as const;
  templateId = "vector_select_v1";

  async run(state: CfsState, input: VectorSelectParams<unknown>): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { retrieve, selectWithAI, fallback, statePatch } = input;

    let selected: unknown;
    let snippets: string[] = [];

    try {
      const { candidates, snippets: s } = await retrieve(state);
      snippets = s ?? [];
      if (!candidates?.length) {
        selected = fallback([]);
      } else {
        const aiSelected = await selectWithAI({ state, candidates, snippets });
        selected = aiSelected ?? fallback(candidates);
      }
    } catch {
      selected = fallback([]);
    }

    const out = statePatch(state, selected, snippets);
    const merged = mergeStatePatch(state, out) as CfsState;
    return { ...out, ...this.logEnd(merged, t0) };
  }
}

export const vectorSelect = new VectorSelectPrimitive();
