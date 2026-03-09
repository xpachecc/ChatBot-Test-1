# Spec for Signal Deferred Merge Architecture

feature_slug: signal-deferred-merge

## Intent and Desired Outcomes
- Business intent: Decouple signal agent orchestration from the request/response cycle so that signal assessment never adds latency to user-facing conversation turns, enabling richer (and eventually LLM-powered) signal analysis without degrading the chat experience.
- User problem: The current 50ms race timeout discards signal results when analysis takes longer than the budget, and any future enhancement (conversation context, LLM calls) would either be discarded or block the response.
- Desired outcomes:
  - Signal orchestration runs fully asynchronously with zero impact on user-observable latency
  - Signal results are reliably merged into conversation state on the next turn
  - The architecture supports arbitrarily long signal computations (heuristic or LLM) without risk of blocking or discarding
- Success metrics (observable):
  - runTurn response time is unchanged or reduced (no await on signal orchestration)
  - Signal scores in relationship_context are populated within one turn of the triggering user message
  - No signal results are silently discarded due to timeout

## Summary
The current signal orchestration in `runTurn()` launches the orchestrator in parallel with the graph but then races it against a hard 50ms timeout after the graph completes. If the orchestrator hasn't finished, results are discarded. This architecture prevents any enhancement that takes longer than 50ms. The deferred merge replaces this with a fire-and-forget model: the orchestrator writes its result to a session-scoped in-memory store, and `runTurn` reads and merges the pending result at the start of the *next* turn. This introduces a one-turn lag in signal data — invisible to users and perfectly acceptable for a running behavioral assessment.

## Scenario Coverage

### Primary Success Scenario
- Given signal agents are globally enabled and the user sends a message on turn N
- When `runTurn` executes for turn N
- Then the orchestrator is fired asynchronously (no await), the graph runs and returns immediately, and the orchestrator result is written to the signal store keyed by session ID upon completion

### Variation Scenarios
- Scenario A: On turn N+1, `runTurn` reads the pending signal from the store, merges it into `relationship_context` before the graph runs, then fires a new orchestrator for turn N+1's text.
- Scenario B: If the orchestrator for turn N has not completed by the time turn N+1 starts (extremely unlikely for heuristics, possible for future LLM mode), the store is empty for that session and no merge occurs — the previous relationship_context is preserved unchanged.
- Scenario C: On the very first turn of a session, no pending signal exists in the store. The merge step is a no-op and the graph runs with default relationship_context values.

### Failure / Edge Scenarios
- Scenario E1: The orchestrator throws an unhandled error -> The `.catch(() => null)` pattern writes nothing to the store; the next turn's merge is a no-op; conversation continues unaffected.
- Scenario E2: The session store grows unbounded (many concurrent sessions) -> The store should support a TTL-based or size-based eviction strategy to prevent memory leaks.
- Scenario E3: Two rapid turns arrive for the same session before the first orchestrator completes -> The second turn reads nothing (store empty), fires its own orchestrator; when the first orchestrator writes, it may be immediately overwritten by the second. Both signals contribute to history over subsequent turns.

## Functional Requirements
- FR-1: The system should provide a session-scoped signal store (`Map<string, SignalOrchestratorResult>`) with get, set, and delete operations.
- FR-2: `runTurn` should read and consume (delete after read) any pending signal result from the store at the start of each turn, before the graph runs.
- FR-3: `runTurn` should merge the consumed signal result into `relationship_context` before invoking the graph.
- FR-4: `runTurn` should fire the signal orchestrator asynchronously after constructing the state, without awaiting the result.
- FR-5: The orchestrator should write its completed result to the signal store keyed by the session's `session_id`.
- FR-6: The system should remove the current 50ms `Promise.race` timeout in `runTurn` (lines 62–65 of `graph.ts`).
- FR-7: The signal store should support a configurable maximum size or TTL to prevent unbounded memory growth.
- FR-8: The system should not change the orchestrator's internal TTL (`config.ttlMs`) which remains a safety net for runaway agent calls.

## Possible Edge Cases
- Very first turn of a brand-new session (no pending signal — merge is no-op)
- Session with signal agents disabled globally (orchestrator never fires, store never written)
- Rapid consecutive turns before orchestrator completes (race between writes)
- Server restart clears the in-memory store (acceptable — scores re-establish within 1–2 turns via EMA)
- Concurrent requests for the same session (store operations should be synchronous Map operations — no async race)

## Acceptance Criteria
- AC-1: After turn N where user sends text, the signal store contains a result for that session's ID -> pass
- AC-2: On turn N+1, `relationship_context` reflects the signal scores from turn N's text -> pass
- AC-3: `runTurn` response time has no dependency on signal orchestrator completion time -> pass (measurable: no await between orchestrator fire and response return)
- AC-4: When the orchestrator errors, the conversation continues with previous relationship_context values -> pass
- AC-5: The 50ms Promise.race is removed from `graph.ts` -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success scenario -> "writes signal result to store after orchestrator completes"
  - Variation A -> "merges pending signal into state on next turn"
  - Variation C -> "first turn with no pending signal is a no-op merge"
  - Failure E1 -> "orchestrator error does not write to store"
  - Failure E2 -> "store evicts entries beyond max size"
- Acceptance traceability:
  - AC-1 -> Unit test: fire orchestrator, wait for completion, assert store contains session entry
  - AC-2 -> Integration test: two consecutive runTurn calls; second turn's state has signal scores from first turn's text
  - AC-3 -> Integration test: measure runTurn time with and without signal agents enabled; no significant difference
  - AC-4 -> Unit test: orchestrator that throws; next turn has default relationship_context
  - AC-5 -> Code review: no `Promise.race` on orchestratorPromise in `graph.ts`
- Regression checks:
  - Existing `signalAgents.test.ts` extractors and agent tests still pass (unchanged)
  - Existing `signalIntegration.test.ts` updated to expect one-turn-lag behavior
  - `runTurn` still produces correct AI messages, applies message policies, and handles clarifiers

## Dependencies and Constraints
- Dependencies:
  - `session_context.session_id` must be reliably available in state (already guaranteed by `createInitialState`)
  - The signal orchestrator must continue to accept `CfsState` for EMA computation against prior scores
- Constraints:
  - Must not introduce any user-observable latency
  - Must not require changes to the frontend or session management in `server.ts`
  - Signal scores are always one turn behind the triggering user message

## Out of Scope
- Persistent storage of signal results (database) — in-memory only for now
- Multi-server / distributed signal store — single-process only
- Changes to the signal agent algorithms themselves (covered by later phases)
- Per-node `signalAgents` flag wiring (covered by Phase 7)

## Open Questions
- Should the store eviction be TTL-based (e.g., 30 minutes) or size-based (e.g., max 1000 sessions), or both?
- Should the store be exported from `infra.ts` for testability, or remain internal to the agents module?
