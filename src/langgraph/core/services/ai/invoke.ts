import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";

export async function invokeChatModelWithFallback(
  model: ChatOpenAI,
  system: string,
  user: string,
  options: { runName: string; fallback?: string }
): Promise<string> {
  try {
    const resp = await model.invoke(
      [new SystemMessage(system), new HumanMessage(user)],
      { runName: options.runName }
    );
    const text = (resp.content as string | undefined)?.trim() ?? "";
    return text || (options.fallback ?? "");
  } catch {
    return options.fallback ?? "";
  }
}
