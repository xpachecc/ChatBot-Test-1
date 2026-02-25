import type { CfsState } from "../../../state.js";
import { AsyncPrimitive } from "../base.js";
import { mergeStatePatch } from "../../helpers/state.js";

export type IngestHandler = (state: CfsState) => Promise<Partial<CfsState>> | Partial<CfsState>;

export type IngestDispatcherParams = {
  handlers: Record<string, IngestHandler>;
  lastQuestionKey: string | null;
};

/**
 * Dispatch to a handler based on last_question_key.
 * Used to replace large if/switch chains in ingest nodes.
 */
export class IngestDispatcherPrimitive extends AsyncPrimitive {
  readonly name = "IngestDispatcher" as const;
  templateId = "ingest_dispatcher_v1";

  async run(state: CfsState, input: IngestDispatcherParams): Promise<Partial<CfsState>> {
    const { t0 } = this.logStart(state);
    const { handlers, lastQuestionKey } = input;

    const key = lastQuestionKey ?? "";
    const handler = handlers[key];
    if (!handler) {
      return this.logEnd(state, t0);
    }

    const result = await handler(state);
    const merged = mergeStatePatch(state, result) as CfsState;
    return { ...result, ...this.logEnd(merged, t0) };
  }
}

export const ingestDispatcher = new IngestDispatcherPrimitive();
