# Spec for YAML DSL Simplification

feature_slug: yaml-dsl-simplification  
screen_comp (if available): N/A

## Intent and Desired Outcomes
- Business intent: Reduce the size and complexity of `flow.yaml` so that conversation flows are faster to author, review, and maintain — without losing any existing runtime functionality.
- User problem: The current `flow.yaml` is 873 lines. Roughly 40% is long-form content (prompts, strings, templates) mixed into topology definitions. Another ~10% is dead fields never consumed by the runtime. Routing rules repeat a mechanical pattern 10 times. Static transitions repeat a default `-> __end__` edge 15 times. This makes the file hard to scan, error-prone to edit, and intimidating for new contributors.
- Desired outcomes:
  - `flow.yaml` compresses from ~873 lines to ~400-450 lines of core topology and configuration
  - Long-form content (AI prompts, UI strings, templates) lives in a single dedicated sibling content file editable independently
  - Repetitive routing and transition patterns are expressed as compact shorthands the compiler expands
  - Dead/documentary-only fields are removed from the YAML (retained as optional in the Zod schema)
  - A `schemaVersion` field is introduced for future evolution; all flows ship with a version from the start
- Success metrics (observable):
  - `flow.yaml` line count <= 450 after all phases
  - All 28+ existing test suites pass after each phase
  - `graphParity.test.ts` confirms the compiled StateGraph (node set, edge set) is identical before and after
  - No runtime behavior change in dev server manual conversation walkthrough

## Summary
The GraphDSL `flow.yaml` has grown to 873 lines by accumulating long-form AI prompts, UI copy, dead schema fields, and repetitive boilerplate patterns. This spec defines a four-phase simplification: (1) remove dead fields, (2) extract content to a single companion file via a `$file` reference mechanism, (3) add routing and transition shorthands that the compiler expands, and (4) introduce schema versioning with node defaults and consolidated progress rules. Each phase is independently shippable. Since there are no production schemas today, all flows will ship with a version from the start — no backward-compatibility shim for version-less files is needed. Success means the same compiled graph, fewer lines, and a clearer separation between topology, logic, and content.

## Scenario Coverage

### Primary Success Scenario
- Given: the current `flow.yaml` (873 lines) and all passing tests
- When: all four phases are applied sequentially, with tests run after each
- Then: `flow.yaml` is ~400-450 lines; `flow-content.yaml` holds all extracted content (prompts, strings, templates) in a structured hierarchy; the compiled LangGraph StateGraph has identical nodes and edges; all tests pass; a full conversation in the dev server behaves identically

### Variation Scenarios
- Scenario A: A new flow is authored from scratch using v2 conventions -> the author benefits from `$file` refs, `awaitingDispatch`, omitted destinations, and omitted `-> __end__` transitions; the compiler expands these into a valid graph
- Scenario B: All content (prompts, strings, templates, clarifier text, acknowledgements) lives in a single `flow-content.yaml` file -> the `$file` ref resolves the whole file as a structured object, and each config key picks its section from the hierarchy
- Scenario C: `expandAutoIngest` generates synthetic ingest nodes that need destinations -> the `expandDestinations` pass runs after `expandAutoIngest` and picks up auto-ingest gotos in the destination map

### Failure / Edge Scenarios
- Scenario E1: A `$file` reference points to a non-existent file -> `resolveFileRefs` throws a clear error with the missing path and the location in the YAML where it was referenced
- Scenario E2: A `$file` reference creates a circular inclusion (A refs B, B refs A) -> `resolveFileRefs` detects the cycle and throws an error listing the inclusion chain
- Scenario E3: A conditional transition has no `destinations` and no `routingRules` for its `from` node -> `preflight` throws an error: "Conditional transition for node X has no destinations and no routing rules to derive them from"
- Scenario E4: A routing rule `goto` target references a node that does not exist -> `preflight` catches this as it does today (destination not a declared node)

## Functional Requirements

### Phase 1: Dead-Field Removal
- FR-1: Remove `config.steps` (the flat `StepDefSchema[]` array) from `flow.yaml`. Remove `StepDefSchema` type export and the `steps` field from `GraphConfigSchema` in `graph-dsl-types.ts`. The runtime uses `config.meta.steps` exclusively.
- FR-2: Remove `runtimeConfigRefs.modelAliases` value from `flow.yaml`. Keep the field in the Zod schema as `.optional().default({})` so template YAMLs that include it do not fail validation.
- FR-3: Remove the `routingKeys` array from `flow.yaml`. Keep as `.optional().default([])` in Zod schema.
- FR-4: Remove `validation.invariants` from `flow.yaml`. Keep as `.optional().default([])` in Zod schema.
- FR-5: For nodes that have both `intent` and `description`, remove `description` (keeping `intent`, which is validated by `preflightRoutingValidation`). For nodes that have only `description` (no `handlerRef` and thus no `intent` requirement), keep `description`.

### Phase 2: Content Extraction via `$file` References
- FR-6: Implement `resolveFileRefs(parsed, basePath)` in `graph-loader.ts`. It recursively walks the parsed YAML object. Any value that is an object with exactly one key `$file` whose value is a string is replaced with the parsed contents of that file (resolved relative to `basePath`). The referenced file is read and parsed as YAML.
- FR-7: `resolveFileRefs` must track visited file paths and throw on circular references.
- FR-8: `resolveFileRefs` must throw a descriptive error if a referenced file does not exist.
- FR-9: Create a single content companion file at `clients/default/flows/cfs-default/flow-content.yaml`. This file houses all long-form content in a structured hierarchy with top-level keys that mirror the `config` keys they replace:
  ```yaml
  # flow-content.yaml — content values for the flow schema
  aiPrompts:
    selectPersonaGroup: >- ...
    sanitizeUserInput: | ...
    # ... all prompt entries
  strings:
    step1.greet: "Welcome to Pure Storage!"
    # ... all string entries
  exampleTemplates:
    role: [...]
    industry: [...]
    # ...
  questionTemplates:
    - key: S2_CONFIRM_PLAN
      question: | ...
    # ...
  clarifierRetryText:
    step1Ready: "Please answer with yes or no."
    # ...
  clarificationAcknowledgement:
    - "Thank you for the clarification."
    # ...
  ```
- FR-10: In `flow.yaml`, replace each extracted config key with a `$file` reference pointing to the single content file. The `$file` resolver returns the parsed YAML object, and each config key receives its corresponding section:
  ```yaml
  config:
    aiPrompts:        { $file: "./flow-content.yaml#aiPrompts" }
    strings:          { $file: "./flow-content.yaml#strings" }
    exampleTemplates: { $file: "./flow-content.yaml#exampleTemplates" }
    questionTemplates:           { $file: "./flow-content.yaml#questionTemplates" }
    clarifierRetryText:          { $file: "./flow-content.yaml#clarifierRetryText" }
    clarificationAcknowledgement: { $file: "./flow-content.yaml#clarificationAcknowledgement" }
  ```
- FR-11: The `$file` reference supports an optional `#fragment` suffix. When present, `resolveFileRefs` parses the target YAML file, then navigates to the top-level key named by the fragment and returns only that value. Without a fragment, the entire parsed file contents replace the `$file` object. This allows a single file to serve multiple config keys while keeping each `$file` ref self-describing.
- FR-12: The `loadGraphDsl` pipeline becomes: parseYaml -> resolveFileRefs -> GraphDslSchema.parse. The `loadAndCompile` pipeline is unchanged downstream.

### Phase 3: Routing and Transition Shorthands
- FR-13: Add an `awaitingDispatch` field as an optional `Record<string, string>` within routing rule entries. Each entry maps a `last_question_key` to a target node. The compiler expands each entry into `{ when: { awaiting_user: true, last_question_key: KEY }, goto: TARGET }` and inserts these rules before the `default` rule.
- FR-14: Implement `expandAwaitingDispatch(dsl)` as a pre-compilation pass in `graph-compiler.ts`. It mutates nothing on the input; it returns a new DSL object with expanded rules.
- FR-15: When a conditional transition does not specify `destinations` and the compiler finds `routingRules` for its `from` node, auto-generate the destinations map as the union of all `rule.goto` and `rule.default` values, identity-mapped, plus `{ end: "__end__" }`.
- FR-16: Implement `expandDestinations(dsl)` in `graph-compiler.ts`. It runs after `expandAwaitingDispatch` and `expandAutoIngest` (so all synthetic rules are present). If `destinations` is already provided, it is not modified.
- FR-17: Nodes of kind `question`, `ingest`, `compute`, or `integration` that do not appear as `from` in any static transition automatically receive `{ from: nodeId, to: "__end__" }`. Router nodes and nodes that already have a static transition are skipped.
- FR-18: Implement `expandDefaultTransitions(dsl)` in `graph-compiler.ts`. It runs after `expandDestinations`.
- FR-19: Make `ConditionalTransitionSchema.destinations` optional (`.optional()`) in `graph-dsl-types.ts`.

### Phase 4: Schema Versioning and Node Defaults
- FR-20: Add `schemaVersion` as a required top-level field in `GraphDslSchema`. Since there are no production schemas today, all flows must specify a version from the start. The CFS flow YAML is set to `schemaVersion: 2`. The `template_flow.yaml` is also updated.
- FR-21: The `compileGraphFromDsl` pipeline applies all v2 expansions (`expandAwaitingDispatch`, `expandDestinations`, `expandDefaultTransitions`, progress rules flattening) when `schemaVersion >= 2`. The `resolveFileRefs` pass runs for all versions (it is a loader concern, not a compiler concern).
- FR-22: Remove `reads` and `writes` arrays from nodes in `flow.yaml` where they are not providing information beyond the kind default. The Zod schema already defaults both to `[]`; no schema change needed.
- FR-23: Update `preflightRoutingValidation`'s `undeclared-state-field` check to skip nodes with empty `reads`/`writes` arrays.
- FR-24: Add optional `questionKeyMap: Record<string, number>` to `FlowStepMetaSchema`. When present on a step with `countingStrategy: questionKeyMap`, the compiler merges all per-step `questionKeyMap` entries into `progressRules.questionKeyMap` during `buildGraphMessagingConfigFromDsl`. The standalone `config.progressRules.questionKeyMap` is removed from `flow.yaml`.
- FR-25: The system should not alter runtime behavior for any schema version. All expansions are compile-time syntactic sugar that produce the same internal DSL structure.

## Possible Edge Cases
- A `$file` reference points to a YAML file that itself contains `$file` references (nested inclusion) -> `resolveFileRefs` supports this up to a configurable max depth (default 5), with cycle detection
- A `$file` reference resolves to a non-object/non-array value (e.g., a plain string) -> the resolved value replaces the `{ $file: ... }` object directly, which is valid for string-valued config keys
- An `awaitingDispatch` entry duplicates a question key that is also in the explicit `rules` list -> the expansion skips keys already present as `last_question_key` in existing `when` clauses
- `expandAutoIngest` generates a synthetic node and routing rule, then `expandDestinations` needs to include that synthetic node in the destinations map -> ordering guarantee: `expandAutoIngest` runs before `expandDestinations`
- A node has `kind: compute` but has a custom static transition to another node (not `__end__`) -> `expandDefaultTransitions` skips it because it already has a static `from` entry
- `template_flow.yaml` is updated to include `schemaVersion` (may use v1 or v2 conventions depending on whether it adopts shorthands)
- A `$file` reference uses a `#fragment` that does not exist as a top-level key in the target file -> `resolveFileRefs` throws a descriptive error naming the missing fragment and the target file

## Acceptance Criteria
- AC-1: After Phase 1, `flow.yaml` has no `config.steps` flat array, no `routingKeys`, no `validation.invariants` value, no `runtimeConfigRefs.modelAliases` value -> all tests pass
- AC-2: After Phase 2, `flow.yaml` has `$file` references pointing to `flow-content.yaml#<section>` for aiPrompts, strings, exampleTemplates, questionTemplates, clarifierRetryText, and clarificationAcknowledgement -> `loadGraphDsl(CFS_YAML)` returns an identical DSL object as before extraction -> all tests pass
- AC-3: After Phase 2, missing `$file` target -> `loadGraphDsl` throws error with file path in message
- AC-4: After Phase 2, circular `$file` -> `loadGraphDsl` throws error mentioning cycle
- AC-5: After Phase 3, `flow.yaml` conditional transitions for `routeInitFlow` have no explicit `destinations` block -> the compiled graph has the same conditional edge map as before -> `graphParity.test.ts` passes
- AC-6: After Phase 3, `flow.yaml` static transitions list only 5 override entries (not 20) -> the compiled graph has the same static edge set as before
- AC-7: After Phase 3, `routeInitFlow` routing rules use `awaitingDispatch` map instead of 10 individual `when` clauses -> `evaluateRoutingRules` produces the same routing decisions for all state combinations
- AC-8: After Phase 4, `schemaVersion: 2` is present in `flow.yaml` and `template_flow.yaml` -> v2 expansions are applied -> compiled graph is identical
- AC-9: `schemaVersion` is a required field -> a YAML without it fails Zod validation with a clear error message
- AC-10: After Phase 4, `config.progressRules.questionKeyMap` is absent; per-step `questionKeyMap` is present -> `buildGraphMessagingConfigFromDsl` produces the same `progressRules` as before
- AC-11: After all phases, `flow.yaml` line count is <= 450
- AC-12: After all phases, full conversation walkthrough in dev server behaves identically

## Testing Guidelines

- Scenario coverage map:
  - Primary success (full pipeline) -> `graphParity.test.ts` (existing) — confirms identical compiled graph
  - Phase 1 dead-field removal -> update `graphParity.test.ts` to confirm DSL loads without removed fields
  - Phase 2 file refs -> new `fileRef.test.ts` — tests resolveFileRefs: happy path, missing file, circular ref, nested refs, non-object value
  - Phase 2 extraction -> `graphParity.test.ts` — DSL object identity after extraction
  - Phase 3 awaiting dispatch -> new `routingShorthands.test.ts` — tests expandAwaitingDispatch expansion, duplicate key skip
  - Phase 3 auto-derive destinations -> `routingShorthands.test.ts` — tests expandDestinations with and without explicit destinations
  - Phase 3 default transitions -> `routingShorthands.test.ts` — tests expandDefaultTransitions with override preservation
  - Phase 4 schema version -> `graphParity.test.ts` — v2 gating, missing schemaVersion rejection
  - Phase 4 progress consolidation -> `graphParity.test.ts` — per-step questionKeyMap flattening

- Acceptance traceability:
  - AC-1 -> `npm test` full suite + manual YAML inspection
  - AC-2 -> `graphParity.test.ts` DSL object deep-equal
  - AC-3 -> `fileRef.test.ts` missing file scenario
  - AC-4 -> `fileRef.test.ts` circular ref scenario
  - AC-5 through AC-7 -> `routingShorthands.test.ts` + `graphParity.test.ts`
  - AC-8 -> `graphParity.test.ts` version gating tests
  - AC-9 -> `graphParity.test.ts` missing schemaVersion rejection test
  - AC-10 -> `graphParity.test.ts` progress rules comparison
  - AC-11 -> `wc -l flow.yaml` after all phases
  - AC-12 -> manual dev server walkthrough

- Regression checks:
  - `autoIngest.test.ts` — synthetic ingest nodes still generated correctly
  - `genericHandlers.test.ts` — generic handler factories still resolve from nodeConfig
  - `preflight-routing.test.ts` — preflight validations still fire on invalid graphs
  - `stepFlow.test.ts`, `roleConfirmLoop.test.ts`, `askUseCaseQuestions.test.ts` — conversation flow tests still pass
  - `buildReadout.test.ts` — readout generation still works with extracted prompts
  - `newInfrastructure.test.ts` — `configString` still resolves from extracted strings

## Dependencies and Constraints
- Dependencies:
  - Existing `yaml` npm package (already installed) for parsing extracted YAML files
  - Node.js `fs.readFileSync` and `path.dirname`/`path.resolve` for file resolution
  - All existing test infrastructure (Jest, ts-jest ESM preset)
- Constraints:
  - Each phase must independently pass all tests before the next begins
  - No runtime behavior change — all changes are compile-time syntactic sugar
  - No backward-compatibility shim needed: there are no production schemas today, so all flows will include `schemaVersion` from the start
  - The `$file` resolver must not support arbitrary filesystem traversal outside the flow directory (relative paths only, no `..` beyond the flow root)
  - `graph-compiler.ts` is already ~645 lines; new expansion functions should be extracted to a `graph-expansions.ts` module if they push the file past 300 lines of new code

## Out of Scope
- Rewriting existing custom handler TypeScript code
- Changing the runtime `runTurn` lifecycle or state management
- Adding a full JSON Schema `$ref` implementation (only simple `$file` for whole-value replacement)
- Localization/i18n support for extracted strings (future consideration)
- Visual tooling or GUI for editing the simplified YAML
- Multi-flow composition (importing node groups across flows)
- Changing the LangGraph StateGraph channel definitions or state shape

## Open Questions
- Q1: ~~Should `$file` support fragment syntax?~~ **Resolved: Yes.** `$file: "./flow-content.yaml#aiPrompts"` extracts the `aiPrompts` key from the target file. This enables a single content file serving multiple config keys.
- Q2: For Phase 3, should `expandDefaultTransitions` also apply to `terminal` kind nodes, or only to `question`, `ingest`, `compute`, and `integration`? **Current decision: skip `terminal` and `router` kinds.**
- Q3: Should the `schemaVersion` gate be a hard cutover (v2 expansions only run for v2+) or additive (each expansion checks its own minimum version)? **Current decision: single gate at v2 for simplicity.** Per-expansion versioning deferred.
