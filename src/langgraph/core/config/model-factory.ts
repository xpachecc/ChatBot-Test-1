import { ChatOpenAI } from "@langchain/openai";

export type ModelConfig = {
  model: string;
  temperature: number;
  maxRetries: number;
};

const defaultConfigs: Record<string, ModelConfig> = {
  knowYourCustomer: { model: "gpt-3.5-turbo", temperature: 0.4, maxRetries: 1 },
  useCaseQuestions: { model: "gpt-3.5-turbo", temperature: 0.4, maxRetries: 1 },
  readout:          { model: "gpt-4o",         temperature: 0.4, maxRetries: 1 },
};

const overrides: Record<string, ModelConfig> = {};
const cache: Record<string, ChatOpenAI> = {};

/**
 * Register a custom model configuration for a given alias.
 * Calling this clears any cached instance so the next `getModel()` picks up the change.
 */
export function setModelConfig(alias: string, config: ModelConfig): void {
  overrides[alias] = config;
  delete cache[alias];
}

/**
 * Return a cached ChatOpenAI instance for the given alias.
 * Looks up the alias in overrides first, then defaultConfigs.
 * Throws if no configuration exists and no explicit config is provided.
 *
 * @param alias   - Logical name (e.g. "knowYourCustomer", "readout").
 * @param config  - Optional one-off config; does NOT get cached.
 */
export function getModel(alias: string, config?: ModelConfig): ChatOpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(`OPENAI_API_KEY is required to create model "${alias}".`);
  }

  if (config) {
    return new ChatOpenAI({
      model: config.model,
      temperature: config.temperature,
      maxRetries: config.maxRetries,
    });
  }

  if (cache[alias]) return cache[alias];

  const resolved = overrides[alias] ?? defaultConfigs[alias];
  if (!resolved) {
    throw new Error(`No model configuration found for alias "${alias}". Call setModelConfig() first or pass an explicit config.`);
  }

  cache[alias] = new ChatOpenAI({
    model: resolved.model,
    temperature: resolved.temperature,
    maxRetries: resolved.maxRetries,
  });
  return cache[alias];
}

/**
 * Clear all cached model instances. Useful for tests.
 */
export function clearModelCache(): void {
  for (const key of Object.keys(cache)) delete cache[key];
}
