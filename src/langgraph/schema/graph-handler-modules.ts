import { registerCfsHandlers } from "./cfs-handlers.js";

export type HandlerRegistrationFn = () => void;

const handlerModules = new Map<string, HandlerRegistrationFn>();

handlerModules.set("cfs", registerCfsHandlers);

/**
 * Register handlers for a graph by graphId.
 * Looks up the handler module in the static registry and calls it.
 * @throws Error if no handler module is registered for the graphId
 */
export function registerHandlersForGraph(graphId: string): void {
  const fn = handlerModules.get(graphId);
  if (!fn) {
    throw new Error(`No handler module registered for graphId: ${graphId}`);
  }
  fn();
}

/**
 * Register a handler module for a graphId.
 * Use this when adding a new flow to the system.
 */
export function registerHandlerModule(graphId: string, fn: HandlerRegistrationFn): void {
  handlerModules.set(graphId, fn);
}
