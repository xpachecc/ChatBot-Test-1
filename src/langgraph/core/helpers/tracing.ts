/**
 * Returns true when LangSmith tracing is enabled via environment variables.
 * Used to gate traceAsGroup calls and avoid unnecessary overhead when tracing is off.
 */
export function isLangSmithEnabled(): boolean {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && Boolean(process.env.LANGCHAIN_API_KEY);
}
