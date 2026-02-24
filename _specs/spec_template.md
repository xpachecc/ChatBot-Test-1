# Spec for <feature_title>

feature_slug: <feature_slug>  
screen_comp (if available): <screen-component-name>

## Intent and Desired Outcomes
- Business intent: <what this feature should achieve>
- User problem: <pain point being solved>
- Desired outcomes:
  - <outcome 1>
  - <outcome 2>
- Success metrics (observable):
  - <metric + target>
  - <metric + target>

## Summary
<2-4 sentences describing context, feature intent, and what success looks like.>

## Scenario Coverage
### Primary Success Scenario
- Given <starting context>
- When <user action / trigger>
- Then <expected successful outcome>

### Variation Scenarios
- Scenario A: <valid alternate path and expected outcome>
- Scenario B: <valid alternate path and expected outcome>

### Failure / Edge Scenarios
- Scenario E1: <failure or ambiguity condition> -> <expected safe behavior>
- Scenario E2: <failure or ambiguity condition> -> <expected safe behavior>

## Functional Requirements
- FR-1: The system should <behavior tied to scenario/outcome>.
- FR-2: The user can <capability>.
- FR-3: The system should <error handling or fallback behavior>.
- FR-4: The system should not <out-of-scope/unsupported behavior, if relevant>.

## Screen Composite Design Reference (only if referenced)
- File: <design file name>
- Component name: <component or frame name>
- Key visual constraints:
  - <constraint 1>
  - <constraint 2>

## Possible Edge Cases
- <edge case 1>
- <edge case 2>
- <edge case 3>

## Acceptance Criteria
- AC-1: <observable condition> -> <pass/fail expectation>
- AC-2: <observable condition> -> <pass/fail expectation>
- AC-3: <observable edge/failure condition> -> <expected behavior>
- AC-4: <non-functional or UX expectation, if relevant>

## Testing Guidelines
Define the minimum verification set to prove correctness:

- Scenario coverage map:
  - Primary success scenario -> <test name/description>
  - Variation scenario(s) -> <test name/description>
  - Failure/edge scenario(s) -> <test name/description>

- Acceptance traceability:
  - AC-1 -> <verification method>
  - AC-2 -> <verification method>
  - AC-3 -> <verification method>

- Regression checks:
  - <adjacent flow/behavior that must still work>
  - <adjacent flow/behavior that must still work>

## Dependencies and Constraints
- Dependencies:
  - <dependency 1>
  - <dependency 2>
- Constraints:
  - <constraint 1>
  - <constraint 2>

## Out of Scope
- <explicitly excluded item 1>
- <explicitly excluded item 2>

## Open Questions
- <decision-needed question 1>
- <decision-needed question 2>