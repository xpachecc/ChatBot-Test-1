# Spec for Chatbot Experience Enhancements

feature_slug: chatbot-experience-enhancements  
screen_comp (if available): Chat Window Screen

## Intent and Desired Outcomes
- Business intent: Improve completion quality and user confidence by making the conversation more guided, visually progress-aware, and easier to answer.
- User problem: The current chat experience lacks integrated answer affordances and clear major-step progress context.
- Desired outcomes:
  - Users can respond faster using embedded single-select answer buttons while retaining manual typing.
  - Users can see where they are in the major conversation flow, what is done, and what remains.
  - Conversation metadata (title/description/step progress definitions) is graph-configurable and reusable.
- Success metrics (observable):
  - At least 95% of backend-published option sets render in the input-embedded button tray when provided.
  - Side progress pane state transitions (in progress/completed/upcoming) are accurate across all major steps in one full end-to-end conversation.
  - For countable steps, displayed percentage matches backend totals and answered counts with no off-by-one errors in QA scenarios.

## Summary
The feature adds two UX augmentations to the chatbot infrastructure: input-embedded predetermined single-select buttons and a left-side major-step progress pane. The backend publishes explicit flow metadata for title, description, major steps, and countability/progress totals, while the frontend renders status, percentages, and question counts from that contract. Success means users can either click or type naturally, perceive clear selection/hover state, and always understand their location in the conversation journey.

## Scenario Coverage
### Primary Success Scenario
- Given a user starts a conversation where the backend marks step metadata and publishes options for the current prompt
- When the user sees the current question
- Then the input area shows selectable buttons above the text entry control, clicking a button submits immediately, and the side pane shows the current major step as IN PROGRESS with accurate percent/count (if countable)

### Variation Scenarios
- Scenario A: No options for a prompt
  - The input remains fully usable for manual text only; no button tray is rendered.
- Scenario B: A major step is not countable
  - The side pane renders status for that step but hides percentage and question-count details for that step.
- Scenario C: User chooses manual input even when buttons exist
  - Manual send behaves unchanged and remains first-class.

### Failure / Edge Scenarios
- Scenario E1: Backend omits flow metadata
  - Frontend falls back to safe defaults (no pane or minimal pane) without breaking chat send/receive.
- Scenario E2: Backend reports invalid counts (e.g., answered > total)
  - Frontend clamps display safely and logs non-fatal diagnostics; conversation continues.
- Scenario E3: Rapid repeated button click attempts
  - Single-select behavior accepts one click, disables further selection for that prompt, and submits once.

## Functional Requirements
- FR-1: The system should render predetermined answer buttons inside the chat input region (above text input) when `options.items` exists for the current turn.
- FR-2: The user can either click one single-select button (immediate submit) or manually type and send a custom answer.
- FR-3: The system should provide clear hover and selected visual states for each option button, plus keyboard-accessible focus states.
- FR-4: The system should enforce single-select interaction per option set (no multi-select).
- FR-5: The backend should return graph-level UI metadata for the active flow, including flow title and short description.
- FR-6: The backend should return major-step progress metadata derived from graph step definitions, including order, labels, status, and countability fields.
- FR-7: The side navigation pane should display:
  - Conversation title (top)
  - Conversation short description (below title)
  - Ordered major steps with visual states: completed (green check), current (blue + IN PROGRESS), upcoming (gray)
- FR-8: For countable steps only, the system should show percentage and question count in the pane; non-countable steps should hide both.
- FR-9: Percentage should compute as `(answered_questions / total_questions) * 100`, rounded to whole percent, and use answered questions only (not current unanswered question).
- FR-10: Existing conversation behavior (message rendering, typing, send flow, error handling, and download link flow) should remain unchanged outside the new augmentations.

## Screen Composite Design Reference (only if referenced)
- File: `_specs/Chat Window Screen.png`
- Component name: Chat Window Screen
- Key visual constraints:
  - Predetermined answer buttons appear inside the input area container above the text field.
  - Side pane appears left of the main chat panel and includes title, description, and step statuses.
  - Current step is blue with "IN PROGRESS", completed step is green with check icon, upcoming step is gray.

## Possible Edge Cases
- Option labels are long and require wrapping or truncation without breaking selection affordance.
- A step becomes complete on transition boundary during the same backend response.
- Countable step with zero total questions should avoid division-by-zero and hide/normalize percentage.
- Browser keyboard navigation should allow focus and activation for buttons and send control.
- Responsive layout on narrower widths may need side pane collapse behavior.

## Acceptance Criteria
- AC-1: When backend sends `options.items`, options are rendered in the input region and clicking an option submits immediately once.
- AC-2: When backend sends no options, no option tray appears and user can still type and send normally.
- AC-3: While hovering/focusing option buttons, a distinct interactive state is visible; after selection, selected/disabled state is visually obvious and prevents duplicate submissions.
- AC-4: Side pane displays flow title + short description from backend-provided flow metadata.
- AC-5: Side pane major-step statuses are accurate: prior steps completed, current step in progress, future steps upcoming.
- AC-6: For countable steps, percentage and count text are shown and mathematically correct; for non-countable steps, both are hidden.
- AC-7: Manual typed answers remain valid even when options are present.

## Testing Guidelines
Define the minimum verification set to prove correctness:

- Scenario coverage map:
  - Primary success scenario -> End-to-end chat turn test with options + progress metadata update.
  - Variation scenario(s) -> (a) no-options turn, (b) non-countable step, (c) manual input while options visible.
  - Failure/edge scenario(s) -> invalid counts, repeated clicks, long labels, zero-question step.

- Acceptance traceability:
  - AC-1/AC-2/AC-7 -> Frontend integration tests for chat input + option interaction.
  - AC-3 -> UI behavior tests (hover/focus/selected/disabled state assertions).
  - AC-4/AC-5/AC-6 -> Contract + rendering tests using backend progress payload fixtures.

- Regression checks:
  - Existing `/chat` message flow still returns AI response/options/download unchanged.
  - Existing step routing and state transitions continue working for current graph flow.

## Dependencies and Constraints
- Dependencies:
  - Frontend rendering logic in `templates/chatbot1/js/chat.js`
  - Frontend layout/styling in `templates/chatbot1/css/styles.css` and `templates/chatbot1/index.html`
  - Backend payload contract in `src/server.ts`
  - Graph step and metadata source in `src/langgraph/flows/stepFlowConfig.ts`, `src/langgraph/state.ts`, and related step nodes
- Constraints:
  - Single-select buttons only for v1.
  - No frontend framework introduction; remain plain HTML/JS/CSS.
  - Progress source must be backend-defined metadata (not inferred solely on frontend).

## Out of Scope
- Multi-select options or checkbox-style responses.
- Replacing current chat architecture or migrating to SPA framework.
- Changing readout generation behavior beyond required progress metadata exposure.

## Open Questions
- None blocking for v1 based on confirmed decisions:
  - Option click behavior: immediate submit.
  - Progress source: backend-defined metadata.
