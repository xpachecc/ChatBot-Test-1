import type { SignalOrchestratorResult } from "./signal-types.js";

const MAX_ENTRIES = 1000;

const store = new Map<string, SignalOrchestratorResult>();

function evictIfNeeded(): void {
  if (store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
}

/**
 * Session-scoped pending signal store for deferred merge.
 * Results from turn N are read and merged at the start of turn N+1.
 */
export function getPendingSignal(sessionId: string): SignalOrchestratorResult | null {
  const result = store.get(sessionId) ?? null;
  if (result) store.delete(sessionId);
  return result;
}

/**
 * Store a completed orchestrator result for the given session.
 * Called when the orchestrator finishes (fire-and-forget).
 */
export function setPendingSignal(sessionId: string, result: SignalOrchestratorResult): void {
  evictIfNeeded();
  store.set(sessionId, result);
}

/**
 * Clear a session's pending signal (for tests).
 */
export function clearPendingSignal(sessionId: string): void {
  store.delete(sessionId);
}

/**
 * Clear all pending signals (for tests).
 */
export function clearAllPendingSignals(): void {
  store.clear();
}
