# Spec for Signal Conversation Context

feature_slug: signal-conversation-context

## Intent and Desired Outcomes
- Business intent: Improve signal agent accuracy by providing conversation context — the prior bot message, current question metadata, and recent message history — so agents can assess user responses relative to what was asked.
- User problem: Current agents analyze user text in isolation. A one-word "yes" to a confirmation prompt scores identically to a one-word "yes" to an open-ended discovery question, producing misleading engagement and intent signals.
- Desired outcomes:
  - Signal agents receive structured context about the current conversation exchange
  - Engagement scoring accounts for question type (yes/no vs. open-ended)
  - Sentiment scoring can detect shifts relative to the conversational context
  - Trust scoring can check consistency against prior exchanges
- Success metrics (observable):
  - Short affirmative to a yes/no question scores higher engagement than the same response to an open-ended question
  - Agents that receive context produce more differentiated scores across conversation scenarios than context-free agents

## Summary
Signal agents currently receive only the raw user text string. This phase introduces a `SignalContext` type that bundles the user text with the last bot message, the current `questionKey` and `questionPurpose` from session context, and the last 2–3 message pairs. The orchestrator constructs this context from `CfsState` and passes it to all agents. Extractors are updated to use question metadata for response-length expectations, sentiment comparison, and consistency checking.

## Scenario Coverage

### Primary Success Scenario
- Given a user answers "yes" to a confirmation question (questionPurpose: "confirm")
- When the engagement agent receives the SignalContext with questionPurpose
- Then the engagement score reflects that a short affirmative is appropriate for this question type (high engagement, not low)

### Variation Scenarios
- Scenario A: User gives a one-word answer to an open-ended discovery question -> engagement score is lower because elaboration is expected for this question type.
- Scenario B: User provides a long, detailed response to any question -> engagement score is high regardless of question type (elaboration always signals engagement).
- Scenario C: No questionKey or questionPurpose available in session_context (e.g., first message or router node) -> agents fall back to current context-free behavior; no crash or error.

### Failure / Edge Scenarios
- Scenario E1: Messages array is empty or contains only HumanMessages (no prior bot message) -> lastBotMessage is null; agents use fallback scoring.
- Scenario E2: questionPurpose is an unexpected/unknown value -> agents treat it as the generic default; no special weighting applied.

## Functional Requirements
- FR-1: The system should define a `SignalContext` type with fields: `userText`, `lastBotMessage` (nullable), `questionKey` (nullable), `questionPurpose` (nullable), `priorPairs` (array of {bot, user} message text pairs, max 3).
- FR-2: The signal orchestrator should construct `SignalContext` from `CfsState.messages` and `session_context.last_question_key` before passing to agents.
- FR-3: All agent signatures (`runEngagementAgent`, `runSentimentAgent`, `runTrustAgent`) should accept `SignalContext` instead of a bare `text` string.
- FR-4: `extractEngagementFeatures` should adjust response-length expectations based on `questionPurpose` — short responses to confirmation/selection questions should not penalize engagement.
- FR-5: `extractSentimentFeatures` should use the prior bot message for context when available (e.g., detecting whether the user's tone shifted relative to the conversation).
- FR-6: `extractTrustFeatures` should use `priorPairs` for basic consistency checking when available.
- FR-7: When context fields are null or unavailable, agents should fall back to current context-free behavior with no errors.

## Possible Edge Cases
- First turn of conversation (no prior messages, no questionKey)
- Messages array contains only system messages or non-standard message types
- questionKey exists but no matching questionPurpose is derivable
- Very long prior bot messages (should be truncated or summarized for context)
- priorPairs from a different conversation step (after a router transition)

## Acceptance Criteria
- AC-1: "yes" + questionPurpose "confirm" produces higher engagement than "yes" + questionPurpose "collect_industry" -> pass
- AC-2: Agents produce valid scores when all SignalContext optional fields are null -> pass
- AC-3: SignalContext is constructed from CfsState without requiring any new state fields -> pass
- AC-4: Existing agent tests updated with SignalContext pass without behavior regression for context-free scenarios -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success -> "short affirmative to confirm question scores high engagement"
  - Variation A -> "short answer to open question scores low engagement"
  - Variation C -> "null context fields produce valid fallback scores"
  - Failure E1 -> "empty messages array produces null lastBotMessage, agents still return scores"
- Acceptance traceability:
  - AC-1 -> Unit test comparing engagement scores for same text with different questionPurpose
  - AC-2 -> Unit test with all-null optional fields
  - AC-3 -> Integration test: SignalContext built from real CfsState
  - AC-4 -> Regression: run existing fixture suite through updated agents
- Regression checks:
  - All 15 existing validation fixtures produce scores in [0, 1]
  - Orchestrator aggregation and EMA still work correctly
  - No changes to relationship_context schema

## Dependencies and Constraints
- Dependencies:
  - Phase 1 (deferred merge) must be complete — agents now run in fire-and-forget mode
  - `session_context.last_question_key` must be reliably set by question and ingest nodes
  - Question purpose mapping must be derivable from the flow's question configuration
- Constraints:
  - Must not add latency to signal computation (context construction is pure data extraction from state)
  - Must be backward compatible — agents that receive minimal context behave like current agents

## Out of Scope
- LLM-based contextual analysis (covered by Phase 7)
- Tracking question purpose in a new state field (use existing `last_question_key` and flow config)
- Changes to how questions are asked or displayed

## Open Questions
- Should `questionPurpose` be derived from the flow YAML `questionPurpose` field at runtime, or should it be inferred from the `questionKey` naming convention?
- How many prior message pairs should be included — 2 or 3? Is there a performance concern with extracting more?
