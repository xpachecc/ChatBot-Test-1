/**
 * Handler registration for the scaffold flow.
 *
 * Each flow registers its custom handlers here via registerHandler().
 * This file is wired into the platform via graph-handler-modules.ts.
 */
import type { CfsState } from "../../../src/langgraph/infra.js";
import { registerHandler } from "../../../src/langgraph/schema/handler-registry.js";
import { nodeCustomCompute } from "./example-custom-node.js";

let registered = false;

export function registerMyFlowHandlers(): void {
  if (registered) return;
  registered = true;

  registerHandler("myFlow.customCompute", nodeCustomCompute);
}
