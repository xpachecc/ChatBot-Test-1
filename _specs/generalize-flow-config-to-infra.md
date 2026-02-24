# Plan: Generalize Flow Config to Reusable Infrastructure

feature_slug: generalize-flow-config-to-infra

## Intent and Desired Outcomes
- **Business intent**: Eliminate CFS-graph-specific hardcoded configuration so future graph flows can declare steps, progress rules, message templates, overlay prefixes, and example generators purely through YAML.
- **User problem**: `stepFlowConfig.ts` (227 lines) and parts of `stepFlowHelpers.ts` contain CFS-specific constants, progress computation, overlay prefixes, and example generators that cannot be reused.
- **Desired outcomes**:
  - Flow metadata (title, description, step definitions) comes from YAML
  - Progress computation is a generic utility driven by YAML config
  - Overlay prefixes, example templates, question templates are YAML-configured
  - Message-template builders use `configString()` + `interpolate()` instead of ad-hoc concatenation
  - `stepFlowConfig.ts` reduced to re-exports or deleted

---

## Phase 1: Extend YAML Schema + Generic Types

### 1.1 Extend GraphConfigSchema (graphDslTypes.ts)
- Add `meta` section:
  - `flowTitle: string`
  - `flowDescription: string`
  - `steps: Array<{ key, label, order, countable, totalQuestions }>`
- Add `overlayPrefixes: Record<string, string>`
- Add `exampleTemplates: Record<string, string[]>`
- Add `progressRules`:
  - `questionKeyMap: Record<string, number>` (maps question key → answered count)
  - `dynamicCountField: string` (e.g. `"use_case_context.discovery_questions"`)
  - `dynamicCountStepKey: string` (e.g. `"STEP3_PERFORM_DISCOVERY"`)

### 1.2 Create generic types (utilities.ts or progressTracker.ts)
- `FlowStepMeta`, `FlowMeta`, `StepProgress`, `FlowProgress`, `StepProgressStatus`

### 1.3 Create generic `computeFlowProgress(state, config)` utility
- Reads `meta` from config for step definitions
- Uses `progressRules.questionKeyMap` for step 1/2 counting
- Uses `progressRules.dynamicCountField` for step 3
- Falls back to defaults when config unavailable (tests)

---

## Phase 2: Populate YAML + Wire GraphCompiler

### 2.1 Add config blocks to cfs.flow.yaml
- `config.meta` — flow title, description, 4 step definitions
- `config.overlayPrefixes` — Mentor_Supportive, CTO_Consultative, SeniorSE_Challenging, Coach_Affirmative, default
- `config.exampleTemplates` — role, industry, goal, timeframe
- `config.progressRules` — questionKeyMap (STEP1_ANSWERED_MAP), dynamicCountField, dynamicCountStepKey

### 2.2 Extend GraphMessagingConfig (state.ts)
- Add `meta`, `overlayPrefixes`, `exampleTemplates`, `progressRules`

### 2.3 Extend buildGraphMessagingConfigFromDsl (graphCompiler.ts)
- Extract and pass through new config sections
- Build `overlayPrefix` and `exampleGenerator` from config (or keep as configFns that read config at call time)

---

## Phase 3: Replace stepFlowConfig.ts Callers

### 3.1 Update server.ts
- Import `computeFlowProgress` from generic utility (utilities.ts or infra.ts)

### 3.2 Update routers.ts, step2Nodes, step3Nodes
- Derive step constants from config or `getStepName()` accessor instead of `CFS_STEPS`

### 3.3 Update cfsHandlers.ts
- Use infrastructure-based `overlayPrefix` / `exampleGenerator` (reading from config)

### 3.4 Reduce or delete stepFlowConfig.ts
- Keep only backward-compat re-exports, or delete if all callers updated

---

## Phase 4: Replace stepFlowHelpers Message Builders

### 4.1 Move templates to YAML config.strings
- `step2.q1.template`, `step2.q1.confirmation`, `step2.q2.confirmation`
- `step2.useCaseSelection.header`, `step2.useCaseSelection.guidance`, `step2.useCaseSelection.prompt`
- `step1.kycEchoFallback.*` (or single template with placeholders)
- `step1.roleAssessment.template`

### 4.2 Replace builders with configString + interpolate
- `buildStep2Q1()` → `interpolate(configString("step2.q1.template", fallback), vars)`
- `buildStep2Q1Confirmation()`, `buildStep2Q2Confirmation()` → same pattern
- `buildUseCaseSelectionMessage()` → assemble from config strings
- `buildKnowYourCustomerEchoFallback()` → single template + interpolate
- `buildRoleAssessmentMessage()` → single template + interpolate

---

## Phase 5: Cleanup + Verification

### 5.1 Remove duplicate logic
- No duplicate constants between YAML and TypeScript

### 5.2 Update infra.ts
- Re-export `computeFlowProgress` and related types

### 5.3 Verification
- `npm run build` passes
- `npm test` passes (all existing suites)
- `/chat` endpoint returns correct `flowProgress` shape

---

## File Change Summary

| File | Action |
|------|--------|
| `graphDslTypes.ts` | Add meta, overlayPrefixes, exampleTemplates, progressRules schemas |
| `state.ts` | Extend GraphMessagingConfig |
| `utilities.ts` | Add FlowMeta types, computeFlowProgress utility |
| `graphCompiler.ts` | Extract new config in buildGraphMessagingConfigFromDsl |
| `cfs.flow.yaml` | Add meta, overlayPrefixes, exampleTemplates, progressRules, new strings |
| `server.ts` | Import computeFlowProgress from utilities |
| `routers.ts` | Derive step constants from config |
| `step2NarrowDownUseCasesNodes.ts` | Use config for CFS_STEPS |
| `step3PerformDiscoveryNodes.ts` | Use config for CFS_STEPS, S3_DISCOVERY_QUESTION_KEY |
| `cfsHandlers.ts` | Use config-driven overlayPrefix/exampleGenerator |
| `stepFlowConfig.ts` | Reduce to re-exports or delete |
| `stepFlowHelpers.ts` | Replace message builders with configString + interpolate |
| `infra.ts` | Re-export computeFlowProgress |

---

## Acceptance Criteria
- [x] `stepFlowConfig.ts` < 80 lines (reduced from 227)
- [ ] `computeFlowProgress()` reads from GraphMessagingConfig
- [ ] Adding a 5th step in YAML requires no TypeScript changes
- [ ] `overlayPrefix()` and `exampleGenerator()` read from YAML
- [ ] Message builders use configString + interpolate
- [ ] `npm run build` passes
- [ ] `npm test` passes
