import { traceAsGroup } from "@langchain/core/callbacks/manager";
import { ChatOpenAI } from "@langchain/openai";

let sanitizerModel: ChatOpenAI | undefined;
export const getSanitizerModel = (): ChatOpenAI => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to run the LangGraph backend.");
  if (!sanitizerModel) {
    sanitizerModel = new ChatOpenAI({
      model: "gpt-3.5-turbo",
      temperature: 0,
      maxRetries: 1,
    });
  }
  return sanitizerModel;
};

let riskAssessmentModel: ChatOpenAI | undefined;
export const getRiskAssessmentModel = (): ChatOpenAI => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to run the LangGraph backend.");
  if (!riskAssessmentModel) {
    riskAssessmentModel = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.8,
      maxRetries: 1,
    });
  }
  return riskAssessmentModel;
};

const isLangSmithEnabled = () =>
  process.env.LANGCHAIN_TRACING_V2 === "true" && Boolean(process.env.LANGCHAIN_API_KEY);

export async function traceRiskAssessmentRun<T>(
  inputs: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  if (!isLangSmithEnabled()) return fn();
  let callbackExecuted = false;
  let result: T | undefined;
  try {
    await traceAsGroup(
      { name: "assessRisk", projectName: process.env.LANGCHAIN_PROJECT, inputs } as any,
      async () => {
        callbackExecuted = true;
        result = await fn();
        return { success: true };
      }
    );
    if (callbackExecuted && result !== undefined) return result;
  } catch (error) {
    if (callbackExecuted) throw error;
  }
  return fn();
}
