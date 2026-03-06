import { traceAsGroup } from "@langchain/core/callbacks/manager";
import { ChatOpenAI } from "@langchain/openai";
import { getModel } from "../../config/model-factory.js";
import { isLangSmithEnabled } from "../../helpers/tracing.js";

export const getSanitizerModel = (): ChatOpenAI => getModel("sanitizer");

export const getRiskAssessmentModel = (): ChatOpenAI => getModel("riskAssessment");

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
