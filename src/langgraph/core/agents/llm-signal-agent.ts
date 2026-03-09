import * as z from "zod";
import { HumanMessage } from "@langchain/core/messages";
import type { SignalContext } from "./signal-types.js";
import type { SignalAgentResult } from "./signal-types.js";
import { getModel } from "../config/model-factory.js";

const LLMResponseSchema = z.object({
  engagement: z.number().min(0).max(1),
  sentiment: z.number().min(0).max(1),
  trust: z.number().min(0).max(1),
  intent: z.number().min(0).max(1),
});

/**
 * Run LLM-based signal assessment for all four dimensions.
 * Uses getModel("signalAssessment") — never hardcodes model name.
 */
export async function runLlmSignalAgent(ctx: SignalContext): Promise<SignalAgentResult[] | null> {
  try {
    const model = getModel("signalAssessment");
    const prompt = `Assess this user response on four dimensions (0-1 scale): engagement, sentiment, trust, intent.
Bot asked: ${ctx.lastBotMessage ?? "(no prior message)"}
User replied: ${ctx.userText}
Question purpose: ${ctx.questionPurpose ?? "unknown"}

Return JSON only: {"engagement":0.0-1.0,"sentiment":0.0-1.0,"trust":0.0-1.0,"intent":0.0-1.0}`;

    const response = await model.invoke([new HumanMessage(prompt)], { runName: "llmSignalAssessment" });
    const content = typeof response.content === "string" ? response.content : String(response.content ?? "");
    const json = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(json);
    const validated = LLMResponseSchema.parse(parsed);

    const ts = Date.now();
    const results: SignalAgentResult[] = [
      { dimension: "engagement", score: validated.engagement, confidence: 0.9, source: "llm", timestamp: ts },
      { dimension: "sentiment", score: validated.sentiment, confidence: 0.9, source: "llm", timestamp: ts },
      { dimension: "trust", score: validated.trust, confidence: 0.9, source: "llm", timestamp: ts },
      { dimension: "intent", score: validated.intent, confidence: 0.9, source: "llm", timestamp: ts },
    ];
    return results;
  } catch {
    return null;
  }
}
