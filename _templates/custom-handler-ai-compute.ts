/**
 * Template: AI Compute Custom Handler
 *
 * Use this pattern when your node needs to:
 * - Read state fields, build a prompt, call an LLM, parse the response, and write back to state
 * - The logic is too specific or complex for the generic `aiCompute` nodeConfig block
 *
 * Imports come from the platform barrel (`infra.ts`) — never from deep platform paths.
 */
import type { CfsState } from "../../src/langgraph/infra.js";
import {
  getModel,
  invokeChatModelWithFallback,
  configString,
  interpolate,
  mergeStatePatch,
  patchSessionContext,
  pushAI,
  getByPath,
  buildNestedPatch,
} from "../../src/langgraph/infra.js";

export async function nodeMyAiCompute(state: CfsState): Promise<Partial<CfsState>> {
  // 1. Read inputs from state
  const industry = getByPath(state, "user_context.industry") as string ?? "unknown";
  const role = getByPath(state, "user_context.role") as string ?? "unknown";

  // 2. Get the model configured for this task
  const model = getModel("myTaskAlias");

  // 3. Build the prompt from YAML-defined strings + state interpolation
  const systemPrompt = configString("myNode.systemPrompt") ?? "You are a helpful assistant.";
  const userPrompt = interpolate(
    "Analyze the following: Industry: {{industry}}, Role: {{role}}",
    { industry, role }
  );

  // 4. Call the LLM with fallback
  const response = await invokeChatModelWithFallback({
    model,
    systemMessage: systemPrompt,
    userMessage: userPrompt,
    runName: "my-ai-compute",
  });

  // 5. Parse the response (custom parsing logic here)
  const parsed = JSON.parse(response) as Record<string, unknown>;

  // 6. Build and return the state patch
  const statePatch = buildNestedPatch(state, "use_case_context.analysis", parsed);
  return mergeStatePatch(
    statePatch,
    pushAI(`Here's what I found: ${parsed.summary ?? "Analysis complete."}`),
    patchSessionContext({ last_question_key: "NEXT_QUESTION_KEY" }),
  );
}
