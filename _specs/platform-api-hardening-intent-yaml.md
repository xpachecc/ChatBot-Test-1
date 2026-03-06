# Spec for Platform API Hardening and Intent-Driven YAML

feature_slug: platform-api-hardening-intent-yaml  
screen_comp (if available): N/A

## Intent and Desired Outcomes
- Business intent: Establish a clean, versioned boundary between the reusable platform infrastructure and per-flow custom handlers, then transform the YAML authoring experience so a human expresses intent ("ask the user their name and save it") rather than implementation details (separate question node, ingest node, routing rules, transitions, field mappings).
- User problem: Today, authoring a conversation flow in YAML requires understanding internal state management (`reads`/`writes` arrays), manually pairing question and ingest nodes, hand-writing routing predicates for every question-ingest cycle, and using opaque `handlerRef` strings with no explanation of what they do. Custom handler code lives inside the platform, creating coupling between reusable infrastructure and flow-specific logic.
- Desired outcomes:
  - Platform and flow code are structurally separated with a versioned API boundary
  - Flow handlers live alongside their flow YAML, not inside platform code
  - The YAML schema supports intent-driven authoring: inferred `reads`/`writes`, auto-generated question-ingest pairs, auto-generated routing rules for question chains
  - Custom `handlerRef` nodes carry human-readable `intent` annotations
  - The existing CFS flow continues to work identically after all changes (zero regression)
  - Conventions, checklists, and templates guide future flow authors
- Success metrics (observable):
  - CFS `flow.yaml` is simplified: at least 2 question-ingest pairs converted to `autoIngest` with fewer total YAML lines
  - All 25 existing test suites pass after every change
  - Multi-turn functional parity test confirms intent-driven YAML produces identical conversation behavior to the original explicit YAML
  - `flow-isolation.test.ts` enforces the import boundary rule
  - `preflight-routing.test.ts` validates compile-time routing checks

## Summary

The platform currently mixes reusable infrastructure with CFS-specific handler code, and the YAML authoring experience requires the human to specify implementation details that the compiler could infer. This feature separates the platform from flow implementations via a versioned barrel API, moves handler registration to the flow directory, adds compile-time graph validation, and introduces intent-driven YAML features (inferred reads/writes, autoIngest, auto-generated routing rules, intent annotations). The work is split into Phase 0 (structural foundation) and Phase 1 (intent-driven YAML). Success means a flow author can express "ask this question and save the answer here" in a single YAML block, the compiler handles the rest, and the existing CFS conversation works identically throughout.

## Scenario Coverage

### Primary Success Scenario
- Given a flow author creates a question node with `autoIngest: { saveTo: "user_context.first_name", sanitizeAs: "name", then: askIndustry }`
- When the compiler processes the flow YAML
- Then it auto-generates the ingest node, routing rules (awaiting_user -> ingest, after-ingest -> next question), static transition, and field mapping — and the conversation works identically to a manually-paired question/ingest configuration

### Variation Scenarios
- Scenario A: A flow author omits `reads` and `writes` from a generic question node. The compiler infers them from the node kind and config. The flow compiles and behaves identically to one with explicit reads/writes.
- Scenario B: A flow author uses `autoIngest` for some question nodes and explicit question/ingest pairs for others (mixed mode). Both patterns work correctly in the same flow.
- Scenario C: A flow author adds `intent: "Use AI to determine use cases"` to a `handlerRef` node. The YAML is human-readable end-to-end. Preflight emits no warning for this node.
- Scenario D: A flow author creates a new flow using the `_templates/flow-scaffold/` template. The scaffold compiles, the custom handler imports only from the barrel, and the flow-isolation test passes.
- Scenario E: A flow handler file under `clients/` imports from the platform barrel (`infra.ts`). The flow-isolation test passes.
- Scenario F: After handler files are moved to the flow directory, all 25 existing test suites pass with updated import paths.
- Scenario G: A flow author defines a compute node with `nodeConfig.aiCompute` specifying a model alias, prompt key, input fields, and output path. The compiler creates the handler automatically and the node produces the correct AI-driven state patch.
- Scenario H: A flow author defines a compute node with `nodeConfig.vectorSelect` specifying a document type, selection prompt, and output path. The compiler creates the handler automatically and the node retrieves, selects, and writes the result to state.

### Failure / Edge Scenarios
- Scenario E1: A `handlerRef` node has no `intent` annotation -> Preflight emits a warning (not an error). Flow still compiles.
- Scenario E2: A node's explicit `reads`/`writes` differ from what inference would produce -> Explicit values take precedence. No warning emitted.
- Scenario E3: An `autoIngest` references a `then` target that does not exist as a node ID -> Preflight emits an error (node not found in transitions).
- Scenario E4: A flow handler imports from another flow's `handlers/` directory -> `flow-isolation.test.ts` fails.
- Scenario E5: A flow handler imports from a deep platform path (e.g., `core/services/ai/invoke.js`) instead of the barrel -> `flow-isolation.test.ts` fails.
- Scenario E6: A node declares `writes: [readout_context]` but the flow does not declare `readout_context` in `stateExtensions` -> Preflight emits a warning.
- Scenario E7: An `autoIngest` question node also has an explicit separate ingest node for the same `questionKey` -> The explicit ingest node takes precedence; `autoIngest` expansion is skipped for that question key.
- Scenario E8: A routing rule auto-generated by `autoIngest` conflicts with an explicit routing rule for the same condition -> The explicit rule takes precedence.

## Functional Requirements

### Phase 0: Structural Foundation
- FR-1: The system should export a `PLATFORM_API_VERSION` constant from `infra.ts`.
- FR-2: The system should organize barrel file exports into labeled sections with JSDoc blocks explaining each category.
- FR-3: The system should surface all platform utilities used by custom handlers through the barrel file (no deep-path imports required).
- FR-4: CFS handler registration should live in `clients/default/flows/cfs-default/handlers/index.ts`, with `cfs-handlers.ts` delegating to it for backward compatibility.
- FR-5: The system should enforce that flow handler files only import from the platform barrel or the same flow's handlers directory.
- FR-6: `preflight()` should warn on: unreachable nodes, paths with no terminal exit, unpaired question nodes, and routing rule destination keys that no rule can produce.
- FR-7: The YAML schema should support an optional `stateExtensions` field declaring which state slices a flow uses beyond the base set.
- FR-8: `preflight()` should warn when a node's `reads`/`writes` reference state fields not in the base set or `stateExtensions`.
- FR-9: The system should provide handler templates in `_templates/` for common custom handler patterns.
- FR-10: The system should document the 80/20 platform philosophy and config block graduation criteria in `docs/config-block-graduation-checklist.md`.
- FR-11: The system should document flow isolation conventions in `clients/README.md`.

### Phase 1: Intent-Driven YAML
- FR-12: The system should infer `reads` and `writes` from node kind and config when the author does not provide them explicitly.
- FR-13: Explicit `reads`/`writes` should always override inferred values.
- FR-14: The system should support an `autoIngest` field on question node configs that auto-generates the corresponding ingest node, routing rules, static transition, and field mapping.
- FR-15: Auto-generated routing rules should merge before explicit rules; explicit rules take precedence on conflict.
- FR-16: The system should support an optional `intent` field on node definitions for human-readable purpose annotations.
- FR-17: `preflight()` should warn when a `handlerRef` node lacks an `intent` annotation.
- FR-18: The system should not change any runtime behavior of the existing CFS conversation flow.

### Phase 2: Handler File Move
- FR-19: CFS handler implementation files should be moved from `src/langgraph/core/nodes/cfs/` to `clients/default/flows/cfs-default/handlers/`.
- FR-20: All imports within the moved handler files should be updated to use the platform barrel (`infra.ts`) instead of deep platform paths.
- FR-21: All test files that import from the old handler paths should be updated to import from the new locations.
- FR-22: `cfs-handlers.ts` (or the flow's `handlers/index.ts`) should import from the new handler file locations.
- FR-23: The moved handler files should pass the `flow-isolation.test.ts` import boundary check.

### Phase 3: Generic Config Blocks (aiCompute, vectorSelect)
- FR-24: The system should support an `aiCompute` config block in `nodeConfig` that declaratively specifies: model alias, system prompt key, input fields (state paths), user prompt template, response parser (from a built-in registry), and output path.
- FR-25: The generic handler factory should create a handler from `nodeConfig.aiCompute` that calls the existing `runAiCompute` primitive with the specified configuration — no custom handler code required.
- FR-26: The system should support a `vectorSelect` config block in `nodeConfig` that declaratively specifies: document type, selection prompt key, candidate field, snippet limit, output path, and fallback strategy.
- FR-27: The generic handler factory should create a handler from `nodeConfig.vectorSelect` that calls the existing `vectorSelect` primitive with the specified configuration — no custom handler code required.
- FR-28: The built-in response parser registry for `aiCompute` should include at minimum: `json`, `jsonArray`, `numberedList`, `singleLine`, `parsePillarsFromAi`.
- FR-29: Both config blocks must pass the graduation checklist criteria (reuse threshold, complexity ceiling, no conditional logic, composable from existing primitives, escape hatch preserved).

## Possible Edge Cases
- `autoIngest.then` references a node that is itself an `autoIngest` question — the compiler must handle chained auto-expansion without infinite loops
- A flow YAML has zero explicit routing rules and relies entirely on auto-generated rules — the router must still have a `default: end` fallback
- `inferReadsWrites` for a `handlerRef` node with no `nodeConfig` — inference should return empty arrays (reads/writes are unknown for custom handlers)
- Multiple `autoIngest` questions write to the same `saveTo` field — the compiler should warn about potential state conflicts
- The `expandAutoIngest()` function is called on a DSL that already has synthetic nodes from a previous expansion — must be idempotent
- Moved handler files have circular imports between step files — must verify import graph is clean after move
- `aiCompute` node with an unregistered `responseParser` name — generic handler should throw at compile time, not at runtime
- `vectorSelect` node with a `docType` that produces zero vector results — fallback strategy must produce a usable default
- `aiCompute` node where the model alias is not configured in `config.models` — should fall back to default model or throw at compile time

## Acceptance Criteria
- AC-1: `npm run build` passes with no new errors after every change in both phases.
- AC-2: All 25 existing test suites pass after every change in both phases.
- AC-3: `flow-isolation.test.ts` passes, confirming flow handlers only import from the barrel or same-flow handlers.
- AC-4: `preflight-routing.test.ts` passes, confirming reachability, terminal path, question-ingest pairing, and routing rule completeness checks work.
- AC-5: `autoIngest.test.ts` passes, confirming `expandAutoIngest()` correctly generates synthetic nodes, routing rules, transitions, and field mappings.
- AC-6: DSL expansion equivalence test passes: the expanded intent-driven CFS YAML produces the same effective topology as the original explicit YAML (same node count, same transition destinations, same routing rule coverage).
- AC-7: Multi-turn functional parity test passes: running the same conversation sequence (init -> use case group -> confirm -> name -> industry) through both the original and intent-driven YAML produces identical state at each step.
- AC-8: CFS `flow.yaml` uses `autoIngest` for at least `askUserName` and `askTimeframe`, with corresponding explicit ingest nodes and routing rules removed.
- AC-9: All `handlerRef` nodes in CFS `flow.yaml` have `intent` annotations.
- AC-10: `_templates/` contains working handler templates and a flow scaffold that compiles.
- AC-11: `docs/config-block-graduation-checklist.md` documents both the 80/20 philosophy and the 5-criteria checklist.
- AC-12: `clients/README.md` documents import boundary rules, handler registration convention, and `handlerRef` philosophy.
- AC-13: All CFS handler implementation files reside in `clients/default/flows/cfs-default/handlers/` and import only from the platform barrel.
- AC-14: All 25 test suites pass after handler file move with updated import paths.
- AC-15: `NodeConfigSchema` includes `aiCompute` and `vectorSelect` as optional config blocks.
- AC-16: `createGenericHandler()` in `generic-handlers.ts` produces working handlers from `aiCompute` and `vectorSelect` configs.
- AC-17: Unit tests verify `aiCompute` generic handler calls `runAiCompute` with correct params from config, and `vectorSelect` generic handler calls the `vectorSelect` primitive with correct params from config.
- AC-18: At least one existing CFS `handlerRef` node is converted to use the new `aiCompute` or `vectorSelect` config block, demonstrating reduced custom code.

## Testing Guidelines

- Scenario coverage map:
  - Primary success (autoIngest compiles and runs) -> `autoIngest.test.ts`: unit tests for `expandAutoIngest()` generating correct synthetic nodes, rules, transitions, field mappings
  - Variation A (inferred reads/writes) -> `autoIngest.test.ts`: test that omitted reads/writes are correctly inferred for each node kind
  - Variation B (mixed autoIngest and explicit) -> `autoIngest.test.ts`: test flow with both patterns compiles and routes correctly
  - Variation D (flow scaffold compiles) -> `flow-isolation.test.ts` or manual verification
  - Failure E1 (missing intent) -> `preflight-routing.test.ts`: verify warning emitted
  - Failure E3 (bad autoIngest.then) -> `autoIngest.test.ts`: verify preflight error
  - Failure E4/E5 (import violations) -> `flow-isolation.test.ts`: verify test fails on cross-flow or deep-path imports
  - Failure E6 (undeclared stateExtension) -> `preflight-routing.test.ts`: verify warning emitted

- Acceptance traceability:
  - AC-1, AC-2 -> `npm run build` and `npm test` after each change
  - AC-3 -> `flow-isolation.test.ts`
  - AC-4 -> `preflight-routing.test.ts`
  - AC-5 -> `autoIngest.test.ts` unit tests
  - AC-6 -> `autoIngest.test.ts` or `graphParity.test.ts`: DSL expansion equivalence assertion
  - AC-7 -> `graphParity.test.ts`: multi-turn functional parity test comparing original and intent-driven YAML conversation sequences
  - AC-8, AC-9 -> Manual review of updated `flow.yaml`
  - AC-10 -> `flow-isolation.test.ts` (scaffold files pass isolation check) or manual verification
  - AC-11, AC-12 -> Manual review of documentation files
  - AC-13, AC-14 -> `npm test` after handler file move; `flow-isolation.test.ts` passes for moved files
  - AC-15, AC-16, AC-17 -> `genericHandlers.test.ts` updated with aiCompute and vectorSelect tests
  - AC-18 -> Manual review of updated flow.yaml showing at least one converted node

- Regression checks:
  - `stepFlow.test.ts` multi-turn conversation flow still passes
  - `graphParity.test.ts` existing topology and functional assertions still pass (with updated node ID expectations for autoIngest-converted nodes)
  - `genericHandlers.test.ts` generic handler creation still works
  - `acknowledgements.test.ts`, `chatOptions.test.ts`, `primitives.test.ts` all pass unchanged
  - All test suites green after every change (25 existing + new tests)
  - After handler file move: all tests that previously imported from `core/nodes/cfs/` work with new paths
  - After aiCompute/vectorSelect addition: existing genericHandlers.test.ts still passes alongside new tests

## Dependencies and Constraints
- Dependencies:
  - Existing GraphDSL compiler pipeline (`graph-compiler.ts`, `graph-loader.ts`, `generic-handlers.ts`)
  - Existing handler registry (`handler-registry.ts`, `graph-handler-modules.ts`)
  - Existing CFS flow YAML (`clients/default/flows/cfs-default/flow.yaml`)
  - Existing test infrastructure (Jest with ts-jest ESM preset, 25 test suites)
- Constraints:
  - No runtime behavior change to the CFS conversation at any point during implementation
  - Phase 0 changes must be complete and verified before Phase 1 begins
  - Phase 1 must be complete and verified before Phase 2 begins
  - Phase 2 must be complete and verified before Phase 3 begins
  - Technical stack: Node.js, TypeScript, ESM, Zod validation, no new dependencies

## Out of Scope
- Simplified routing rule syntax (e.g., `after:` / `expect:` / `then:` sugar) — future follow-up
- No-code chat or graphical UI for flow authoring — future project that builds on this foundation
- Auto-generating routing rules for complex patterns (multi-step loops, pillar loops) — only simple question-ingest chains are auto-generated
- Publishing the platform as an npm package or monorepo restructuring
- Additional generic config blocks beyond `aiCompute` and `vectorSelect` (e.g., `questionLoop`, `integration`) — governed by the graduation checklist for future work
- Converting all CFS `handlerRef` nodes to generic config blocks — only nodes whose logic fits `aiCompute` or `vectorSelect` cleanly are converted

## Open Questions
- Should `expandAutoIngest()` detect when an explicit ingest node already exists for the same `questionKey` and skip expansion, or should it error? (Recommendation: skip and warn)
- For the `inferReadsWrites` function, should `handlerRef` nodes with `helperRefs` declared get any inferred reads/writes, or should they always be empty? (Recommendation: always empty — custom handlers are opaque)
- Should the `intent` field be required for `handlerRef` nodes in a future schema version, or remain permanently optional with a preflight warning? (Recommendation: optional with warning for now, revisit when no-code UI is built)
- When `autoIngest.then` is omitted, should the auto-generated ingest transition go to `__end__` or back to the parent router? (Recommendation: `__end__`, matching the current pattern where most ingest nodes go to `__end__` or back to the router via the routing rules)
