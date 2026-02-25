# Spec for Decouple Graph Flow and UI Template Packaging

feature_slug: decouple-graph-flow-ui-template-packaging  
screen_comp (if available): N/A

## Intent and Desired Outcomes
- Business intent: Enable graph flows and UI templates to be independently built, configured, and packaged together as deployable applications. A single graph flow can be paired with multiple UI templates (e.g., Chatbot1, Chatbot2, Humanoid Avatar, Voice), and each graph+UI combination can be published as a distinct application. **This code will eventually merge with a multi-tenant platform.** Flows and application configuration must be separated by client (tenant). All apps leverage a common set of UI templates, with app-specific attributes applied at runtime.
- User problem: The current chatbot UI is tightly coupled to the CFS graph flow. Options, progress computation, and server wiring are CFS-specific. There is only one UI layout. It is not possible to swap graphs or UIs without code changes. There is no structure to support multiple clients or tenant isolation.
- Desired outcomes:
  - Graph flows are configurable via YAML; any flow can be loaded at runtime based on configuration.
  - Options and progress metadata are graph-driven (from YAML or state), not hardcoded to CFS.
  - Multiple UI templates exist and can be selected by configuration.
  - Any one application pairs one flow with one UI template. Each configured as parameters in the application setup.
  - A graph flow and a UI template can be packaged together and deployed as a single application. The deployment details URL, API etc, would be defined in the application setup.
  - **Multi-tenant ready:** Flows live per client; common templates are shared; app config (graph + template + UI overrides) is per client and per app.
- Success metrics (observable):
  - Same graph (e.g., CFS) runs correctly with at least two different UI templates.
  - Different graph YAML loads and runs with the same UI template (where state contract is compatible).
  - Application config (flowId + template) drives server behavior without code changes.
  - Existing CFS chatbot behavior is preserved (regression-free).
  - **Directory structure supports client isolation:** flows under `clients/<tenantId>/flows/<flowId>/`, templates under `templates/`, app config under `clients/<tenantId>/apps/<appId>/`. All IDs (tenantId, flowId, appId) are sourced from the database.

## Summary
The feature decouples the graph flow from the UI and introduces a packaging model where graph and UI are selected by configuration. The backend generalizes options and progress so they are driven by graph YAML or state rather than CFS-specific logic. The frontend supports multiple UI templates (e.g., standard chat, avatar, voice) that share a common API contract. An application config selects the graph and UI, and the server loads the correct combination at startup. **The layout is designed for eventual merge with a multi-tenant platform:** graph flows are stored per client, UI templates are shared across all clients, and application config (flowId, template name, UI overrides) is stored per client and per app. Success means a developer can build a graph, choose a UI template, and publish the pair as a deployable app without modifying core code—and the structure supports multiple clients with isolated flows and shared templates.

## ID Source and Tenancy

All IDs (tenantId, flowId, appId) are sourced from the database. The multi-tenant platform uses tenancy to manage access to both database data and the file system.

### How Tenancy Works

1. **Login** — When a user logs in, they receive tenancy credentials. These credentials include the **tenant ID** (client ID), which scopes all subsequent actions to that tenant.
2. **Scoped actions** — All actions (creating flows, creating apps) are automatically scoped to the tenant ID from the user's credentials.
3. **Database-generated IDs** — When a user creates a new flow or app, the action automatically creates and stores a new ID in the database. That database ID is used as the folder name within the directory structure (e.g., `flows/<flowId>/`, `apps/<appId>/`).
4. **Access control** — Tenancy manages access to database data and to the file system. Users can only access flows and apps belonging to their tenant.

### For This Project (Single-Tenant)

For the initial release and this codebase, **tenant ID (client ID) can be hardcoded**. A single tenant ID is used (e.g., from env or config), so all flows and apps are created under that tenant. The full login → credentials flow is out of scope; the directory structure and ID resolution are designed to support the multi-tenant merge.

## Directory Structure (Multi-Tenant Model)

The following layout separates tenant-specific content from shared platform assets. Folder names are database-generated IDs to ensure uniqueness and alignment with the database as the source of truth.

```
<project-root>/
├── templates/                           # COMMON UI templates (shared across all tenants)
│   ├── chatbot1/
│   │   ├── index.html
│   │   ├── css/
│   │   └── js/
│   ├── chatbot2/
│   ├── avatar/
│   └── voice/                           # Structure only; implementation deferred
│
├── clients/                             # Per-tenant content
│   └── <tenantId>/                     # tenantId from DB (hardcoded for this project)
│       ├── flows/                       # Graph flows for this tenant only
│       │   └── <flowId>/                # flowId from DB when flow is created
│       │       └── flow.yaml            # or flow.flow.yaml
│       └── apps/                        # Application definitions for this tenant
│           └── <appId>/                # appId from DB when app is created
│               └── app.config.json     # flowId, template, UI overrides
│
├── src/                                 # Server and runtime code (unchanged)
│   ├── server.ts
│   └── langgraph/
│       └── ...
│
└── graphs/                              # (Optional) Legacy / shared flows; migrate to clients/<tenantId>/flows/<flowId>/
    └── cfs.flow.yaml
```

### Location Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| **Graph flows** | `clients/<tenantId>/flows/<flowId>/` | Flow folder named by DB-generated flowId; one flow per folder |
| **Common UI templates** | `templates/<templateName>/` | Shared across all tenants; one source of truth |
| **Application config** | `clients/<tenantId>/apps/<appId>/app.config.json` | App folder named by DB-generated appId; config references flowId, template, UI overrides |

### App Config Schema (per `app.config.json`)

```json
{
  "flowId": "uuid-of-flow",
  "template": "chatbot1",
  "uiOverrides": {
    "title": "Acme Sales Assistant",
    "branding": { "primaryColor": "#0066cc" }
  }
}
```

- `flowId`: Database ID of the flow to load; resolves to `clients/<tenantId>/flows/<flowId>/flow.yaml`.
- `template`: Name of a template under `templates/` (e.g., `chatbot1`).
- `uiOverrides`: App-specific attributes applied to the template (schema deferred; see Open Questions).

### Runtime Resolution

1. **Tenant ID** — From user's tenancy credentials (login) or, for this project, hardcoded (env/config).
2. **App ID** — From request context or default; stored in DB and used as folder name.
3. **Config** — Load `clients/<tenantId>/apps/<appId>/app.config.json` (appId from DB).
4. **Flow** — Load from `clients/<tenantId>/flows/<flowId>/flow.yaml` (flowId from app config, which references DB record).
5. **Template** — Serve from `templates/<templateName>/` with optional `uiOverrides` applied.

For this project, tenantId is hardcoded; appId and flowId can be resolved from env or a default app config path for backward compatibility with the current CFS deployment.

### Migration / Backward Compatibility

The current CFS flow lives at `graphs/cfs.flow.yaml`. To adopt the new structure:

1. Once this code is merged into the multi-tenant platform the user login will facilitate the tenantID from the tenancy granted with login.  (for now use a hardcoded tenantId).
2. Create a flow record in the DB for CFS; the generated flowId becomes the folder name.  (genereate a dummy for now this will also be facilited by the multitenatn platform)
3. Create `clients/<tenantId>/flows/<flowId>/flow.yaml` (copy or move from `graphs/cfs.flow.yaml`).
4. Create an app record in the DB; the generated appId becomes the folder name. (for now generate a dummy since this ID will be given by the multi-tenant platform once merged)
5. Create `clients/<tenantId>/apps/<appId>/app.config.json` with `{ flowId, template: "chatbot1", uiOverrides }`.

Until migration, the server may support a legacy mode: if flowId is absent, fall back to a path-based config (e.g., `graph: "graphs/cfs.flow.yaml"`) for backward compatibility.

## Scenario Coverage
### Primary Success Scenario
- Given a developer has built a graph flow (YAML) and selected a UI template (e.g., Chatbot1)
- When the application starts with config `{ flowId: "<cfs-flow-id>", template: "chatbot1" }` (from `clients/<tenantId>/apps/<appId>/app.config.json`, where tenantId is hardcoded and appId is from DB or default)
- Then the server loads the CFS graph from `clients/<tenantId>/flows/<flowId>/flow.yaml`, serves the Chatbot1 UI from `templates/chatbot1/`, and the chat works end-to-end with correct options and progress from the graph config

### Variation Scenarios
- Scenario A: Same flow, different UI
  - Config `{ flowId: "<cfs-flow-id>", template: "chatbot2" }` serves a different UI layout (e.g., avatar-style) from `templates/chatbot2/` while the same CFS flow runs; options and progress behave identically. Different UIs will have the base request/response feature but other features may not exist (e.g., side progress navigation, title bar, response buttons).
- Scenario B: Different flow, same UI
  - Config `{ flowId: "<onboarding-flow-id>", template: "chatbot1" }` loads a different flow from the same tenant's `flows/`; the standard chat UI works with the new flow's response/options/progress contract.
- Scenario C: Packaging for deployment
  - A build or deploy step reads config and produces a deployable artifact (e.g., Docker image or static bundle) containing the selected flow + UI combination.
- Scenario D: Multi-tenant (future)
  - Tenant A and Tenant B each have their own `flows/` and `apps/` (folder names are DB-generated IDs); both use the shared `templates/chatbot1/`. When users log in, tenancy credentials provide tenantId; all flow and app creation is scoped to that tenant. App config for each tenant points to tenant-specific flows (by flowId) and applies tenant-specific `uiOverrides`.

### Failure / Edge Scenarios
- Scenario E1: Config specifies a missing flow (flowId not found in DB or folder missing)
  - Server fails fast at startup with a clear error; no partial startup.
- Scenario E2: Config specifies a missing UI template
  - Server fails fast at startup or returns 404 for the UI route with a clear error.
- Scenario E3: Graph YAML lacks options or progress config
  - Backend returns null/empty options and minimal progress; UI degrades gracefully (no options tray, minimal or no progress pane).
- Scenario E4: UI template does not implement the full API contract
  - UI may omit optional features (e.g., progress pane); core send/receive must still work.

## Functional Requirements
- FR-1: The system should load the graph flow from a path derived from flowId (from app config) at server startup; flow path is `clients/<tenantId>/flows/<flowId>/flow.yaml`.
- FR-2: The system should derive options from graph configuration or state (e.g., YAML `options` section or `session_context.suggested_options`), not from CFS-specific `getOptionsForQuestionKey` logic.
- FR-3: The system should compute flow progress from graph YAML meta and progress rules only; no hardcoded CFS step keys in the generic progress utility.
- FR-4: The system should support multiple UI templates under `templates/<templateName>/` (common across all tenants).
- FR-5: The system should serve the selected UI template based on configuration (e.g., route `/` serves the configured template's `index.html` and assets from `templates/<templateName>/`).
- FR-6: The system should expose an application config that specifies `flowId` and `template` name; config lives at `clients/<tenantId>/apps/<appId>/app.config.json`. tenantId and appId are sourced from the database (tenantId hardcoded for this project).
- FR-7: All UI templates must implement the common chat API contract: POST `/chat` with `{ message, sessionId }` and handle `{ response, flowProgress?, options? }`.
- FR-8: The system should not break existing CFS chatbot behavior when the default config matches current single-flow, single-UI deployment.
- FR-9: Graph flows shall be loaded from `clients/<tenantId>/flows/<flowId>/`; folder names (flowId, appId) are database-generated IDs; tenancy manages access to database and file system.

## Possible Edge Cases
- Graph state schema differs between flows (e.g., non-CFS flow uses different state shape); options/progress may need flow-specific adapters.
- UI template expects DOM IDs or layout that differ from the standard contract; templates must document their requirements.
- Config hot-reload vs. restart: initial scope assumes config is read at startup only.
- Multiple flows in one process (e.g., different routes per flow) is out of scope for initial release. The app packaging will be one flow to one UI.
- Tenant ID resolution: when merging with multi-tenant platform, tenantId comes from user's tenancy credentials (login); for this project, tenantId is hardcoded.
- Flow/app creation: when a user creates a flow or app, the platform creates a DB record, generates an ID, and creates the corresponding folder in the file system; tenancy ensures the user can only create under their tenant.

## Acceptance Criteria
- AC-1: Server starts with config `{ flowId: "<cfs-flow-id>", template: "chatbot1" }` (from `clients/<tenantId>/apps/<appId>/`) and serves the Chatbot1 UI from `templates/chatbot1/`; full CFS conversation works with options and progress.
- AC-2: Server starts with config `{ flowId: "<cfs-flow-id>", template: "chatbot2" }` and serves a different UI from `templates/chatbot2/`; CFS conversation behavior is unchanged.
- AC-3: Options are sourced from graph config or state; removing CFS-specific option keys from `chatOptions.ts` does not break CFS when options are defined in YAML or state.
- AC-4: `computeFlowProgress` has no hardcoded CFS step keys; step definitions come from `config.meta` and `config.progressRules`.
- AC-5: Missing flowId (or flow folder) or UI template in config produces a clear startup error.
- AC-6: Default config (or no config) preserves current behavior: CFS flow + current single UI; tenantId is hardcoded for backward compatibility.
- AC-7: All existing tests pass; no regression in chat, options, or progress behavior.
- AC-8: Directory structure follows `clients/<tenantId>/flows/<flowId>/`, `templates/`, and `clients/<tenantId>/apps/<appId>/`; folder names are database-generated IDs.

## Testing Guidelines
Define the minimum verification set to prove correctness:

- Scenario coverage map:
  - Primary success scenario -> E2E test: start server with config, send chat messages, verify response/options/progress.
  - Variation scenario(s) -> (a) same flow + UI2, (b) config-driven flow switch (with compatible flow).
  - Failure/edge scenario(s) -> missing graph, missing UI, invalid config.

- Acceptance traceability:
  - AC-1, AC-2 -> E2E or integration tests with config override; verify paths use `clients/<tenantId>/flows/<flowId>/` and `templates/`.
  - AC-3 -> Unit tests for options resolution from config/state; CFS options test with YAML-driven source.
  - AC-4 -> Unit tests for `computeFlowProgress` with mock config; no CFS step key literals in generic logic.
  - AC-5 -> Startup failure tests with invalid config.
  - AC-6, AC-7 -> Full test suite run; regression suite.
  - AC-8 -> Verify directory structure exists and config resolution uses correct paths.

- Regression checks:
  - Existing `/chat` flow returns correct response, flowProgress, options for CFS.
  - Existing step routing, options, and progress pane behavior unchanged for default config.
  - Readout download and other CFS-specific features still work.

## Dependencies and Constraints
- Dependencies:
  - `generalize-flow-config-to-infra` (or equivalent): YAML meta, progressRules, and config-driven `computeFlowProgress` must be in place or delivered as part of this work.
  - Existing `/chat` API contract and `FlowProgress` / `ChatOptions` response shapes.
  - **Database** (for multi-tenant merge): Tenant, flow, and app records with generated IDs; tenancy credentials. For this project, a minimal schema or seed data may suffice if IDs are hardcoded.
- Constraints:
  - Technical stack: Node.js, Express, plain HTML/JS/CSS; no new frontend framework without approval.
  - Supabase, OpenAI, Firecrawl integrations remain unchanged.
  - UI templates must work with the existing `/chat` REST contract.
  - Directory structure must support eventual merge with multi-tenant platform (tenant isolation for flows and app config; shared templates). IDs are database-sourced; tenancy manages access to DB and file system.

## Out of Scope
- Voice UI implementation (STT/TTS, real-time streaming); only the structure to support a voice template is in scope.
- Humanoid avatar rendering or animation; only the structure to support an avatar template is in scope.
- **Full runtime multi-tenant resolution** (login flow, per-request tenant/app selection from tenancy credentials); the directory structure and ID model are in scope for merge readiness. For this project, tenantId is hardcoded and a single config per process is used. (hard code all this for now since this will be faciliated by the multi-tenant platform.  We do not want to create duplication functionality)
- Graph state schema generalization for non-CFS flows (CfsState remains; other flows use compatible or extended state).
- Build-time bundling or Docker packaging automation (can be a follow-up).
- A formal UI template config schema is deferred; templates document their requirements informally (e.g., README or manifest) until a schema is defined.

## Open Questions
- Should options be defined in graph YAML (e.g., `config.options.questionKeyMap`) or populated by graph handlers into state (e.g., `session_context.suggested_options`)?
- For this project, how is the default flowId/appId/tenantId resolved at startup—from env vars, a bootstrap config file, or a seed DB record?
- Should UI templates have a config schema (e.g., supported features, layout hints, DOM expectations) or continue to document their requirements informally?
- What is the schema for `uiOverrides` in `app.config.json` (e.g., `title`, `branding.primaryColor`)? Deferred until UI template config schema is defined.
