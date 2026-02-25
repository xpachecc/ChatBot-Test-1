import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getSanitizerModel } from "./models.js";

declare global {
  var __rephraseQuestionOverride: string | null | undefined;
}

export async function rephraseQuestionWithAI(params: {
  baseQuestion: string;
  industry?: string | null;
  role?: string | null;
  useCaseGroups?: string[];
  allowAIRephrase?: boolean;
  actorRole?: string;
  tone?: string;
}): Promise<string | null> {
  if (globalThis.__rephraseQuestionOverride !== undefined) {
    return globalThis.__rephraseQuestionOverride;
  }
  const allow = params.allowAIRephrase ?? false;
  if (!allow) return null;
  if (!process.env.OPENAI_API_KEY) return null;

  const model = getSanitizerModel();
  const actorRole = params.actorRole ?? "SAAS Enterprise Account Executive";
  const tone = params.tone ?? "conversational, curious";
  const context = {
    industry: params.industry ?? null,
    role: params.role ?? null,
    use_case_groups: params.useCaseGroups ?? [],
  };
  const system = [
    `Role: ${actorRole}.`,
    `Tone: ${tone}.`,
    "Rewrite the base question as a single, concise question.",
    "Infuse the provided context naturally if relevant.",
    "Preserve the original intent; do not add new questions.",
    "Return only the rewritten question text.",
  ].join(" ");
  const user = `Base question: "${params.baseQuestion}"\nContext: ${JSON.stringify(context)}`;
  const resp = await model.invoke([new SystemMessage(system), new HumanMessage(user)], { runName: "rephraseQuestion" });
  const text = (resp.content as string | undefined)?.trim();
  return text && text.length > 0 ? text : null;
}
