# Graph Authoring Guide — GraphDSL v1

## Overview

This project uses a YAML-based schema (GraphDSL v1) to define LangGraph
conversation flows. Each `.flow.yaml` file in the `graphs/` directory fully
describes one graph's topology — nodes, transitions, routing, and config
references. All runtime infrastructure (state validation, AI tooling, vector
search, the `runTurn` lifecycle) is shared and never redefined per graph.

## Quick start: creating a new conversation flow

1. Copy `graphs/cfs.flow.yaml` as a template.
2. Give your graph a unique `graphId` and `version`.
3. Define your nodes, transitions, and routing.
4. Register handlers in a new `<graphId>Handlers.ts` module.
5. Add a loader entry in `graph.ts`.
6. Run the parity test pattern to verify compilation.

## File layout

```
graphs/
  cfs.flow.yaml           # CFS conversation flow definition (topology + config)
  AUTHORING.md            # This guide
src/langgraph/
  schema/
    graphDslTypes.ts       # Zod schema for the DSL (single source of truth)
    graphDslJsonSchema.json # JSON Schema for editor/CI validation
    handlerRegistry.ts     # Handler/router/config/configFn registry
    cfsHandlers.ts         # CFS handler + configFn registrations
    graphCompiler.ts       # DSL -> LangGraph StateGraph compiler + config merge
    graphLoader.ts         # YAML loader + validator + compiler pipeline
    dslToMermaid.ts        # DSL -> Mermaid flowchart generator + CLI
  state.ts                 # Shared canonical Zod state contract (CfsStateSchema)
  graph.ts                 # Runtime entrypoint (schema-compiled)
```

## YAML schema reference

### `graph` (required)

| Field        | Type     | Required | Description                                 |
|-------------|----------|----------|---------------------------------------------|
| graphId     | string   | yes      | Unique identifier for this graph.           |
| version     | string   | yes      | Semantic version.                           |
| description | string   | no       | Human-readable description.                 |
| entrypoint  | string   | yes      | Node ID where execution begins.             |
| tags        | string[] | no       | Tags for filtering/search.                  |

### `stateContractRef` (required)

Reference to the shared Zod state contract. Currently only
`"state.CfsStateSchema"` is supported. This ensures all graphs share the
same validated runtime state — no per-graph state redefinition.

### `nodes` (required, min 1)

Each node has:

| Field       | Type     | Required | Description                                             |
|------------|----------|----------|---------------------------------------------------------|
| id         | string   | yes      | Unique node ID within the graph.                        |
| kind       | enum     | yes      | `router`, `question`, `ingest`, `compute`, `integration`, `terminal` |
| handlerRef | string   | yes      | Registry key for the handler function.                  |
| helperRefs | string[] | no       | Additional helper function references.                  |
| reads      | string[] | no       | State paths this node reads (documentation/validation). |
| writes     | string[] | no       | State paths this node writes.                           |
| description| string   | no       | What this node does.                                    |

**Node kinds explained:**

- `router` — Passthrough node whose outgoing edges are driven by a router
  function. Does not modify state.
- `question` — Presents a question to the user and sets `awaiting_user: true`.
- `ingest` — Processes the user's answer and updates state.
- `compute` — AI-driven computation (use case selection, pillar determination,
  readout generation).
- `integration` — External service call (internet search, vector retrieval).
- `terminal` — End-of-flow node.

### `transitions` (required)

#### `transitions.static`

Fixed edges: `{ from: nodeId, to: nodeId | "__end__" }`.

Use `"__end__"` to terminate the graph (maps to LangGraph `END`).

#### `transitions.conditional`

Router-driven edges:

```yaml
- from: routerNodeId
  routerRef: "registry.key.for.router.function"
  destinations:
    returnValue1: targetNodeId
    returnValue2: anotherNodeId
    end: "__end__"
```

The `routerRef` must be registered in the handler registry. The router function
receives current state and returns a string key. That key is looked up in
`destinations` to determine the next node.

### `routingKeys` (optional)

State paths that drive routing decisions. These are informational and used for
compile-time documentation. Example:

```yaml
routingKeys:
  - session_context.step
  - session_context.last_question_key
  - session_context.awaiting_user
```

### `runtimeConfigRefs` (optional)

| Field               | Type              | Description                                |
|--------------------|-------------------|--------------------------------------------|
| initConfigRef      | string            | Registry key for config initialization (fallback when no inline config is present). |
| modelAliases       | Record<str, str>  | Logical name -> model ID mapping.          |
| messagePolicyRef   | string            | Registry key for message review policy.    |
| promptSetRef       | string            | Registry key for prompt templates.         |
| deliveryPolicyRef  | string            | Registry key for output delivery config.   |
| exampleGeneratorRef| string            | Registry key for the `exampleGenerator` function. |
| overlayPrefixRef   | string            | Registry key for the `overlayPrefix` function.    |

When the YAML includes a `config` section with `aiPrompts`, the compiler builds
`GraphMessagingConfig` directly from YAML content + resolved function refs.
The `initConfigRef` is only called as a fallback when no inline `config` is present.

### `config` (optional — per-graph conversation settings)

The `config` block holds all static text and data that shapes conversation
behavior. When present, the compiler merges this with dynamic function refs
from `runtimeConfigRefs` to produce the `GraphMessagingConfig` singleton.

| Sub-key                     | Type                         | Description |
|-----------------------------|------------------------------|-------------|
| `steps`                     | `{ id, label }[]`            | Conversation step identifiers and display labels. |
| `models`                    | `Record<string, { model, temperature, maxRetries }>` | LLM model configs keyed by logical name. |
| `messagePolicy`             | `Record<string, { allowAIRephrase, forbidFirstPerson }>` | Per-message-type review policies. |
| `aiPrompts`                 | `Record<string, string>`     | Named AI prompt templates (use YAML block scalars for multi-line). |
| `questionTemplates`         | `{ key, question }[]`        | Question text keyed by identifier. Supports `{{name}}` and `{{examples}}` placeholders. |
| `clarifierRetryText`        | `Record<string, string>`     | Retry prompt text for clarification loops. |
| `clarificationAcknowledgement` | `string \| string[]`      | Acknowledgement phrases used before clarification replies. |
| `readoutVoice`              | `{ rolePerspective, voiceCharacteristics, behavioralIntent }` | Readout tone/voice settings. |
| `delivery`                  | `{ outputTargets, defaultOutputTargets, allowMultiTarget, overridesByTenant }` | Output delivery configuration. |

**Example:**

```yaml
config:
  aiPrompts:
    selectPersonaGroup: >-
      You select the single best persona_group from the provided list.
      Return JSON only: {"persona_group":"...","confidence":0.0-1.0}.
    assessRisk: |
      You are a Senior Strategic Risk Consultant...
      (multi-line prompt using literal block scalar)
  messagePolicy:
    intro: { allowAIRephrase: false, forbidFirstPerson: false }
    default: { allowAIRephrase: false, forbidFirstPerson: false }
  readoutVoice:
    rolePerspective: "Coach_Affirmative"
    voiceCharacteristics: "Energetic and optimistic"
    behavioralIntent: "Close on a motivational note"
```

### Dynamic config functions

Two config items contain logic and cannot be expressed in YAML:

- `exampleGenerator(params) -> string[]` — generates role/industry/goal examples
- `overlayPrefix(overlay) -> string` — maps overlay names to prefix text

These are registered in the handler registry under `configFn` keys and referenced
in `runtimeConfigRefs`:

```yaml
runtimeConfigRefs:
  exampleGeneratorRef: "cfs.exampleGenerator"
  overlayPrefixRef: "cfs.overlayPrefix"
```

Register them in your handler module:

```typescript
import { registerConfigFn } from "./handlerRegistry.js";
import { exampleGenerator, overlayPrefix } from "../flows/stepFlowConfig.js";

registerConfigFn("cfs.exampleGenerator", exampleGenerator);
registerConfigFn("cfs.overlayPrefix", overlayPrefix);
```

### `validation` (optional)

| Field               | Type     | Description                            |
|--------------------|----------|----------------------------------------|
| requiredStateFields | string[] | State paths that must exist at runtime.|
| invariants          | string[] | Human-readable invariant descriptions. |

## Writing handler code

Node handler functions follow a consistent signature:

```typescript
function myNode(state: CfsState): Partial<CfsState>
async function myNode(state: CfsState): Promise<Partial<CfsState>>
```

Return only the fields that changed. Use shared helpers:

- `pushAI(state, text, messageType)` — append an AI message
- `patchSessionContext(state, patch)` — update session routing fields
- `mergeStatePatch(state, ...patches)` — merge multiple partial updates

Router functions return a string destination key:

```typescript
function myRouter(state: CfsState): string {
  if (state.session_context.awaiting_user) return "end";
  return "nextNode";
}
```

## Per-graph handler modules

Each graph provides its own step node files organized by graph:

```
src/langgraph/flows/
  step1KnowYourCustomerNodes.ts   # CFS-specific handlers (current)
  step2NarrowDownUseCasesNodes.ts
  ...
```

A different graph would have its own handler files. The YAML `handlerRef`
values use graph-prefixed registry keys:

- CFS: `"step1.nodeInit"`, `"step2.nodeDetermineUseCases"`
- A future SE graph: `"se.step1.nodeQualifyLead"`, `"se.step2.nodeAssessNeeds"`

Shared helpers (`aiHelpers`, `utilities`, `primitives`, `vector`, `supabaseClient`)
remain in the common layer and are graph-agnostic.

## Registering handlers

Create a registration module (e.g., `src/langgraph/schema/myGraphHandlers.ts`):

```typescript
import { registerHandler, registerRouter, registerConfig, registerConfigFn } from "./handlerRegistry.js";
import { myNode, myRouter, myExampleGen, myOverlayPrefix } from "../flows/myNodes.js";

let registered = false;

export function resetMyGraphRegistration(): void {
  registered = false;
}

export function registerMyGraphHandlers(): void {
  if (registered) return;
  registered = true;

  registerHandler("myGraph.myNode", myNode);
  registerRouter("myGraph.myRouter", myRouter);
  registerConfigFn("myGraph.exampleGenerator", myExampleGen);
  registerConfigFn("myGraph.overlayPrefix", myOverlayPrefix);
}
```

## Compiling and running

### Development (dynamic compile on startup)

```typescript
import { registerMyGraphHandlers } from "./schema/myGraphHandlers.js";
import { loadAndCompileGraph } from "./schema/graphLoader.js";

registerMyGraphHandlers();
const graph = loadAndCompileGraph("graphs/myGraph.flow.yaml");
```

### LangGraph Studio

The `graph` export in `src/langgraph/graph.ts` is the Studio entrypoint.
It uses the schema-compiled graph automatically.

## Visualizing the graph with dslToMermaid

Generate a Mermaid flowchart from any graph YAML:

### CLI

```bash
npx tsx src/langgraph/schema/dslToMermaid.ts graphs/cfs.flow.yaml
```

This prints a Mermaid `flowchart TD` string to stdout. Paste it into any
markdown file for GitHub/VS Code rendering.

### Programmatic

```typescript
import { dslToMermaid } from "./schema/dslToMermaid.js";
import { loadGraphDsl } from "./schema/graphLoader.js";

const dsl = loadGraphDsl("graphs/cfs.flow.yaml");
const mermaid = dslToMermaid(dsl);
console.log(mermaid);
```

### Node shapes by kind

| Kind          | Mermaid shape     | Example                          |
|--------------|-------------------|----------------------------------|
| `router`     | Diamond           | `routeInitFlow{{"routeInitFlow"}}` |
| `question`   | Rounded rectangle | `askUserName("askUserName")`     |
| `ingest`     | Rectangle         | `ingestUserName["ingestUserName"]` |
| `compute`    | Diamond           | `nodeDetermineUseCases{{"nodeDetermineUseCases"}}` |
| `integration`| Stadium           | `internetSearch(["internetSearch"])` |
| `terminal`   | Triple circle     | `END_NODE((("END")))`            |

Nodes are grouped into `subgraph` blocks by step prefix when a step can be
inferred from the node's `description` or `id`.

## Validation

### Editor support

Point your YAML editor/LSP at `src/langgraph/schema/graphDslJsonSchema.json`
for autocomplete and inline validation.

### CI / pre-commit

```bash
npx tsc --noEmit   # type-check all modules
npm test            # runs parity + existing test suites
```

The schema test suite (`graphParity.test.ts`) verifies:

- DSL schema validation (required fields, valid kinds, non-empty nodes)
- Handler registry resolution (all refs resolve)
- Compiler preflight (entrypoint exists, state contract recognized)
- Schema topology (expected node IDs, edge counts)
- Schema functional behavior (correct state evolution on inputs)
- Schema config validation (YAML config has required keys and resolved functions)
- Mermaid generation (all node IDs and edges present in output)

## Rules

1. Never redefine state schema fields in a graph YAML. All state lives in the
   shared `CfsStateSchema`.
2. Every `handlerRef` and `routerRef` must resolve in the handler registry
   at compile time.
3. Use `"__end__"` (not `"END"`) for graph termination in YAML.
4. Keep node IDs unique within a graph.
5. Router passthrough nodes (kind: `router`) must have identity handlers
   `(s) => s` — they exist only to anchor conditional edges.
6. Dynamic config functions (`exampleGenerator`, `overlayPrefix`) stay in
   TypeScript and are referenced by registry key in `runtimeConfigRefs`.
7. When a `config` section with `aiPrompts` is present, the compiler uses
   it directly — `initConfigRef` is only a fallback for graphs without
   inline config.
