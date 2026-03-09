# Spec for Signal Events and Actions

feature_slug: signal-events-actions

## Intent and Desired Outcomes
- Business intent: Make signal scores actionable by detecting behavioral trends across turns and suggesting conversation adaptations, enabling the flow to dynamically adjust pacing, empathy, and question depth based on observed user behavior patterns.
- User problem: Signal scores are currently tracked but never acted upon. The `signal_events` and `signal_actions` arrays in `relationship_context` are always empty. The conversation follows the same fixed path regardless of whether the user is highly engaged or actively disengaging.
- Desired outcomes:
  - Behavioral trend events are detected from signal history (e.g., declining engagement, sentiment shift)
  - Actionable suggestions are generated from detected events (e.g., slow pacing, skip optional questions)
  - Events and actions are typed with Zod schemas (replacing `z.any()`)
  - The infrastructure is in place for routing rules to consume signal events in future flow enhancements
- Success metrics (observable):
  - Three consecutive engagement score drops produce an `engagement_declining` event
  - A sentiment drop from above 0.6 to below 0.3 produces a `sentiment_shift_negative` event
  - Each event type maps to at least one suggested action
  - Events and actions are present in `relationship_context` after orchestrator merge

## Summary
This phase populates the currently empty `signal_events` and `signal_actions` arrays by introducing trend detection logic that analyzes `signal_history` after each orchestrator run. Events represent detected behavioral patterns (declining engagement, negative sentiment shift, user rushing, high trust moments). Actions represent suggested conversation adaptations (slow pacing, offer clarification, skip optional questions, increase empathy). Both are defined with typed Zod schemas replacing the current `z.any()`. The orchestrator calls the detection functions after computing scores and includes results in its output.

## Scenario Coverage

### Primary Success Scenario
- Given a user has shown declining engagement over three consecutive turns (each turn's engagement score lower than the previous)
- When the orchestrator computes the latest turn's signals
- Then `signal_events` contains an `engagement_declining` event and `signal_actions` contains `slow_down_pacing`

### Variation Scenarios
- Scenario A: Sentiment drops from 0.7 to 0.25 in a single turn -> `sentiment_shift_negative` event + `increase_empathy` action.
- Scenario B: Intent agent classifies two consecutive turns as "rushing" -> `user_rushing` event + `skip_optional_questions` action.
- Scenario C: Trust score spikes above 0.85 -> `high_trust_moment` event (informational, no corrective action needed).
- Scenario D: Sentiment recovers from below 0.3 to above 0.6 -> `sentiment_recovery` event (positive signal, no action needed).
- Scenario E: All scores are stable and moderate -> no events, no actions (empty arrays).

### Failure / Edge Scenarios
- Scenario E1: Signal history has fewer than 3 entries -> trend detection that requires 3+ turns is skipped; no false positives.
- Scenario E2: Signal history contains entries with missing fields (e.g., no intent from pre-Phase-3 data) -> detection gracefully ignores missing dimensions.
- Scenario E3: Multiple events fire simultaneously (e.g., engagement declining + sentiment negative) -> all events are included; actions are deduplicated.

## Functional Requirements
- FR-1: The system should define `SignalEvent` schema: `{ type: string, timestamp: number, details: Record<string, unknown> }`.
- FR-2: The system should define `SignalAction` schema: `{ type: string, priority: "low" | "medium" | "high", reason: string }`.
- FR-3: The system should replace `z.any()` in `signal_events` and `signal_actions` arrays with the typed schemas.
- FR-4: The system should provide `detectSignalEvents(history: SignalTurnRecord[], currentScores: {...}): SignalEvent[]`.
- FR-5: Event types supported: `engagement_declining` (3+ consecutive drops), `sentiment_shift_negative` (drop from >0.6 to <0.3), `user_rushing` (2+ consecutive low intent), `high_trust_moment` (trust > 0.85), `sentiment_recovery` (rise from <0.3 to >0.6).
- FR-6: The system should provide `suggestSignalActions(events: SignalEvent[]): SignalAction[]`.
- FR-7: Action types supported: `slow_down_pacing`, `offer_clarification`, `skip_optional_questions`, `increase_empathy`.
- FR-8: The orchestrator should call `detectSignalEvents` and `suggestSignalActions` after computing EMA scores, and include results in the `SignalOrchestratorResult`.
- FR-9: When no events are detected, `signal_events` and `signal_actions` should be empty arrays (not null or undefined).
- FR-10: Actions should be deduplicated — the same action type should not appear twice in a single turn's output.

## Possible Edge Cases
- History with exactly 3 entries where all engagement scores are identical (no decline — no event)
- Sentiment oscillating rapidly (0.7, 0.2, 0.7, 0.2) — should not produce continuous events
- Intent scores not yet present in older history entries (backward compatibility with pre-Phase-3 data)
- Very first turn after Phase 6 deployment (history may contain entries without intent)

## Acceptance Criteria
- AC-1: 3 consecutive engagement drops produce `engagement_declining` event -> pass
- AC-2: Stable scores produce no events -> pass
- AC-3: Each event type maps to at least one action -> pass
- AC-4: `signal_events` and `signal_actions` are typed arrays, not `z.any()` -> pass
- AC-5: Multiple simultaneous events produce deduplicated actions -> pass
- AC-6: History with fewer than 3 entries produces no trend-based events -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success -> "declining engagement history produces event and action"
  - Variation A -> "sharp sentiment drop produces event"
  - Variation E -> "stable scores produce empty events/actions"
  - Failure E1 -> "short history produces no trend events"
  - Failure E3 -> "multiple events produce deduplicated actions"
- Acceptance traceability:
  - AC-1 -> Unit test: fabricated history with 3 declining engagement values
  - AC-2 -> Unit test: fabricated history with stable values
  - AC-3 -> Unit test: each event type through `suggestSignalActions`
  - AC-4 -> Type check: `signal_events` schema is `z.array(SignalEventSchema)`
  - AC-5 -> Unit test: two events that suggest the same action
  - AC-6 -> Unit test: history with 0, 1, 2 entries
- Regression checks:
  - Orchestrator output structure is still valid SignalOrchestratorResult
  - Empty history still produces empty arrays (backward compatible)
  - Signal history recording is unaffected
  - EMA and composite scoring are unaffected

## Dependencies and Constraints
- Dependencies:
  - Phase 3 (intent agent) — `user_rushing` event requires intent scores in history
  - Phase 4 (dynamic confidence) — confidence-weighted scores improve event detection accuracy
  - Phase 5 (rich sentiment) — graduated sentiment enables meaningful threshold-based event detection
- Constraints:
  - Event detection must be deterministic and fast (iterate history array, no LLM)
  - Events are informational — they do not autonomously alter the conversation flow (routing rule integration is a separate concern)
  - Must not modify signal_history entries (read-only analysis)

## Out of Scope
- Routing rule integration (consuming events to alter flow) — this is a flow authoring concern, not a signal agent concern
- Persistent event storage (events are per-turn, stored in relationship_context)
- User-facing display of events or actions
- Configurable event thresholds via YAML (hardcoded thresholds in initial implementation; can be made configurable later)

## Open Questions
- Should event thresholds (e.g., 3 consecutive drops, 0.6/0.3 sentiment boundaries) be configurable via the YAML `signalAgents` config block, or hardcoded initially?
- ~~Should events accumulate across turns (append to existing array) or represent only the current turn's detections?~~ **Resolved: Accumulate, capped at 50 entries.** Events and actions are appended to previous arrays each turn and trimmed via `.slice(-EVENTS_LIMIT)`.
- Should `signal_actions` include a `confidence` field reflecting how certain the system is about the recommendation?
