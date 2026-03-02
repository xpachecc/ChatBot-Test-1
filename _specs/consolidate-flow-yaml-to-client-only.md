# Spec for Consolidate Flow YAML to Client Only

feature_slug: consolidate-flow-yaml-to-client-only  
screen_comp (if available): N/A

## Intent and Desired Outcomes
- Business intent: Eliminate the legacy `graphs/cfs.flow.yaml` file so that every CFS flow is authored and maintained exclusively under the client directory structure (`clients/<tenantId>/flows/<flowId>/flow.yaml`). This prepares the codebase for multi-tenant merge where flows are always scoped to a tenant.
- User problem: Two flow YAML files exist with overlapping content. The legacy file (`graphs/cfs.flow.yaml`) has received recent feature additions (signalAgents, routeAfterIngestUseCaseSelection) that were not propagated to the client flow file. This creates drift, confusion about which file is canonical, and risk of losing functionality during deletion.
- Desired outcomes:
  - A single CFS flow YAML lives at `clients/default/flows/cfs-default/flow.yaml` containing all nodes, transitions, routing rules, and config from both files.
  - `graphs/cfs.flow.yaml` is deleted with zero functionality loss.
  - `TENANT_ID` and `APP_ID` are required environment variables with no silent code-level defaults; startup fails fast with a clear error if either is missing.
  - All code references, tests, and documentation point to the client flow path exclusively.
- Success metrics (observable):
  - All existing tests pass after the migration with no weakening of assertions.
  - Server starts successfully with `TENANT_ID=default` and `APP_ID=cfs-chatbot` in `.env`.
  - Server fails to start with a descriptive error when `TENANT_ID` or `APP_ID` is missing from `.env`.
  - No file in the repository imports or references `graphs/cfs.flow.yaml`.

## Summary
The CFS chatbot currently has two flow YAML files: a legacy file at `graphs/cfs.flow.yaml` and a client-scoped file at `clients/default/flows/cfs-default/flow.yaml`. Recent features (the `routeAfterIngestUseCaseSelection` router, per-node `signalAgents` overrides, and global `signalAgents` config) were added to the legacy file but not to the client file. This spec defines the migration: merge all missing functionality into the client flow, require tenant/app identity via environment variables, remove the legacy file, and update all references. Success means one canonical flow file under the client directory with no behavioral regression.

## Scenario Coverage
### Primary Success Scenario
- Given the app config at `clients/default/apps/cfs-chatbot/app.config.json` exists with `flowId: "cfs-default"`, and `.env` contains `TENANT_ID=default` and `APP_ID=cfs-chatbot`
- When the server starts and resolves the app config
- Then the flow is loaded from `clients/default/flows/cfs-default/flow.yaml`, the graph compiles with all nodes (including `routeAfterIngestUseCaseSelection`), signal agents are enabled via `config.signalAgents`, and the chatbot behaves identically to the previous `graphs/cfs.flow.yaml` behavior.

### Variation Scenarios
- Scenario A: No app config file exists (e.g., the file at the resolved path is missing). The system falls back to loading the flow from `clients/<TENANT_ID>/flows/cfs-default/flow.yaml` using the required `TENANT_ID` env var and a hardcoded default flowId of `"cfs-default"`. The template defaults to `"chatbot1"`.
- Scenario B: The app config exists but does not specify a `flowId` (only `template` is set). The system falls back to loading the flow from `clients/<TENANT_ID>/flows/cfs-default/flow.yaml` using the default flowId. No reference to `graphs/` is made.

### Failure / Edge Scenarios
- Scenario E1: `TENANT_ID` is not set in the environment -> The system throws a clear error at startup: `"TENANT_ID env var is required"`. The server does not start.
- Scenario E2: `APP_ID` is not set in the environment -> The system throws a clear error at startup: `"APP_ID env var is required"`. The server does not start.
- Scenario E3: The resolved flow YAML path does not exist on disk -> The system throws: `"Flow not found: <path>"`. The server does not start.
- Scenario E4: A user selects use cases but `use_case_context.selected_use_cases` is empty after ingest -> The `routeAfterIngestUseCaseSelection` router routes to `__end__` (retry), not to `nodeDetermineUseCaseQuestions`. This validates the router was correctly migrated.

## Functional Requirements
- FR-1: The system should load the CFS flow exclusively from `clients/<TENANT_ID>/flows/<flowId>/flow.yaml` where `flowId` comes from the app config or defaults to `"cfs-default"`.
- FR-2: The system should require `TENANT_ID` and `APP_ID` as environment variables with no fallback defaults in code. Missing either should cause a startup error.
- FR-3: The client flow YAML should contain the `routeAfterIngestUseCaseSelection` router node, its conditional transition, its routing rules, and the static transition from `ingestUseCaseSelection` pointing to it.
- FR-4: The client flow YAML should contain per-node `signalAgents` overrides: `false` on `ingestConfirmStart` and `ingestKycConfirm`, `true` on `knowYourCustomerEcho`.
- FR-5: The client flow YAML should contain `config.signalAgents` with `enabled: true` and `ttlMs: 1000`.
- FR-6: The system should not reference `graphs/cfs.flow.yaml` anywhere in source code, tests, or documentation after migration.
- FR-7: The system should not silently fall back to any path under `graphs/` when resolving flow files.
- FR-8: The `buildCfsGraph()` function and `DEFAULT_CFS_YAML` constant should resolve to the client flow path.

## Possible Edge Cases
- Tests that import `buildCfsGraph()` indirectly depend on `DEFAULT_CFS_YAML`; changing the path affects all of them. Each must be verified.
- The `config.graph` path-based override in `appConfig.ts` could still point to `graphs/cfs.flow.yaml` if someone sets it manually. This legacy field should either be removed or its error message updated.
- The graph authoring guide lives at `docs/graph-authoring.md`.
- The `graphParity.test.ts` test hardcodes expected node IDs including `routeAfterIngestUseCaseSelection`; if the merge is incomplete, this test will fail (desired behavior -- it acts as a safety net).

## Acceptance Criteria
- AC-1: `clients/default/flows/cfs-default/flow.yaml` contains all 23 nodes (including `routeAfterIngestUseCaseSelection`), 3 conditional transitions, 20 static transitions, 3 routing rule blocks, and `config.signalAgents` -> pass if structurally identical to the merged content from `graphs/cfs.flow.yaml`.
- AC-2: `graphs/cfs.flow.yaml` does not exist in the repository -> pass if file is deleted.
- AC-3: `npm run build` completes with no new TypeScript errors -> pass.
- AC-4: `npm test` passes all existing tests with no weakened assertions -> pass.
- AC-5: Server starts successfully with `TENANT_ID=default` and `APP_ID=cfs-chatbot` in `.env` -> pass.
- AC-6: Server fails to start with a descriptive error when `TENANT_ID` is removed from `.env` -> pass if error message includes `"TENANT_ID"`.
- AC-7: Server fails to start with a descriptive error when `APP_ID` is removed from `.env` -> pass if error message includes `"APP_ID"`.
- AC-8: `rg "graphs/cfs.flow.yaml" --type ts --type md` returns zero matches in source and docs -> pass.

## Testing Guidelines
Define the minimum verification set to prove correctness:

- Scenario coverage map:
  - Primary success scenario -> `graphParity.test.ts`: schema topology test expects all 23 node IDs including `routeAfterIngestUseCaseSelection`; compiler preflight tests load from client flow path.
  - Variation scenario (no app config fallback) -> `appConfig.test.ts`: test that missing app config file resolves to `clients/default/flows/cfs-default/flow.yaml` (not `graphs/`).
  - Failure scenario (missing env var) -> `appConfig.test.ts`: new test that unset `TENANT_ID` throws `"TENANT_ID env var is required"`; same for `APP_ID`.
  - Failure scenario (empty use case selection) -> `signalIntegration.test.ts` or `graphParity.test.ts`: confirm `routeAfterIngestUseCaseSelection` routing rules are present and functional.

- Acceptance traceability:
  - AC-1 -> Structural inspection of client flow YAML (automated or manual diff).
  - AC-2 -> File system check: `graphs/cfs.flow.yaml` does not exist.
  - AC-3 -> `npm run build` exit code 0.
  - AC-4 -> `npm test` exit code 0 with no skipped or weakened tests.
  - AC-5 -> Server startup with correct `.env` values.
  - AC-6, AC-7 -> Manual or automated startup test with missing env vars.
  - AC-8 -> `rg` search returns no matches.

- Regression checks:
  - All `buildCfsGraph()` consumers (12+ test files) must still compile and pass since they depend on `DEFAULT_CFS_YAML`.
  - `stepFlow.test.ts`, `determineUseCases.test.ts`, `askUseCaseQuestions.test.ts`, `buildReadout.test.ts`, and other integration tests must pass unchanged.
  - Signal orchestration behavior (tested in `signalIntegration.test.ts`) must remain functional with `config.signalAgents.enabled: true` from the client flow.

## Dependencies and Constraints
- Dependencies:
  - Handler `cfs.routeAfterIngestUseCaseSelection` is already registered in `src/langgraph/schema/cfs-handlers.ts` (line 39). No new handler code is needed.
  - The graph compiler (`src/langgraph/schema/graph-compiler.ts`) already supports `signalAgents` at both node and config level.
  - The app config resolver (`src/config/appConfig.ts`) already supports the `clients/<tenantId>/flows/<flowId>/flow.yaml` path pattern.
- Constraints:
  - `.env` must not be overwritten without asking and confirming first (per project rules). `TENANT_ID` and `APP_ID` should be appended.
  - The directory structure (`clients/<tenantId>/flows/<flowId>/`) must be preserved as-is for multi-tenant compatibility.
  - This is a single-tenant project; `TENANT_ID` and `APP_ID` are hardcoded in `.env` now but will come from authentication in the multi-tenant platform.

## Out of Scope
- Multi-tenant authentication and dynamic tenant resolution at request time.
- Serving multiple apps from a single server process.
- Creating new flows or new clients beyond `default/cfs-default`.
- Changes to the graph compiler, handler registry, or signal orchestrator logic.
- Changes to any UI template.

## Open Questions
- Resolved: The `graphs/` folder has been removed; graph authoring documentation is now at `docs/graph-authoring.md`.
