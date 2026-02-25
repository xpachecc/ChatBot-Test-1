import type { GraphMessagingConfig } from "../../state.js";

let graphMessagingConfig: GraphMessagingConfig | null = null;

export function setGraphMessagingConfig(config: GraphMessagingConfig): void {
  graphMessagingConfig = config;
}

export function clearGraphMessagingConfig(): void {
  graphMessagingConfig = null;
}

export function requireGraphMessagingConfig(): GraphMessagingConfig {
  if (!graphMessagingConfig) {
    throw new Error("Graph messaging config not set. Call setGraphMessagingConfig from stepFlow before running the graph.");
  }
  return graphMessagingConfig;
}
