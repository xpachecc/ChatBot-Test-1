import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { requireGraphMessagingConfig } from "../config/messaging.js";
import { getSanitizerModel } from "../services/ai/models.js";

export async function reviewResponseWithAI(
  text: string,
  options?: { forbidFirstPerson?: boolean }
): Promise<string> {
  const original = text ?? "";
  if (!original.trim()) return original;
  if (!process.env.OPENAI_API_KEY) return original;
  const model = getSanitizerModel();
  const { aiPrompts } = requireGraphMessagingConfig();
  const system = options?.forbidFirstPerson
    ? `${aiPrompts.reviewResponse} Rewrite any first-person references to second-person addressing the user. Avoid I, me, my, we, our.`
    : aiPrompts.reviewResponse;
  try {
    const resp = await model.invoke([new SystemMessage(system), new HumanMessage(original)], { runName: "reviewResponse" });
    const cleaned = (resp.content as string | undefined)?.trim();
    return cleaned && cleaned.length > 0 ? cleaned : original;
  } catch {
    return original;
  }
}
