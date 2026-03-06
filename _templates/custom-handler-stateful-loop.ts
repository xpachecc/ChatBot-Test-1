/**
 * Template: Stateful Loop Custom Handler
 *
 * Use this pattern when your node needs to:
 * - Iterate through a list of items (questions, topics, sections) one at a time
 * - Track the current index in session_context between turns
 * - Present each item to the user, collect a response, and advance the index
 *
 * Imports come from the platform barrel (`infra.ts`) — never from deep platform paths.
 */
import type { CfsState } from "../../src/langgraph/infra.js";
import {
  configString,
  interpolate,
  mergeStatePatch,
  patchSessionContext,
  pushAI,
  getByPath,
} from "../../src/langgraph/infra.js";

export async function nodeMyStatefulLoop(state: CfsState): Promise<Partial<CfsState>> {
  // 1. Read the list of items and current index from state
  const items = (getByPath(state, "use_case_context.question_list") as string[]) ?? [];
  const currentIndex = (getByPath(state, "session_context.loop_index") as number) ?? 0;

  // 2. Check if the loop is complete
  if (currentIndex >= items.length) {
    return mergeStatePatch(
      pushAI(configString("myLoop.completionMessage") ?? "All items processed."),
      patchSessionContext({
        last_question_key: "AFTER_LOOP_KEY",
        awaiting_user: false,
      }),
    );
  }

  // 3. Present the current item
  const currentItem = items[currentIndex];
  const prompt = interpolate(
    configString("myLoop.itemPrompt") ?? "Item {{index}}: {{item}}",
    { index: String(currentIndex + 1), item: currentItem }
  );

  return mergeStatePatch(
    pushAI(prompt),
    patchSessionContext({
      last_question_key: "MY_LOOP_ITEM",
      awaiting_user: true,
      loop_index: currentIndex + 1,
    }),
  );
}
