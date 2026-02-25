import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { requireGraphMessagingConfig } from "../config/messaging.js";
import { getSanitizerModel } from "../services/ai/models.js";

export async function sanitizeUserInput(
  kind: "name" | "role" | "industry" | "goal" | "timeframe",
  text: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return text;
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = aiPrompts.sanitizeUserInput;
  const resp = await model.invoke(
    [new SystemMessage(system), new HumanMessage(`kind=${kind}; text="${text}"`)],
    { runName: "sanitizeUserInput" }
  );
  const cleaned = (resp.content as string | undefined)?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : text;
}
