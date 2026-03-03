import type { GraphMessagingConfig } from "../../state.js";

const configByGraphId = new Map<string, GraphMessagingConfig>();
let activeGraphId: string | null = null;

/**
 * Store messaging config for a graph. Call during graph compilation.
 * Overload: setGraphMessagingConfig(graphId, config) — preferred.
 * Legacy: setGraphMessagingConfig(config) — uses "cfs" as graphId (for backward compat until compiler is updated).
 */
export function setGraphMessagingConfig(graphIdOrConfig: string | GraphMessagingConfig, config?: GraphMessagingConfig): void {
  if (typeof graphIdOrConfig === "string") {
    if (!config) throw new Error("config is required when graphId is provided");
    configByGraphId.set(graphIdOrConfig, config);
  } else {
    configByGraphId.set("cfs", graphIdOrConfig);
    activeGraphId = "cfs";
  }
}

/**
 * Set the active graph ID for the current execution context.
 * Used by runTurn before invoking the graph so requireGraphMessagingConfig() (no-arg) resolves correctly.
 */
export function setActiveGraphId(graphId: string): void {
  activeGraphId = graphId;
}

/**
 * Get the currently active graph ID, if any.
 */
export function getActiveGraphId(): string | null {
  return activeGraphId;
}

export function clearGraphMessagingConfig(): void {
  configByGraphId.clear();
  activeGraphId = null;
}

/**
 * Retrieve messaging config. With no arg, uses the active graph ID (set by runTurn).
 * With graphId arg, retrieves config for that graph directly.
 */
export function requireGraphMessagingConfig(graphId?: string): GraphMessagingConfig {
  const id = graphId ?? activeGraphId;
  if (!id) {
    throw new Error(
      "Graph messaging config not set. Call setGraphMessagingConfig(graphId, config) during compilation and setActiveGraphId(graphId) before runTurn."
    );
  }
  const config = configByGraphId.get(id);
  if (!config) {
    throw new Error(`No messaging config found for graphId: ${id}. Ensure the graph was compiled with config.`);
  }
  return config;
}
