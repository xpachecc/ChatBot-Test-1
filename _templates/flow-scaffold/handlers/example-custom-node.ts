/**
 * Example custom handler for the scaffold flow.
 *
 * This demonstrates the pattern for a custom compute node:
 * 1. Read from state
 * 2. Do some processing (AI call, business logic, etc.)
 * 3. Return a state patch
 *
 * Import only from the platform barrel (`infra.ts`).
 */
import type { CfsState } from "../../../src/langgraph/infra.js";
import {
  mergeStatePatch,
  patchSessionContext,
  pushAI,
  getByPath,
} from "../../../src/langgraph/infra.js";

export async function nodeCustomCompute(state: CfsState): Promise<Partial<CfsState>> {
  const firstName = (getByPath(state, "user_context.first_name") as string) ?? "friend";

  return mergeStatePatch(
    pushAI(`Nice to meet you, ${firstName}! This is where your custom logic would go.`),
    patchSessionContext({ awaiting_user: false }),
  );
}
