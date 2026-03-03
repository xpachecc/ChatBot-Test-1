# Spec for Multi-Flow Handler Architecture

feature_slug: multi-flow-handler-architecture  
screen_comp (if available): N/A

## Intent and Desired Outcomes
- Business intent: Decouple the graph compilation and handler registration from the CFS flow so the system can load and run any flow defined by a `flow.yaml` without hardcoded CFS assumptions. Each flow owns its own handler registration module, and the runtime resolves the correct handlers based on the flow being loaded.
- User problem: The current architecture hardcodes CFS handlers in `graph.ts`, uses a global flat handler registry, and compiles a single graph at module load. Adding a second flow (e.g. an SE qualification flow) would require modifying shared infrastructure code and risk handler key collisions.
- Desired outcomes:
  - Each flow has its own handler registration module (e.g. `cfs-handlers.ts`, `se-qualify-handlers.ts`) that registers handlers prefixed by graphId.
  - `graph.ts` dynamically resolves and registers the correct handler module based on the flow's `graphId` from the YAML, rather than hardcoding `registerCfsHandlers()`.
  - `GraphMessagingConfig` is scoped per compiled graph, not stored as a global singleton.
  - `server.ts` can serve a flow determined by `app.config.json` without code changes for new flows.
  - Node logic files are organized by flow under `src/langgraph/core/nodes/<graphId>/`.
  - The existing CFS flow continues to work with zero behavioral regression.
- Success metrics (observable):
  - A second flow YAML can be loaded and compiled without modifying `graph.ts`, `server.ts`, or `graph-compiler.ts`.
  - All existing CFS tests pass unchanged.
  - Handler key collisions between two loaded flows are impossible by design.
  - `npm run build` and `npm test` pass after each phase.

## Summary
The system currently compiles exactly one graph (CFS) at startup. Handler registration, graph compilation, and messaging config are all hardcoded to CFS. This spec defines the architecture changes needed so that flows are self-contained: each flow declares its graphId in YAML, has a corresponding handler module in `src/`, and the runtime dynamically resolves the correct handlers at compile time. The messaging config becomes per-graph instead of a global singleton. Node files are reorganized by flow. The goal is that adding a new flow requires only: (1) a new `flow.yaml`, (2) a new handler module, (3) new node files — with zero changes to shared infrastructure.

## Scenario Coverage
### Primary Success Scenario
- Given `app.config.json` specifies `flowId: "cfs-default"` and the CFS flow YAML has `graphId: "cfs"`
- When the server starts and calls `buildGraphFromSchema(flowPath)`
- Then the system reads `graphId: "cfs"` from the YAML, looks up the handler module for `"cfs"`, registers CFS handlers, compiles the graph, sets per-graph messaging config, and the chatbot works identically to today.

### Variation Scenarios
- Scenario A: A new flow `se-qualify` is created with `graphId: "seQualify"` and its own handler module. The app config points to `flowId: "se-qualify"`. The server starts, resolves the SE handler module, registers SE handlers, compiles the graph, and serves the SE flow — without touching `graph.ts` or `cfs-handlers.ts`.
- Scenario B: A developer registers a handler in both `cfs-handlers.ts` and `se-qualify-handlers.ts` using the same logical name (e.g. `"step1.nodeInit"`). Because handler keys are prefixed by graphId in the YAML (`"cfs.step1.nodeInit"` vs `"seQualify.step1.nodeInit"`), there is no collision.

### Failure / Edge Scenarios
- Scenario E1: A flow YAML references `graphId: "unknown"` and no handler module exists for it -> The system throws a clear error: `"No handler module registered for graphId: unknown"`. The server does not start.
- Scenario E2: A handler module is registered but a `handlerRef` in the YAML does not match any registered key -> Existing preflight validation catches this and throws `"Handler not registered: ..."`. No change needed.
- Scenario E3: Two graphs are compiled in the same process (future multi-flow) and both set messaging config -> Each graph's config is stored under its graphId key; `requireGraphMessagingConfig(graphId)` returns the correct one.

## Functional Requirements
- FR-1: The system should resolve which handler module to use based on the `graphId` field in the flow YAML, not hardcoded in `graph.ts`.
- FR-2: The system should support a handler module registry that maps `graphId` to a registration function (e.g. `{ "cfs": registerCfsHandlers, "seQualify": registerSeQualifyHandlers }`).
- FR-3: The system should store `GraphMessagingConfig` keyed by `graphId` instead of as a single global variable.
- FR-4: The system should provide `requireGraphMessagingConfig(graphId)` that retrieves config for a specific graph.
- FR-5: `buildGraphFromSchema(yamlPath)` should parse the YAML to extract `graphId`, look up and call the handler registration function, then compile.
- FR-6: `runTurn` should receive or derive the `graphId` to retrieve the correct messaging config.
- FR-7: The system should organize CFS node files under `src/langgraph/core/nodes/cfs/` with re-exports from the current paths for backward compatibility.
- FR-8: The system should not break any existing CFS tests, server startup, or chat behavior.
- FR-9: The system should not require changes to `graph-compiler.ts`, `graph-loader.ts`, `handler-registry.ts` (beyond optional namespacing), or `graph-dsl-types.ts`.

## Possible Edge Cases
- Tests that import `buildCfsGraph()` assume CFS handlers are registered; the refactored `buildGraphFromSchema` must still work for them.
- `graph.ts` exports `const graph = buildCfsGraph()` at module level; LangGraph Studio depends on this export. The default export must remain CFS for backward compatibility.
- The `clearRegistry()` function in `handler-registry.ts` clears all handlers; tests that call it must re-register the correct handlers.
- `server.ts` session store uses `CfsState` type; if a future flow uses a different state schema, the session store type would need to change (out of scope for this spec).
- Handler module files must be importable at compile time; dynamic `import()` may be needed if handler modules are not statically known.

## Acceptance Criteria
- AC-1: `buildGraphFromSchema(cfsFlowPath)` compiles the CFS graph without explicitly calling `registerCfsHandlers()` in `graph.ts` -> pass if `graphId` lookup handles it.
- AC-2: A test can compile a mock flow YAML with a different `graphId` and its own handler module without modifying shared infrastructure -> pass.
- AC-3: `GraphMessagingConfig` for CFS is retrievable via `requireGraphMessagingConfig("cfs")` -> pass.
- AC-4: All existing CFS tests pass unchanged -> pass if `npm test` exit code 0.
- AC-5: `npm run build` completes with no new TypeScript errors -> pass.
- AC-6: CFS node files exist under `src/langgraph/core/nodes/cfs/` with re-exports from old paths -> pass if no import changes needed in tests.
- AC-7: Adding a new flow requires only: new `flow.yaml`, new handler module, new node files -> pass if no changes to `graph.ts`, `server.ts`, `graph-compiler.ts`, or `graph-loader.ts`.

## Testing Guidelines
Define the minimum verification set to prove correctness:

- Scenario coverage map:
  - Primary success scenario -> `graphParity.test.ts`: CFS graph compiles with all expected nodes via graphId-based handler resolution.
  - Variation scenario A -> New test: compile a minimal test flow YAML with a test graphId and test handler module; verify it compiles and runs.
  - Failure scenario E1 -> New test: attempt to compile a YAML with unregistered graphId; expect clear error.

- Acceptance traceability:
  - AC-1 -> `graphParity.test.ts` passes without explicit `registerCfsHandlers()` in test setup (compiler does it).
  - AC-2 -> New test with mock flow.
  - AC-3 -> Unit test for `requireGraphMessagingConfig("cfs")`.
  - AC-4 -> `npm test` exit code 0.
  - AC-5 -> `npm run build` exit code 0.
  - AC-6 -> Verify old import paths still resolve.
  - AC-7 -> Code review / structural inspection.

- Regression checks:
  - All `buildCfsGraph()` consumers (12+ test files) must still pass.
  - `stepFlow.test.ts`, `signalIntegration.test.ts`, `signalAgents.test.ts` must pass.
  - Server startup with CFS flow must work identically.
  - `/chat` endpoint returns correct responses, `flowProgress`, and `options`.

## Dependencies and Constraints
- Dependencies:
  - `consolidate-flow-yaml-to-client-only` spec is completed (single canonical flow path).
  - `generalize-flow-config-to-infra` spec is completed (config driven by YAML).
  - The GraphDSL schema, compiler, and loader are stable and do not need changes.
- Constraints:
  - LangGraph Studio depends on `export const graph = buildCfsGraph()` in `graph.ts`; this default export must remain.
  - `CfsState` and `CfsStateSchema` remain the only supported state contract; multi-state-schema support is out of scope.
  - Handler modules must be statically importable (no filesystem scanning or dynamic `import()` in production).
  - No changes to `.env` without asking and confirming first.

## Out of Scope
- Multi-state-schema support (new state contracts beyond `CfsStateSchema`).
- Multi-flow within a single server process (serving multiple flows simultaneously to different users).
- Dynamic handler loading from the filesystem at runtime.
- Changes to the GraphDSL schema or compiler logic.
- New flow creation (only the architecture to support it).
- UI template changes.
- YAML-driven generic node executor (covered by `yaml-driven-generic-node-executor` spec; should be executed before this spec).

## Open Questions
- Q1: Should the handler module registry be a static TypeScript map (e.g. `graphHandlerModules.ts`) or a convention-based file lookup (e.g. `src/langgraph/schema/<graphId>-handlers.ts`)? A static map is simpler and safer; convention-based requires dynamic import.
- Q2: Should `runTurn` accept `graphId` as a parameter, or should it be stored on the compiled graph result? Storing it on `CompileResult` avoids changing the `runTurn` signature.
- Q3: When reorganizing node files under `src/langgraph/core/nodes/cfs/`, should the old flat files be kept as re-exports indefinitely or removed after a migration period?
