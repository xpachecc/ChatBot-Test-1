# GraphDSL Schema Architecture

> How the YAML schema drives LangGraph compilation, routing, and node execution — and how primitives and custom handlers fit together.

---

## 1. Overview

The GraphDSL is a declarative YAML schema that fully describes a conversation flow's **topology** (nodes + edges), **routing logic** (condition predicates), and **runtime configuration** (strings, prompts, models, policies). A single `flow.yaml` file is the source of truth for a conversation graph. The runtime infrastructure — state validation, AI tooling, vector search, signal agents — is **shared** and never redefined per-flow.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        flow.yaml (GraphDSL)                        │
│                                                                     │
│  graph:         Identity (graphId, version, entrypoint, tags)       │
│  nodes:         What runs    (router | question | ingest | ...)     │
│  transitions:   How they connect (static edges, conditional edges)  │
│  config:        What they say  (strings, prompts, routing rules)    │
│  validation:    Compile-time guardrails                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ buildGraphFromSchema(yamlPath)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LangGraph StateGraph (compiled)                  │
│  Nodes: handler functions (generic or custom)                       │
│  Edges: addEdge / addConditionalEdges                               │
│  State: CfsState channels with reducers                             │
│  Wrapped in CompiledGraph { graphId, compiled }                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Top-Level Schema Structure

```
GraphDslSchema
├── graph                   # Identity & metadata
│   ├── graphId             # Unique flow identifier (e.g. "cfs")
│   ├── version             # Semantic version
│   ├── description         # Human-readable purpose
│   ├── entrypoint          # First node to execute
│   └── tags[]              # Categorization
│
├── stateContractRef        # Zod schema reference (e.g. "state.CfsStateSchema")
│
├── nodes[]                 # Node catalog — the "what runs"
│   └── NodeDef             # (see Section 4)
│
├── transitions             # The "wiring" between nodes
│   ├── static[]            # Unconditional edges (from → to)
│   └── conditional[]       # Branching edges (from → router → destinations)
│
├── routingKeys[]           # State paths that influence routing (documentation)
│
├── runtimeConfigRefs       # Registry lookups for model aliases, policies
│
├── config                  # Per-graph conversation configuration
│   └── GraphConfigSchema   # (see Section 6)
│
└── validation              # Compile-time invariants
    ├── requiredStateFields[]
    └── invariants[]
```

### Relationship Diagram

```
                            ┌──────────────┐
                            │   GraphDsl   │
                            └──────┬───────┘
               ┌───────────────────┼───────────────────┐
               │                   │                   │
        ┌──────▼──────┐    ┌──────▼──────┐    ┌───────▼───────┐
        │   graph{}   │    │  nodes[]    │    │ transitions{} │
        │  (identity) │    │ (handlers)  │    │   (wiring)    │
        └─────────────┘    └──────┬──────┘    └───────┬───────┘
                                  │                   │
                           ┌──────▼──────┐    ┌───────▼───────┐
                           │  NodeDef    │    │ static[]      │
                           │ ┌─────────┐ │    │ conditional[] │
                           │ │nodeConfig│ │    └───────┬───────┘
                           │ │   OR     │ │            │
                           │ │handlerRef│ │    ┌───────▼──────────┐
                           │ └─────────┘ │    │ routingRules{}   │
                           └─────────────┘    │ (in config)      │
                                              └──────────────────┘
               ┌───────────────────┼───────────────────┐
               │                   │                   │
        ┌──────▼──────┐    ┌──────▼──────┐    ┌───────▼───────┐
        │ runtimeCfg  │    │  config{}   │    │  validation{} │
        │  Refs       │    │(GraphConfig)│    │ (invariants)  │
        └─────────────┘    └─────────────┘    └───────────────┘
```

---

## 3. Compilation Pipeline

The compilation pipeline transforms YAML → validated DSL → runnable LangGraph StateGraph.

```
   ┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
   │  flow.yaml  │───▶│  YAML parse  │───▶│  Zod validate │───▶│  preflight() │
   │  (on disk)  │    │  (yaml lib)  │    │ (GraphDslSchema)   │ (registry    │
   └─────────────┘    └──────────────┘    └───────────────┘    │  checks)     │
                                                                └──────┬───────┘
                                                                       │
   ┌──────────────────────────────────────────────────────────────────▼─────┐
   │                   buildGraphFromSchema(yamlPath) — graph.ts            │
   │                                                                        │
   │  1. loadGraphDsl(yamlPath)                                             │
   │     └── YAML parse + GraphDslSchema.parse() (Zod validation)          │
   │                                                                        │
   │  2. registerHandlersForGraph(graphId)                                  │
   │     └── cfs-handlers.ts: registerCfsHandlers()                         │
   │         ├── Registers custom handler functions                         │
   │         └── Registers router identity functions                        │
   │                                                                        │
   │  3. compileGraphFromDsl(dsl) ──────────────────────────────────────┐   │
   │     │                                                              │   │
   │     │  a. preflight(dsl) — validates all refs resolve:             │   │
   │     │     ├── stateContractRef ∈ supported contracts               │   │
   │     │     ├── entrypoint ∈ declared nodeIds                        │   │
   │     │     ├── every handlerRef → resolveHandler()                  │   │
   │     │     ├── every routerRef → routingRules exist OR resolveRouter│   │
   │     │     └── every transition target ∈ nodeIds ∪ {"__end__"}     │   │
   │     │                                                              │   │
   │     │  b. buildGraphMessagingConfigFromDsl(dsl)                    │   │
   │     │     ├── Inline config present? → setGraphMessagingConfig()   │   │
   │     │     └── No inline config? → resolveConfig(initConfigRef)()  │   │
   │     │                                                              │   │
   │     │  c. For each node:                                           │   │
   │     │     ├── Has handlerRef? → resolveHandler(ref) from registry  │   │
   │     │     └── Has nodeConfig? → createGenericHandler(node, config) │   │
   │     │         └── Delegates to question/greeting/display/ingest    │   │
   │     │                                                              │   │
   │     │  d. graph.setEntryPoint(entrypoint)                          │   │
   │     │                                                              │   │
   │     │  e. For each conditional transition:                         │   │
   │     │     ├── routingRules exist? → evaluateRoutingRules()         │   │
   │     │     └── else → resolveRouter(routerRef) from registry        │   │
   │     │                                                              │   │
   │     │  f. For each static transition: graph.addEdge(from, to)      │   │
   │     │                                                              │   │
   │     │  g. Return CompiledGraph { graphId, compiled: graph.compile()}│   │
   │     └──────────────────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Role |
|------|------|
| `schema/graph-loader.ts` | `loadGraphDsl()` — YAML parse + Zod validation |
| `schema/graph-compiler.ts` | `compileGraphFromDsl()` — preflight + StateGraph assembly |
| `schema/handler-registry.ts` | Global Maps for handlers, routers, configs |
| `schema/graph-handler-modules.ts` | Per-graphId handler registration dispatch |
| `schema/cfs-handlers.ts` | CFS-specific handler registration |
| `schema/generic-handlers.ts` | `createGenericHandler()` — YAML-driven handler factories |
| `graph.ts` | `buildCfsGraph()`, `runTurn()` — top-level orchestration |

---

## 4. Node Architecture — Kinds, Handlers, and the Generic/Custom Split

Every node in the YAML declares a **kind** (semantic role) and resolves to a handler function at compile time. The handler is either **custom** (a TypeScript function registered in the handler registry) or **generic** (auto-generated from `nodeConfig` in the YAML).

```
                       ┌──────────────────────────┐
                       │        NodeDef            │
                       │  id: string               │
                       │  kind: NodeKind           │
                       │  handlerRef?: string  ────┼──── Custom path
                       │  nodeConfig?: NodeConfig ─┼──── Generic path
                       │  reads/writes: string[]   │
                       │  signalAgents?: boolean   │
                       └────────────┬─────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
             ┌──────▼──────┐                 ┌──────▼──────┐
             │  handlerRef │                 │  nodeConfig │
             │  (custom)   │                 │  (generic)  │
             └──────┬──────┘                 └──────┬──────┘
                    │                               │
                    ▼                               ▼
          ┌─────────────────┐            ┌────────────────────────┐
          │ handler-registry│            │  generic-handlers.ts   │
          │  .get(ref)      │            │  createGenericHandler() │
          │                 │            │                        │
          │ Returns a TS    │            │ Inspects nodeConfig:   │
          │ function that   │            │ ├── .question → ask    │
          │ the flow author │            │ ├── .greeting → greet  │
          │ wrote manually  │            │ ├── .display  → show   │
          │                 │            │ └── .ingest   → ingest │
          └─────────────────┘            └────────────────────────┘
```

### Node Kinds

| Kind | Purpose | Typical Handler Source |
|------|---------|----------------------|
| `router` | Identity passthrough; routing driven by conditional transitions | Custom (identity fn `s => s`) |
| `question` | Asks the user something; sets `awaiting_user: true` | Generic (from `nodeConfig.question` or `.greeting`) |
| `ingest` | Processes user answer; updates state | Generic (from `nodeConfig.ingest`) or Custom |
| `compute` | AI-driven logic (selection, generation, readout) | Custom |
| `integration` | External API call (Firecrawl, vector search) | Custom |
| `terminal` | End-of-flow marker | Either |

### The `nodeConfig` Discriminated Union

When a node has `nodeConfig` instead of `handlerRef`, exactly one config block determines which generic factory is used:

```
NodeConfigSchema
├── question?:  QuestionNodeConfigSchema
│   ├── stringKey / stringKeys[]      # Text to send
│   ├── questionKey                   # Routing identifier
│   ├── questionPurpose               # Metadata tag
│   ├── targetVariable                # State field name
│   ├── interpolateFrom?              # Template variable → state path
│   ├── allowAIRephrase?              # Post-process with LLM
│   ├── prefix?                       # Prepend user's name/role
│   │   ├── stateField                # State path (pipe-delimited fallback)
│   │   └── fallback                  # Default if state empty
│   └── rephraseContext?              # Context for AI rephrase
│       ├── industryField, roleField, useCaseGroupsField
│       ├── actorRole, tone
│
├── greeting?:  GreetingNodeConfigSchema
│   ├── stringKeys[]                  # Ordered messages to send
│   ├── afterQuestionKey?             # Sets last_question_key
│   └── initialSessionContext?        # Patches session_context
│
├── display?:   DisplayNodeConfigSchema
│   ├── statePath                     # State path to read content from
│   ├── fallbackMessage?              # If state path is empty
│   └── appendDownloadUrl?            # Attach download link
│       ├── stateField                # URL state path
│       └── fallbackPattern           # Pattern with {{session_id}}
│
└── ingest?:    IngestNodeConfigSchema
    └── affirmativeCheckConfig?       # Yes/No gating
        ├── rejectStringKey           # Message on "no"
        ├── rejectPatch               # session_context patch on reject
        ├── acceptQuestionConfig?     # Ask next question on "yes"
        │   ├── stringKey, questionKey, questionPurpose, targetVariable
        ├── acceptStringKey?          # Send message on "yes"
        └── acceptPatch               # session_context patch on accept
```

---

## 5. Routing Architecture

Routing determines which node executes next. There are two mechanisms:

### 5a. Static Transitions (unconditional)

```yaml
static:
  - { from: sendGreeting, to: "__end__" }
  - { from: ingestTimeframe, to: knowYourCustomerEcho }
```

These compile to `graph.addEdge(from, to)` — always follow this path.

### 5b. Conditional Transitions (branching)

```yaml
conditional:
  - from: routeInitFlow
    routerRef: "cfs.routeInitFlow"
    destinations:
      sendIntro: sendIntroAndAskUseCaseGroup
      askName: askUserName
      end: "__end__"
```

At compile time, the compiler checks if `config.routingRules[routerNodeId]` exists:

```
┌───────────────────────────────────────────────────────────────┐
│             Conditional Transition Resolution                  │
│                                                                │
│  Has routingRules[from]?                                       │
│  ├── YES → Build evaluateRoutingRules() closure               │
│  │         Rules evaluated top-to-bottom against CfsState      │
│  │         First matching rule.goto wins                       │
│  │         "default" rule used as fallback                     │
│  │                                                             │
│  └── NO  → resolveRouter(routerRef) from handler-registry     │
│            A custom TypeScript function (state => destination) │
└───────────────────────────────────────────────────────────────┘
```

### 5c. Routing Rules Engine

The `routingRules` block in config maps router node IDs to ordered rule arrays:

```yaml
routingRules:
  routeInitFlow:
    - when: { primitive_counter: 0, messages_empty: true }
      goto: sendIntroAndAskUseCaseGroup
    - when: { awaiting_user: true, last_question_key: "S1_NAME" }
      goto: ingestUserName
    - default: end
```

Each `when` clause is a conjunction (all conditions must be true). The routing engine evaluates rules top-to-bottom:

```
┌──────────────────────────────────────────────────────────┐
│              evaluateRoutingRules(rules, state)           │
│                                                           │
│  for rule in rules:                                       │
│    if rule.when exists:                                   │
│      if evaluateWhen(state, rule.when):                   │
│        return rule.goto                                   │
│    else if rule.default exists:                           │
│      return rule.default                                  │
│  return "end"                                             │
└──────────────────────────────────────────────────────────┘
```

### 5d. Condition Predicates (the `when` clause vocabulary)

The `evaluateWhen()` function supports these built-in predicates and state path operators:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     When-Clause Predicates                          │
│                                                                     │
│  BUILT-IN (scalar match against session_context):                   │
│  ┌────────────────────┬───────────────────────────────────────────┐ │
│  │ awaiting_user      │ session_context.awaiting_user === value   │ │
│  │ started            │ session_context.started === value         │ │
│  │ last_question_key  │ session_context.last_question_key === val │ │
│  │ primitive_counter  │ session_context.primitive_counter === val │ │
│  │ messages_empty     │ messages.length === 0 (boolean)          │ │
│  │ trace_includes     │ reason_trace.includes(value)             │ │
│  │ trace_not_includes │ !reason_trace.includes(value)            │ │
│  │ step_equals        │ session_context.step === value            │ │
│  │ last_answer_equals │ lastHumanMessage.content === value        │ │
│  └────────────────────┴───────────────────────────────────────────┘ │
│                                                                     │
│  STATE PATH OPERATORS (dynamic path into any state slice):          │
│  ┌──────────────────────┬─────────────────────────────────────────┐ │
│  │ state_path_empty     │ getByPath(state, path) is null/empty   │ │
│  │ state_path_not_empty │ getByPath(state, path) has a value     │ │
│  │ state_path_equals    │ getByPath(state, path) === value       │ │
│  │ state_path_not_equals│ getByPath(state, path) !== value       │ │
│  │ state_path_length_gt │ getByPath(state, path).length > value  │ │
│  └──────────────────────┴─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Config Architecture — Per-Graph Conversation Settings

The `config` block (GraphConfigSchema) holds all data a flow needs at runtime. It is compiled into a `GraphMessagingConfig` object and stored per-graphId.

```
GraphConfigSchema
│
├── meta                        # UI metadata
│   ├── flowTitle, flowDescription
│   └── steps[] ──────────────────── FlowStepMeta
│       ├── key, label, order
│       ├── countable, totalQuestions
│       └── countingStrategy ──── questionKeyMap | useCaseSelect
│                                  readoutReady | dynamicCount
│
├── strings                     # All user-facing text, keyed by dotted name
│   └── { "step1.greet": "Welcome!", ... }
│
├── aiPrompts                   # All LLM system prompts, keyed by name
│   └── { "selectPersonaGroup": "You select...", ... }
│
├── routingRules                # Per-router ordered rule arrays
│   └── { routeInitFlow: [ { when: {...}, goto: "..." }, ... ] }
│
├── models                      # Named model configurations
│   └── { default: { model, temperature, maxRetries } }
│
├── messagePolicy               # Per-MessageType AI review rules
│   └── { intro: { allowAIRephrase, forbidFirstPerson }, ... }
│
├── ingestFieldMappings         # How generic ingest maps answers → state
│   └── { S1_NAME: { targetField, sanitizeAs, captureObjective } }
│
├── options                     # Static button/option sets per questionKey
│   └── { CONFIRM_START: ["Yes", "No"] }
│
├── dynamicOptions              # Runtime-resolved options
│   └── { S1_USE_CASE_GROUP: { source: "service", serviceRef: "..." } }
│   └── { S3_USE_CASE_SELECT: { source: "state", statePath: "..." } }
│
├── progressRules               # Step progress calculation
│   ├── questionKeyMap          # questionKey → step progress index
│   ├── dynamicCountField       # State path for dynamic question count
│   └── dynamicCountStepKey     # Which step uses dynamic counting
│
├── continuationTriggers        # Auto-advance rules
│   └── [{ traceIncludes, notReadoutReady, steps[], items[] }]
│
├── questionTemplates           # Long-form question templates
│   └── [{ key, question (with {{placeholders}}) }]
│
├── overlayPrefixes             # Persona overlay text prefixes
├── exampleTemplates            # Dynamic examples by topic
├── clarifierRetryText          # Step-specific retry prompts
├── clarificationAcknowledgement  # Random ack before clarifications
│
├── readoutVoice                # AI writing style for readout
│   └── { rolePerspective, voiceCharacteristics, behavioralIntent }
├── readout                     # Section structure for readout document
│   ├── sectionKeys[]
│   └── sectionContract (prose)
├── delivery                    # Output delivery configuration
│   └── { outputTargets, allowMultiTarget, overridesByTenant }
│
├── signalAgents                # Background agent orchestration
│   └── { enabled, ttlMs }
│
└── steps[]                     # Step definitions (id + label)
```

### Config → GraphMessagingConfig Transformation

```
┌─────────────────────┐         buildGraphMessagingConfigFromDsl()         ┌───────────────────────┐
│   YAML config {}    │ ──────────────────────────────────────────────────▶│ GraphMessagingConfig  │
│                     │                                                    │                       │
│ strings             │ → strings                                          │ strings               │
│ aiPrompts           │ → aiPrompts                                        │ aiPrompts             │
│ messagePolicy       │ → messagePolicy (typed Record<MessageType, ...>)   │ messagePolicy         │
│ readoutVoice        │ → readoutRolePerspective, ...Characteristics, ...  │ readoutRolePerspective│
│ delivery            │ → readoutOutputTargets, allowMultiTargetDelivery   │ readoutOutputTargets  │
│ overlayPrefixes     │ → overlayPrefix() closure                          │ overlayPrefix()       │
│ exampleTemplates    │ → exampleGenerator() closure                       │ exampleGenerator()    │
│ meta.steps          │ → meta { flowTitle, steps[] }                      │ meta                  │
│ progressRules       │ → progressRules                                    │ progressRules         │
│ ingestFieldMappings │ → ingestFieldMappings                              │ ingestFieldMappings   │
│ signalAgents        │ → signalAgents { enabled, ttlMs }                  │ signalAgents          │
└─────────────────────┘                                                    └───────────────────────┘
```

---

## 7. Primitives Architecture — Reusable Building Blocks

Primitives are the lowest-level reusable operations. They are **not** LangGraph nodes — they are helper classes invoked **inside** node handlers (both generic and custom). Each primitive:
- Extends `Primitive` (sync) or `AsyncPrimitive` (async)
- Has a `name: PrimitiveName` for telemetry
- Logs start/end times and increments `primitive_counter`
- Takes `(state, params)` and returns `Partial<CfsState>`

```
┌─────────────────────────────────────────────────────────────────┐
│                     Primitive Hierarchy                          │
│                                                                  │
│  ┌───────────────┐       ┌───────────────────┐                  │
│  │   Primitive    │       │  AsyncPrimitive   │                  │
│  │  (sync base)   │       │  (async base)     │                  │
│  └───────┬───────┘       └────────┬──────────┘                  │
│          │                        │                              │
│  ┌───────▼────────────────────────▼───────────────────────┐     │
│  │              Interaction Primitives                     │     │
│  │  ┌─────────────┐  ┌──────────────────┐  ┌───────────┐ │     │
│  │  │ AskQuestion │  │ CaptureObjective │  │ Ack       │ │     │
│  │  │             │  │                  │  │ Emotion   │ │     │
│  │  └─────────────┘  └──────────────────┘  └───────────┘ │     │
│  │  ┌────────────────────┐                                │     │
│  │  │ applyUserAnswer()  │ (standalone fn, not a class)   │     │
│  │  └────────────────────┘                                │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │            Conversation Primitives (higher-order)       │     │
│  │  ┌───────────────┐  ┌────────────────┐  ┌───────────┐ │     │
│  │  │AskWithRephrase│  │ClarifyIfVague  │  │Questionnaire│     │
│  │  │               │  │                │  │Loop        │ │     │
│  │  └───────────────┘  └────────────────┘  └───────────┘ │     │
│  │  ┌──────────────────┐  ┌──────────────────────────┐   │     │
│  │  │IngestDispatcher  │  │NumericSelectionIngest    │   │     │
│  │  └──────────────────┘  └──────────────────────────┘   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │              Compute Primitives                         │     │
│  │  ┌──────────────┐  ┌───────────────────┐  ┌─────────┐ │     │
│  │  │ VectorSelect │  │MultiSectionDoc    │  │DocStyle │ │     │
│  │  │              │  │Builder            │  │QA       │ │     │
│  │  └──────────────┘  └───────────────────┘  └─────────┘ │     │
│  └────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### How Generic Handlers Use Primitives

```
┌──────────────────────────────────────────────────────────────────────┐
│               Generic Handler → Primitive Call Chain                  │
│                                                                      │
│  createQuestionHandler(QuestionNodeConfig)                           │
│  │                                                                   │
│  ├── allowAIRephrase=true?                                           │
│  │   └── askWithRephrase.run(state, { baseQuestion, rephraseCtx })  │
│  │       └── internally uses AskQuestion + rephraseQuestionWithAI    │
│  │                                                                   │
│  └── allowAIRephrase=false?                                          │
│      └── PrimitivesInstance.AskQuestion.run(state, { question, ... })│
│                                                                      │
│  createGreetingHandler(GreetingNodeConfig)                           │
│  └── pushAI(state, text, "intro")  (for each stringKey)             │
│  └── patchSessionContext(state, { started: true, ... })              │
│                                                                      │
│  createIngestHandler(IngestNodeConfig)                               │
│  ├── affirmativeCheckConfig?                                         │
│  │   ├── isAffirmativeAnswer(answer)?                                │
│  │   │   ├── NO  → pushAI(rejectMessage) + patchSessionContext       │
│  │   │   └── YES → acceptQuestionConfig?                             │
│  │   │       ├── AskQuestion.run(state, nextQuestion)                │
│  │   │       └── or pushAI(acceptMessage) + patchSessionContext      │
│  │   └── No config → applyUserAnswer(state)                         │
│  │       └── Uses ingestFieldMappings from GraphMessagingConfig      │
│  └── No affirmativeCheckConfig                                       │
│      └── applyUserAnswer(state)                                      │
│                                                                      │
│  createDisplayHandler(DisplayNodeConfig)                             │
│  └── getByPath(state, statePath)  (from core/helpers/path.ts)       │
│  └── pushAI(state, content + downloadUrl)                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. State Architecture

All flows share the `CfsState` schema (Zod-validated). The schema is defined in `state.ts` and composed from **modular slice schemas** located in `slices/`. Each slice is an independent Zod schema file:

```
state.ts (CfsStateSchema)           slices/
├── messages[]                       ├── session-context.ts  ← SessionContextSchema
├── overlay_active                   ├── user-context.ts     ← UserContextSchema
├── session_context ─────────────   ├── use-case-context.ts ← UseCaseContextSchema
├── user_context ────────────────   ├── readout-context.ts  ← ReadoutContextSchema
├── use_case_context ────────────   ├── relationship-context.ts
├── relationship_context ────────   ├── vector-context.ts
├── vector_context ──────────────   ├── internet-search-context.ts
├── internet_search_context ─────   ├── context-weave-index.ts
├── readout_context ─────────────   ├── primitive-log.ts
└── context_weave_index ─────────   └── index.ts (barrel re-exports)
```

### Slice Details

```
CfsState
├── messages[]              # Chat history (HumanMessage / AIMessage)
├── overlay_active          # Current persona overlay (OverlayName enum)
├── session_context         # Session lifecycle (shallow-merge reducer)
│   ├── session_id, tenant_id, graph_id
│   ├── step, started, awaiting_user
│   ├── last_question_key, step_question_index
│   ├── step_clarifier_used, primitive_counter
│   ├── primitive_log[], reason_trace[]
│   ├── summary_log[], guardrail_log[], transition_log[]
│   ├── response_log[], assumption_log[], rank_log[]
│   ├── recall_log[], challenge_log[], milestone_log[]
│   ├── recommendation_log[]
│   ├── role_assessment_message, role_assessment_examples[]
│   ├── archive, suggested_options
│   └── (custom fields via patches)
├── user_context            # Collected user data
│   ├── first_name, persona_role, persona_clarified_role
│   ├── industry, goal_statement, timeframe
│   ├── persona_group, persona_group_confidence
│   ├── market_segment, outcome
│   └── (extensible per flow)
├── use_case_context        # Use case selection & discovery
│   ├── use_case_groups[], selected_use_cases[]
│   ├── discovery_questions[], pillars[]
│   └── use_cases_prioritized[]
├── relationship_context    # Trust/sentiment tracking + signal agent results
├── vector_context          # Retrieved vector snippets
├── internet_search_context # Firecrawl results
├── readout_context         # Generated readout document
│   ├── status, rendered_outputs
│   └── delivery { download { url } }
└── context_weave_index     # Entity/phrase extraction
    ├── user_phrases[]
    └── entities[]
```

### State Channel Reducers

```
┌─────────────────────┬──────────────────────────────────────────┐
│ Channel             │ Reducer Strategy                         │
├─────────────────────┼──────────────────────────────────────────┤
│ messages            │ Replace (last-write-wins)                │
│ session_context     │ Shallow merge: { ...left, ...right }     │
│ user_context        │ Replace                                  │
│ use_case_context    │ Replace                                  │
│ readout_context     │ Replace                                  │
│ vector_context      │ Replace                                  │
│ internet_search_ctx │ Replace                                  │
│ relationship_ctx    │ Replace                                  │
│ context_weave_index │ Replace                                  │
│ overlay_active      │ Replace                                  │
└─────────────────────┴──────────────────────────────────────────┘
```

`session_context` is the only slice with **shallow merge** — node handlers can patch individual fields without overwriting the entire object. All other slices use **last-write-wins** replacement.

---

## 9. Runtime Execution — `runTurn()`

Each user message triggers one `runTurn()` call:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          runTurn(graphApp, state, userText)              │
│                                                                          │
│  1. Append HumanMessage to state.messages                               │
│  2. setActiveGraphId(graphApp.graphId)                                  │
│     └── So requireGraphMessagingConfig() resolves to correct config     │
│                                                                          │
│  3. Start signalOrchestrator in parallel (if enabled)                   │
│     └── Background agents analyze user text for trust/sentiment         │
│                                                                          │
│  4. graphApp.compiled.invoke(nextState)                                 │
│     └── LangGraph executes: entrypoint → router → node → edges → ...   │
│     └── Each node handler runs, returns Partial<CfsState>               │
│     └── Reducers merge patches into state                               │
│                                                                          │
│  5. Merge signal agent results into relationship_context                │
│                                                                          │
│  6. Post-process last AI message:                                       │
│     ├── Prepend clarification ack if step_clarifier_used                │
│     └── AI rephrase if messagePolicy.allowAIRephrase                   │
│                                                                          │
│  7. Return final CfsState                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Handler Registry Architecture

The handler registry is a set of global `Map` objects that decouple YAML references from TypeScript implementations.

```
┌───────────────────────────────────────────────────────────────────┐
│                    Handler Registry                                │
│                                                                    │
│  handlers: Map<string, NodeHandler>                                │
│  ├── "cfs.routeInitFlow"              → (s) => s  (identity)      │
│  ├── "cfs.routeUseCaseQuestionLoop"   → (s) => s  (identity)      │
│  ├── "cfs.routePillarsLoop"           → (s) => s  (identity)      │
│  ├── "cfs.routeAfterIngestUseCaseSelection" → (s) => s (identity) │
│  ├── "step1.nodeStep1Ingest"          → nodeStep1Ingest            │
│  ├── "step1.nodeKnowYourCustomerEcho" → nodeKnowYourCustomerEcho  │
│  ├── "step1.nodeInternetSearch"       → nodeInternetSearch         │
│  ├── "step2.nodeDetermineUseCases"    → nodeDetermineUseCases      │
│  ├── "step2.nodeIngestUseCaseSelection" → nodeIngestUseCaseSelection│
│  ├── "step2.nodeDetermineUseCaseQuestions" → nodeDetermineUseCase..│
│  ├── "step3.nodeAskUseCaseQuestions"  → nodeAskUseCaseQuestions    │
│  ├── "step3.nodeDeterminePillars"     → nodeDeterminePillars       │
│  └── "step4.nodeBuildReadout"         → nodeBuildReadout           │
│                                                                    │
│  routers: Map<string, RouterFn>                                    │
│  └── (used only when routingRules are absent for a router node)   │
│                                                                    │
│  configs: Map<string, ConfigInitFn>                                │
│  └── Legacy: initConfigRef → function that calls setConfig()      │
│                                                                    │
│  configFns: Map<string, ConfigFn>                                  │
│  └── Runtime config closures (overlayPrefix, exampleGenerator)    │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                Handler Module Registry                             │
│                                                                    │
│  handlerModules: Map<string, HandlerRegistrationFn>                │
│  ├── "cfs" → registerCfsHandlers                                   │
│  └── (new flows add their own registration function here)         │
│                                                                    │
│  registerHandlersForGraph(graphId)                                 │
│  └── Looks up and calls the registration function for graphId     │
└───────────────────────────────────────────────────────────────────┘
```

---

## 11. End-to-End Data Flow Example

Tracing a single user turn through the system — user says "Healthcare" when `last_question_key` is `S1_INDUSTRY`:

```
User: "Healthcare"
       │
       ▼
  runTurn(cfsGraph, state, "Healthcare")
       │
       ├── Append HumanMessage("Healthcare") to messages
       ├── setActiveGraphId("cfs")
       │
       ▼
  LangGraph invoke(state)
       │
       ▼
  routeInitFlow (entrypoint, identity handler)
       │
       ├── evaluateRoutingRules(routeInitFlow rules, state)
       │   └── when: { awaiting_user: true, last_question_key: "S1_INDUSTRY" }
       │       → matches → goto: ingestIndustry
       │
       ▼
  ingestIndustry (custom handler: step1.nodeStep1Ingest)
       │
       ├── Reads last human message: "Healthcare"
       ├── Looks up ingestFieldMappings["S1_INDUSTRY"]
       │   └── { targetField: "user_context.industry", sanitizeAs: "industry" }
       ├── Calls AI sanitize: "Healthcare" → "Healthcare"
       ├── Updates user_context.industry = "Healthcare"
       ├── Patches session_context: { awaiting_user: false, ... }
       │
       ▼
  Static transition: ingestIndustry → __end__
       │
       ▼
  Return to runTurn()
       │
       ├── Post-process (no AI rephrase for ingest)
       └── Return updated CfsState
```

---

## 12. Adding a New Flow — What's Required

```
┌───────────────────────────────────────────────────────────────────┐
│  To add a new flow (e.g. "seQualify"):                            │
│                                                                    │
│  1. YAML: clients/<tenantId>/flows/<flowId>/flow.yaml             │
│     └── graph.graphId: "seQualify"                                │
│     └── nodes, transitions, config, routingRules                  │
│                                                                    │
│  2. Handlers: src/langgraph/schema/seQualify-handlers.ts          │
│     └── export function registerSeQualifyHandlers() { ... }       │
│     └── Register custom handlers + router identity functions      │
│                                                                    │
│  3. Registration: src/langgraph/schema/graph-handler-modules.ts   │
│     └── handlerModules.set("seQualify", registerSeQualifyHandlers)│
│                                                                    │
│  4. Node logic: src/langgraph/core/nodes/seQualify/*.ts           │
│     └── Custom compute/integration/ingest handlers                │
│                                                                    │
│  5. App config: clients/<tenantId>/apps/<appId>/app.config.json   │
│     └── { "flowId": "<flowId>", "template": "chatbot1" }         │
│                                                                    │
│  Zero changes needed to:                                           │
│  - graph.ts, server.ts, graph-compiler.ts, graph-loader.ts       │
│  - State schema (CfsState is shared)                              │
│  - Generic handlers (reusable via nodeConfig)                     │
│  - Routing engine (reusable via routingRules)                     │
└───────────────────────────────────────────────────────────────────┘
```

---

## 13. Schema Validation Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Validation Layers                            │
│                                                                  │
│  Layer 1: JSON Schema (graphDslJsonSchema.json)                 │
│  └── Editor-time: autocomplete, inline errors in IDE            │
│                                                                  │
│  Layer 2: Zod Schema (GraphDslSchema.parse())                   │
│  └── Load-time: structural validation + defaults                │
│                                                                  │
│  Layer 3: Preflight (preflight() in graph-compiler.ts)          │
│  └── Compile-time: all refs resolve, all targets exist          │
│                                                                  │
│  Layer 4: YAML validation block                                 │
│  └── Documentation: requiredStateFields, invariant descriptions │
│                                                                  │
│  Layer 5: Runtime (CfsStateSchema.parse() in runTurn)           │
│  └── Every state transition validated by Zod                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 14. Primitives, Helpers, and Tools — Detailed Descriptions

This section catalogs every primitive, helper, and tool/service in the system with descriptions of their purpose and how they fit into the graph execution model.

### 14.1 Primitives — Interaction Layer

These are the lowest-level building blocks for user interaction. Each extends `Primitive` (sync) or `AsyncPrimitive` (async), logs telemetry, and increments `primitive_counter`.

| Name | Description |
|------|-------------|
| **AskQuestion** | Core question primitive. Pushes an AI message with the question text, sets `last_question_key` and `awaiting_user: true`. Used directly by generic question handlers and as a building block for higher-order primitives. |
| **CaptureObjective** | Normalizes a raw goal statement (whitespace cleanup) and writes it to `use_case_context.objective_normalized`. Called during ingest when `captureObjective: true` in `ingestFieldMappings`. |
| **AcknowledgeEmotion** | Generates a sentiment-appropriate acknowledgement ("Understood. That pressure is real." for concerned, neutral otherwise). Runs on every ingest via `applyUserAnswer`. |
| **applyUserAnswer** | Standalone async function (not a class). The default ingest handler: reads the last human message, looks up `ingestFieldMappings` for the current `last_question_key`, sanitizes via AI, writes to the target state field, and optionally captures the objective. Falls back to hardcoded field mapping if no config mapping exists. |

### 14.2 Primitives — Conversation Layer

Higher-order primitives that compose interaction primitives with AI services and control flow logic.

| Name | Description |
|------|-------------|
| **AskWithRephrase** | Wraps AskQuestion with optional AI rephrasing. When `allowAIRephrase` is true, calls `rephraseQuestionWithAI` to rewrite the question using industry/role/use-case context, then pushes the rephrased version. Used by generic question handlers for context-aware questions. |
| **ClarifyIfVague** | When a user answer is vague (determined by a callback), fetches suggestions (e.g., sub-industries from internet search), sends a clarification message with examples, and sets `step_clarifier_used: true`. Used in the industry clarification flow. |
| **QuestionnaireLoop** | Manages a multi-question loop: presents questions one at a time, captures answers, optionally assesses risk per answer via `processAnswer` callback, advances the index, and completes when all questions are answered. Used for Step 3 discovery questions. |
| **IngestDispatcher** | Dispatches to a handler function based on `last_question_key`. Replaces large if/switch chains in ingest nodes by mapping question keys to handler functions. |
| **NumericSelectionIngest** | Parses numeric user selections (e.g., "1" or "1,3"), validates against an available items list, and returns selected names with a state patch. Used for use case selection in Step 2. |

### 14.3 Primitives — Compute Layer

AI-driven computation primitives for document generation, vector retrieval, and quality assurance.

| Name | Description |
|------|-------------|
| **VectorSelect** | Retrieves candidates from a source (e.g., Supabase pgvector), selects the best match with AI, and falls back to deterministic choice when AI is unavailable. Returns a state patch with the selected item and snippets. Used for persona group, market segment, and outcome selection. |
| **MultiSectionDocBuilder** | Builds a multi-section document by invoking the LLM per section key, with optional QA check and repair cycle. Used for readout generation (8 sections with analysis JSON context). |
| **DocStyleQa** | Runs a style/voice QA pass on a completed document. Checks grammar, tone, role conformance (Coach_Affirmative), and repairs failing sections. Post-processing step after MultiSectionDocBuilder. |
| **runAiCompute** | Generic AI compute function (not a class primitive): builds a prompt from config + inputs, calls the model, parses the response, and writes to a state path. Used by `nodeDeterminePillars` and future archetype-based compute nodes. |

### 14.4 Helpers

Pure functions and utilities that don't extend the Primitive base classes. They are called by primitives, handlers, and infrastructure code.

| Name | Description |
|------|-------------|
| **pushAI** | Creates an `AIMessage` with optional `message_type` metadata and appends it to the messages array. The fundamental way to send a message to the user. |
| **lastHumanMessage** | Scans messages backwards to find the most recent `HumanMessage`. Used by ingest handlers and routing predicates to read the user's latest input. |
| **lastAIMessage** | Scans messages backwards to find the most recent `AIMessage`. Used by `runTurn` for post-processing. |
| **mergeStatePatch** | Shallow-merges one or more `Partial<CfsState>` patches onto a base state. Used extensively by primitives to combine multiple state updates. |
| **patchSessionContext** | Shallow-merges a partial `session_context` object onto the current session context. The standard way to update session fields without overwriting unrelated keys. |
| **createInitialState** | Creates a fresh `CfsState` with a random session ID and default values. Used at the start of a new conversation. |
| **interpolate** | Replaces `{{placeholder}}` tokens in a string with values from a vars map. Used by question handlers for dynamic text like `"Hello {{name}}"`. |
| **configString** | Looks up a key in the graph's `strings` config (from `GraphMessagingConfig.strings`). Falls back to a provided default. The standard way to retrieve user-facing text. |
| **prependClarificationAcknowledgement** | Prepends a random acknowledgement phrase ("Thank you for the clarification.", "Understood", etc.) before a response when the user clarified a previous answer. |
| **opsExamplesForGoal** | Returns domain-specific operational area examples based on the user's goal and industry. Used for question template interpolation. |
| **buildCanonicalReadoutDocument** | Constructs a structured readout document object with sections, tables, citations, and evidence references. |
| **buildDeterministicScores** | Scores use case names against vector search results using similarity scores. Falls back to position-based scoring. |
| **buildFallbackFromSchema** | Builds a complete fallback analysis JSON for the readout when AI analysis fails. Provides default readiness levels, risk points, and tactic placeholders. |
| **computeFlowProgress** | Calculates step-by-step progress for the UI sidebar. Uses the `meta.steps` config with counting strategies (`questionKeyMap`, `useCaseSelect`, `dynamicCount`, `readoutReady`) to compute answered/total questions per step. |
| **detectSentiment** | Keyword-based sentiment detection: returns "positive", "concerned", or "neutral" from user text. Used by `applyUserAnswer` and signal agent extractors. |
| **isAffirmativeAnswer** | Checks if user text is an affirmative response (yes, yeah, sure, etc.). Used by generic ingest handlers for confirmation flows. |
| **SpanSanitizer** | Strips trailing punctuation from a string, returns fallback if empty. Used to clean names and roles for prefix text. |
| **TimeframeSanitizer** | Normalizes timeframe phrases (strips leading prepositions, ensures "in" prefix). |
| **sanitizeDiscoveryAnswer** | Cleans control characters and truncates to 600 chars. Used for discovery question answers. |
| **truncateTextToWordLimit** | Truncates text to a word limit. Used for risk statement length enforcement. |
| **parseJsonObject** | Safe JSON parse that returns `null` on failure. Used for AI response parsing. |
| **parsePillarsFromAi** | Parses AI pillar selection response JSON (`{"pillars":[{"name":"...","confidence":0.0-1.0}]}`). |
| **parseCompositeQuestions** | Parses numbered/bulleted AI output into an array of question strings. |
| **sanitizeNumericSelectionInput** | Validates and normalizes numeric selection input (strips non-numeric chars, detects invalid input). |
| **parseNumericSelectionIndices** | Parses "1,3" into `[1, 3]`, validates against max index. |
| **extractStringValuesFromMixedArray** | Extracts string values from mixed arrays of strings and objects. Used for risk data normalization. |
| **normalizeOptionalString** | Trims and nullifies empty or "default" strings. |
| **normalizePillarValues** | Deduplicates and cleans pillar name arrays. |
| **buildCaseInsensitiveLookupMap** | Builds a case-insensitive lookup map for allowed value validation. |
| **normalizeUseCasePillarEntries** | Normalizes mixed pillar input (strings or objects with name/confidence) into `PillarEntry[]`. |
| **normalizeDiscoveryQuestions** | Converts string array to `DiscoveryQuestionItem[]` with null response/risk fields. |
| **mergeDiscoveryQuestions** | Merges new discovery questions with existing ones, preserving prior responses. |
| **selectClarificationAcknowledgement** | Picks a random acknowledgement phrase from the configured list. |
| **nowMs** | Returns `Date.now()`. Used for primitive telemetry timestamps. |
| **clamp01** | Clamps a number to [0, 1]. Used for confidence/score normalization. |

### 14.5 Tools and Services

External integrations, AI service wrappers, and data access layers.

| Name | Description |
|------|-------------|
| **sanitizeUserInput** | AI guard: sends user input through GPT with field-type-specific instructions (name, role, industry, goal, timeframe) to clean, normalize, and standardize the value. |
| **reviewResponseWithAI** | AI guard: rewrites AI responses for natural tone, grammar, and optionally removes first-person pronouns. Applied post-generation when `messagePolicy.allowAIRephrase` is true. |
| **assessRiskWithAI** | AI guard: evaluates a discovery answer against industry/role/goal context to produce a risk assessment (`risk_detected`, `risk_statement`, `risk_domain`). Used per discovery question. |
| **rephraseQuestionWithAI** | AI service: rewrites a base question incorporating industry, role, and use case context in a specified actor role and tone. Called by `AskWithRephrase` primitive. |
| **selectPersonaGroup** | AI service: selects the best persona group from a list based on role and vector context snippets. Falls back to token-matching heuristic when no API key. |
| **selectMarketSegment** | AI service: selects the best market segment from a list based on industry and vector snippets. |
| **selectOutcomeName** | AI service: selects the best outcome name from a list based on goal, persona group, market segment, and vector snippets. |
| **resolvePersonaGroupFromRole** | Composite service: queries vector store for role context, then calls `selectPersonaGroup` with the retrieved snippets. Combines vector retrieval + AI selection. |
| **invokeChatModelWithFallback** | Low-level AI service: invokes a ChatOpenAI model with system + user messages, returns text content or a fallback string on failure. All AI calls route through this. |
| **getModel** | Model factory: returns a cached `ChatOpenAI` instance for a named alias (e.g., "knowYourCustomer", "readout"). Supports config overrides. |
| **getSanitizerModel** | Returns a shared GPT-3.5-turbo instance (temperature 0) used for sanitization, selection, and rephrase tasks. |
| **getRiskAssessmentModel** | Returns a shared GPT-4o instance (temperature 0.8) used for risk assessment and persona group selection. |
| **searchSupabaseVectors** | Vector service: queries Supabase pgvector via the `match_documents` RPC for similarity search against document embeddings. Supports doc type and metadata filtering. |
| **searchInternet** | Internet search service: calls Firecrawl API, ranks results by query relevance, and returns structured `InternetSearchResult[]`. |
| **isIndustryVague** | AI assessment: determines if an industry answer is too vague (e.g., just "healthcare") and needs sub-industry clarification. |
| **extractSubIndustries** | AI extraction: derives up to 3 sub-industry labels from internet search results for a given industry. |
| **getSubIndustrySuggestions** | Composite service: searches the internet for sub-industry information and extracts suggestions. Used by `ClarifyIfVague`. |
| **nodeInternetSearch** | Node handler: performs an internet search for the user's input, stores results in `internet_search_context`, and sends a summary message. |
| **rankInternetResults** | Scoring function: ranks internet search results by token overlap with the query. Title matches weighted 2x. |
| **getPersonaGroups** | Data service: fetches persona group names from Supabase `persona_groups` table. Cached after first call. |
| **getUseCaseGroups** | Data service: fetches use case group titles from Supabase `use_case_groups` table. Cached after first call. |
| **getPillarsForOutcome** | Data service: fetches pillar names for a given outcome via Supabase RPC `get_pillars_for_outcome`. |
| **getAllPillars** | Data service: fetches all pillar names from the Supabase `pillars` table. |
| **getSupabaseClient** | Client factory: creates and caches a Supabase client using environment variables. Shared across all data services. |
| **FirecrawlService** | Firecrawl API wrapper: performs safe web searches with URL allow-list filtering and page limits. |
| **isAllowedUrl** | Policy function: URL allow-list check for Firecrawl results (currently allows all). |

### 14.6 Signal Agents

Background heuristic agents that run in parallel with graph execution to assess user engagement, sentiment, and trust.

| Name | Description |
|------|-------------|
| **runSignalOrchestrator** | Orchestrator: runs all three signal agents in parallel with a TTL timeout, aggregates results using EMA (Exponential Moving Average), maintains signal history, and computes composite `overall_conversation_score`. |
| **runEngagementAgent** | Heuristic engagement scoring: evaluates follow-up ratio, elaboration depth, back-channeling, and topic continuity from user text. No LLM calls. |
| **runSentimentAgent** | Heuristic sentiment scoring: evaluates base valence, intensifier magnitude, pivot clauses, and future orientation from user text. No LLM calls. |
| **runTrustAgent** | Heuristic trust scoring: evaluates collaborative pronoun usage, vulnerability transparency, specificity/detail, and consistency alignment from user text. No LLM calls. |
| **extractEngagementFeatures** | Feature extractor: regex-based extraction of engagement signals (questions, elaboration, acknowledgements). |
| **extractSentimentFeatures** | Feature extractor: regex-based extraction of sentiment signals (valence, intensifiers, pivots, future orientation). |
| **extractTrustFeatures** | Feature extractor: regex-based extraction of trust signals (collaborative pronouns, vulnerability language, specificity). |

### 14.7 Routing Engine

The declarative routing system that evaluates YAML-defined rules against graph state.

| Name | Description |
|------|-------------|
| **evaluateRoutingRules** | Top-level routing function: iterates ordered rules, evaluates each `when` clause, returns the first matching `goto` destination or the `default`. |
| **evaluateWhen** | Condition evaluator: checks all predicates in a `when` clause as a conjunction (all must be true). Dispatches to built-in predicates or state path operators. |
| **evalStatePath** | State path operator: evaluates dynamic path expressions (`empty`, `not_empty`, `equals`, `not_equals`, `length_gt`) against any state field. |

---

## Appendix A: Complete Primitives, Helpers, and Tools Reference

> All Location paths are relative to `src/langgraph/`.

### A.1 Primitives

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| AskQuestion | Primitive | `core/primitives/interaction/ask-question.ts` | Pushes question text as AI message, sets `awaiting_user: true`. **Args:** `(state: CfsState, { question: string, questionKey: string, questionPurpose?: string, targetVariable?: string })` |
| CaptureObjective | Primitive | `core/primitives/interaction/capture-objective.ts` | Normalizes a raw goal and writes to `use_case_context.objective_normalized`. **Args:** `(state: CfsState, { rawGoal: string })` |
| AcknowledgeEmotion | Primitive | `core/primitives/interaction/acknowledge-emotion.ts` | Generates sentiment-appropriate acknowledgement message. **Args:** `(state: CfsState, { sentiment: "positive" \| "neutral" \| "concerned" })` |
| applyUserAnswer | Primitive | `core/primitives/interaction/apply-user-answer.ts` | Default ingest: reads last human message, looks up `ingestFieldMappings`, sanitizes via AI, writes to target state field. **Args:** `(state: CfsState) → Promise<Partial<CfsState>>` |
| AskWithRephrase | Primitive | `core/primitives/conversation/ask-with-rephrase.ts` | Asks a question with optional AI rephrasing using industry/role/use-case context. **Args:** `(state: CfsState, { baseQuestion: string, questionKey: string, questionPurpose?: string, targetVariable?: string, prefix?: string, allowAIRephrase?: boolean, rephraseContext?: { industry?, role?, useCaseGroups?, actorRole?, tone? } })` |
| ClarifyIfVague | Primitive | `core/primitives/conversation/clarify-if-vague.ts` | When a value is vague, fetches suggestions and asks for clarification. **Args:** `(state: CfsState, { value: string, isVague: (v) → boolean, fetchSuggestions: (v) → { suggestions, results? }, buildClarificationMessage: (v, suggestions) → string, buildExamplesMessage?: (suggestions) → string, questionKey: string, extraPatch?: (suggestions, results?) → Partial<CfsState> })` |
| QuestionnaireLoop | Primitive | `core/primitives/conversation/questionnaire-loop.ts` | Multi-question loop: presents questions one at a time, captures answers, optionally assesses risk, advances index. **Args:** `(state: CfsState, { questions: Array<{ question, response?, risk?, risk_domain? }>, questionKey: string, buildPrompt: (q, idx, total) → string, sanitizeAnswer: (raw) → string, processAnswer?: (state, question, answer) → { risk?, risk_domain? }, closingMessage?: string, stateField: keyof CfsState, stateItemKey: string, introMessage?: string, reasonTraceStart?: string, reasonTraceComplete?: string })` |
| IngestDispatcher | Primitive | `core/primitives/conversation/ingest-dispatcher.ts` | Dispatches to a handler function based on `last_question_key`. **Args:** `(state: CfsState, { handlers: Record<string, IngestHandler>, lastQuestionKey: string \| null })` |
| NumericSelectionIngest | Primitive | `core/primitives/conversation/numeric-selection-ingest.ts` | Parses numeric user selection (e.g. "1,3"), validates against items, returns selected names. **Args:** `(state: CfsState, { availableItems: Array<{ name, ... }>, questionKey: string, retryMessage: string, successMessage: string, stateField: keyof CfsState, stateItemKey: string })` |
| VectorSelect | Primitive | `core/primitives/compute/vector-select.ts` | Retrieves candidates via callback, selects best with AI, falls back to deterministic choice. **Args:** `(state: CfsState, { retrieve: (state) → { candidates, snippets }, selectWithAI: ({ state, candidates, snippets }) → T \| null, fallback: (candidates) → T, statePatch: (state, selected, snippets) → Partial<CfsState> })` |
| MultiSectionDocBuilder | Primitive | `core/primitives/compute/multi-section-doc-builder.ts` | Builds multi-section document by invoking LLM per section, with optional QA + repair. **Args:** `(state: CfsState, { model: ChatOpenAI \| null, sectionKeys: string[], buildSectionParams: (key, ctx) → SectionBuildParams, context: Record<string, unknown>, outputBuilder: (sections, fullDraft) → Partial<CfsState>, qaCheck?: (draft, ctx) → { pass, repairs? }, repairSection?: (key, original, instruction, ctx) → string })` |
| DocStyleQa | Primitive | `core/primitives/compute/doc-style-qa.ts` | Style/voice QA pass on a document: checks grammar, tone, role conformance, repairs failing sections. **Args:** `(state: CfsState, { model: ChatOpenAI, fullDraft: string, sectionOutputs: Record<string, string>, sectionKeys: string[], buildStylePrompt: (draft) → { system, user }, buildRepairPrompt: (key, original, instruction) → { system, user } })` |
| runAiCompute | Primitive | `core/primitives/compute/ai-compute.ts` | Generic AI compute: builds prompt, calls model, parses response, writes to state path. **Args:** `(state: CfsState, { modelAlias: string, systemPromptKey: string, inputOverrides: Record<string, unknown>, buildUserPrompt: (params) → string, responseParser: string \| (text) → unknown, outputPath: string, runName?: string }) → { result, statePatch }` |

### A.2 Helpers

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| pushAI | Helper | `core/helpers/messaging.ts` | Creates an AIMessage and appends to messages array. **Args:** `(state: CfsState, text: string, messageType?: MessageType) → Partial<CfsState>` |
| lastHumanMessage | Helper | `core/helpers/messaging.ts` | Returns the most recent HumanMessage from the messages array. **Args:** `(state: CfsState) → HumanMessage \| null` |
| lastAIMessage | Helper | `core/helpers/messaging.ts` | Returns the most recent AIMessage from the messages array. **Args:** `(state: CfsState) → AIMessage \| null` |
| getByPath | Helper | `core/helpers/path.ts` | Reads a value from an object using a dot-separated path. **Args:** `(obj: unknown, path: string) → unknown` |
| setByPath | Helper | `core/helpers/path.ts` | Mutating write: sets a value at a dot-separated path. **Args:** `(obj: Record<string, unknown>, path: string, value: unknown) → void` |
| buildNestedPatch | Helper | `core/helpers/path.ts` | Immutable write: builds a Partial&lt;CfsState&gt; patch for a dot-separated path. **Args:** `(state: CfsState, path: string, value: unknown) → Partial<CfsState>` |
| isLangSmithEnabled | Helper | `core/helpers/tracing.ts` | Returns true when LangSmith tracing is enabled via env vars. **Args:** `() → boolean` |
| mergeStatePatch | Helper | `core/helpers/state.ts` | Shallow-merges one or more partial state patches onto a base state. **Args:** `(base: CfsState, ...patches: Partial<CfsState>[]) → CfsState` |
| patchSessionContext | Helper | `core/helpers/state.ts` | Shallow-merges a partial session_context onto the current one. **Args:** `(state: CfsState, patch: Partial<CfsState["session_context"]>) → Pick<CfsState, "session_context">` |
| createInitialState | Helper | `core/helpers/state.ts` | Creates a fresh CfsState with random session ID and defaults. **Args:** `(params?: { sessionId?: string }) → CfsState` |
| nowMs | Helper | `core/helpers/state.ts` | Returns current timestamp in milliseconds. **Args:** `() → number` |
| clamp01 | Helper | `core/helpers/state.ts` | Clamps a number to [0, 1]. **Args:** `(n: number) → number` |
| interpolate | Helper | `core/helpers/template.ts` | Replaces `{{placeholder}}` tokens with values from a vars map. **Args:** `(template: string, vars: Record<string, string>) → string` |
| configString | Helper | `core/helpers/template.ts` | Looks up a key in the graph's strings config, returns fallback if missing. **Args:** `(key: string, fallback: string) → string` |
| prependClarificationAcknowledgement | Helper | `core/helpers/template.ts` | Config-aware: prepends a random acknowledgement phrase (from config) before a response. **Args:** `(text: string, options?: { random?: () → number }) → string` |
| prependAcknowledgementFromPhrases | Helper | `acknowledgements.ts` | Low-level: prepends a random acknowledgement from an explicit phrase list. **Args:** `(text: string, input: string \| string[] \| undefined, options?: { random?: () → number }) → string` |
| opsExamplesForGoal | Helper | `core/helpers/template.ts` | Returns domain-specific operational area examples. **Args:** `(goal: string \| null, industry: string \| null) → string[]` |
| buildCanonicalReadoutDocument | Helper | `core/helpers/template.ts` | Constructs a structured readout document object. **Args:** `({ documentId: string, metadata: Record, sections: CanonicalReadoutSection[], tables?, citations?, evidenceRefs? }) → CanonicalReadoutDocument` |
| buildDeterministicScores | Helper | `core/helpers/template.ts` | Scores use case names against vector search results. **Args:** `(results: Array<{ content?, metadata?, similarity? }>, names: string[], opts?: { max?, fieldKey? }) → Array<{ name, score }>` |
| buildFallbackFromSchema | Helper | `core/helpers/template.ts` | Builds a complete fallback analysis JSON for readout when AI fails. **Args:** `(state: CfsState, pillars: string[], defaultValue?: string) → Record<string, unknown>` |
| computeFlowProgress | Helper | `flow-progress.ts` | Calculates step-by-step progress for UI using config meta and counting strategies. Uses `getByPath` for dynamic field resolution and `requireGraphMessagingConfig()` for config-driven rules. **Args:** `(state: CfsState) → FlowProgress` |
| selectClarificationAcknowledgement | Helper | `acknowledgements.ts` | Picks a random acknowledgement phrase from the configured list. **Args:** `(input: string \| string[] \| undefined, options?: { random?: () → number }) → string` |
| detectSentiment | Helper | `core/helpers/sentiment.ts` | Keyword-based sentiment detection from user text. **Args:** `(answer: string) → "positive" \| "neutral" \| "concerned"` |
| isAffirmativeAnswer | Helper | `core/helpers/sentiment.ts` | Checks if user text is affirmative (yes, yeah, sure, etc.). **Args:** `(answer: string) → boolean` |
| SpanSanitizer | Helper | `core/helpers/text.ts` | Strips trailing punctuation, returns fallback if empty. **Args:** `(raw: string \| null, fallback: string) → string` |
| TimeframeSanitizer | Helper | `core/helpers/text.ts` | Normalizes timeframe phrases (strips leading prepositions, ensures "in" prefix). **Args:** `(raw: string \| null) → string` |
| sanitizeDiscoveryAnswer | Helper | `core/helpers/text.ts` | Cleans control characters and truncates to 600 chars. **Args:** `(raw: string) → string` |
| truncateTextToWordLimit | Helper | `core/helpers/text.ts` | Truncates text to a word limit. **Args:** `(text: string, maxWords?: number) → string` |
| parseJsonObject | Helper | `core/helpers/parsing.ts` | Safe JSON parse returning object or null on failure. **Args:** `(text: string) → Record<string, unknown> \| null` |
| parsePillarsFromAi | Helper | `core/helpers/parsing.ts` | Parses AI pillar selection JSON into `PillarEntry[]`. **Args:** `(text: string) → PillarEntry[]` |
| parseCompositeQuestions | Helper | `core/helpers/parsing.ts` | Parses numbered/bulleted AI output into question strings. **Args:** `(text: string) → string[]` |
| sanitizeNumericSelectionInput | Helper | `core/helpers/parsing.ts` | Validates and normalizes numeric selection input. **Args:** `(raw: string) → { normalized: string, invalid: boolean }` |
| parseNumericSelectionIndices | Helper | `core/helpers/parsing.ts` | Parses "1,3" into validated index array. **Args:** `(raw: string, maxIndex: number) → number[] \| null` |
| extractStringValuesFromMixedArray | Helper | `core/helpers/parsing.ts` | Extracts string values from mixed arrays of strings and objects. **Args:** `(raw: unknown[]) → string[]` |
| normalizeOptionalString | Helper | `core/helpers/normalization.ts` | Trims and nullifies empty or "default" strings. **Args:** `(value?: string \| null) → string \| null` |
| normalizePillarValues | Helper | `core/helpers/normalization.ts` | Deduplicates and cleans pillar name arrays. **Args:** `(values: string[]) → string[]` |
| buildCaseInsensitiveLookupMap | Helper | `core/helpers/normalization.ts` | Builds case-insensitive lookup map for allowed value validation. **Args:** `(allowed: string[]) → Map<string, string>` |
| normalizeUseCasePillarEntries | Helper | `core/helpers/normalization.ts` | Normalizes mixed pillar input into `PillarEntry[]`. **Args:** `(pillars: Array<string \| { name?, confidence? }>) → PillarEntry[]` |
| normalizeDiscoveryQuestions | Helper | `core/helpers/normalization.ts` | Converts string array to `DiscoveryQuestionItem[]` with null fields. **Args:** `(questions: string[]) → DiscoveryQuestionItem[]` |
| mergeDiscoveryQuestions | Helper | `core/helpers/normalization.ts` | Merges new discovery questions with existing ones, preserving prior responses. **Args:** `(existing: unknown, next: DiscoveryQuestionItem[]) → DiscoveryQuestionItem[]` |

### A.3 Tools and Services

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| sanitizeUserInput | Tool | `core/guards/sanitize.ts` | AI-driven input cleaning by field type. **Args:** `(kind: "name" \| "role" \| "industry" \| "goal" \| "timeframe", text: string) → Promise<string>` |
| reviewResponseWithAI | Tool | `core/guards/review.ts` | AI-driven response rewriting for natural tone and grammar. **Args:** `(text: string, options?: { forbidFirstPerson?: boolean }) → Promise<string>` |
| assessRiskWithAI | Tool | `core/guards/risk.ts` | AI risk assessment against industry/role/goal context. **Args:** `({ question, answer, industry?, role?, goal?, timeframe?, use_cases_prioritized? }) → Promise<RiskAssessmentResult>` |
| assessAnswerRiskFromState | Tool | `core/guards/risk.ts` | Convenience wrapper: extracts context from state and calls assessRiskWithAI. **Args:** `(state: CfsState, question: string, answer: string) → Promise<RiskAssessmentResult>` |
| rephraseQuestionWithAI | Tool | `core/services/ai/rephrase.ts` | Rewrites a question incorporating context in a specified actor role and tone. **Args:** `({ baseQuestion, industry?, role?, useCaseGroups?, allowAIRephrase?, actorRole?, tone? }) → Promise<string \| null>` |
| selectPersonaGroup | Tool | `core/services/ai/selection.ts` | AI-selects best persona group from a list based on role + vector snippets. **Args:** `({ role, snippets, personaGroups }) → Promise<{ persona_group: string \| null, confidence: number }>` |
| selectMarketSegment | Tool | `core/services/ai/selection.ts` | AI-selects best market segment based on industry + vector snippets. **Args:** `({ industry, snippets, segments: Array<{ segment_name, scope_profile? }> }) → Promise<{ segment_name: string \| null, confidence: number }>` |
| selectOutcomeName | Tool | `core/services/ai/selection.ts` | AI-selects best outcome name from a list. **Args:** `({ outcomes, personaGroup?, goal?, marketSegment?, snippets }) → Promise<string \| null>` |
| resolvePersonaGroupFromRole | Tool | `core/services/ai/resolve-persona.ts` | Composite: queries vector store then calls selectPersonaGroup. **Args:** `({ roleText, queryText, vectorDocType, vectorMetadataOverrides?, personaGroups, existingGroup, existingConfidence }) → Promise<{ persona_group, confidence, context_examples, role_name }>` |
| invokeChatModelWithFallback | Tool | `core/services/ai/invoke.ts` | Low-level: invokes ChatOpenAI with system+user messages, returns text or fallback. **Args:** `(model: ChatOpenAI, system: string, user: string, { runName, fallback? }) → Promise<string>` |
| getModel | Tool | `core/config/model-factory.ts` | Returns cached ChatOpenAI instance for a named alias. **Args:** `(alias: string, config?: ModelConfig) → ChatOpenAI` |
| setModelConfig | Tool | `core/config/model-factory.ts` | Registers custom model config for an alias, clears cache. **Args:** `(alias: string, config: ModelConfig) → void` |
| getSanitizerModel | Tool | `core/services/ai/models.ts` | Wrapper for `getModel("sanitizer")` — GPT-3.5-turbo (temp 0) for sanitization/selection/rephrase. **Args:** `() → ChatOpenAI` |
| getRiskAssessmentModel | Tool | `core/services/ai/models.ts` | Wrapper for `getModel("riskAssessment")` — GPT-4o (temp 0.8) for risk assessment and persona selection. **Args:** `() → ChatOpenAI` |
| traceRiskAssessmentRun | Tool | `core/services/ai/models.ts` | Wraps an async function with LangSmith tracing when enabled. **Args:** `<T>(inputs: Record<string, unknown>, fn: () → Promise<T>) → Promise<T>` |
| searchSupabaseVectors | Tool | `core/services/vector.ts` | Queries Supabase pgvector via `match_documents` RPC for similarity search. **Args:** `({ queryText, tenantId, docTypes, metadataFilter, relationshipsFilter, topK }) → Promise<VectorResult[]>` |
| getSupabaseClient | Tool | `core/services/supabase.ts` | Creates and caches a Supabase client using env vars. **Args:** `() → SupabaseClient` |
| searchInternet | Tool | `core/services/internet-search.ts` | Calls Firecrawl API, ranks results by query relevance. **Args:** `(query: string) → Promise<InternetSearchResult[]>` |
| nodeInternetSearch | Tool | `core/services/internet-search.ts` | Node handler: performs internet search, stores results, sends summary. **Args:** `(state: CfsState, options?: { query?: string }) → Promise<Partial<CfsState>>` |
| isIndustryVague | Tool | `core/services/internet-search.ts` | AI assessment: determines if an industry answer needs sub-industry clarification. **Args:** `(industry: string) → Promise<boolean>` |
| extractSubIndustries | Tool | `core/services/internet-search.ts` | AI extraction: derives up to 3 sub-industry labels from search results. **Args:** `(industry: string, results: InternetSearchResult[]) → Promise<string[]>` |
| getSubIndustrySuggestions | Tool | `core/services/internet-search.ts` | Composite: searches internet and extracts sub-industry suggestions. **Args:** `(industry: string) → Promise<{ results, suggestions }>` |
| rankInternetResults | Tool | `core/services/internet-search.ts` | Ranks search results by token overlap with query (title 2x weight). **Args:** `(query: string, results: InternetSearchResult[]) → InternetSearchResult[]` |
| FirecrawlService | Tool | `core/services/firecrawl.ts` | Firecrawl API wrapper class with URL allow-list filtering. **Constructor:** `(apiKey: string)`. **Method:** `safeSearch(query: string, tenantId: string) → Promise<FirecrawlSearchItem[]>` |
| isAllowedUrl | Tool | `core/policy/firecrawl.ts` | URL allow-list check for Firecrawl results. **Args:** `(url: string) → boolean` |
| getPersonaGroups | Tool | `core/services/persona-groups.ts` | Fetches persona group names from Supabase, cached. **Args:** `() → Promise<string[]>` |
| getUseCaseGroups | Tool | `core/services/persona-groups.ts` | Fetches use case group titles from Supabase, cached. **Args:** `() → Promise<string[]>` |
| getPillarsForOutcome | Tool | `core/services/pillars.ts` | Fetches pillar names for an outcome via Supabase RPC. **Args:** `(outcomeName: string) → Promise<string[]>` |
| getAllPillars | Tool | `core/services/pillars.ts` | Fetches all pillar names from Supabase. **Args:** `() → Promise<string[]>` |

### A.4 Signal Agents

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| runSignalOrchestrator | Tool | `core/agents/signal-orchestrator.ts` | Runs all 3 signal agents in parallel with TTL, aggregates via EMA. **Args:** `(userText: string, state: CfsState, config: { enabled: boolean, ttlMs: number }, nodeSignalAgents?: boolean) → Promise<SignalOrchestratorResult \| null>` |
| runEngagementAgent | Tool | `core/agents/engagement-agent.ts` | Heuristic engagement scoring (follow-up, elaboration, back-channel, continuity). **Args:** `(text: string) → Promise<SignalAgentResult>` |
| runSentimentAgent | Tool | `core/agents/sentiment-agent.ts` | Heuristic sentiment scoring (valence, intensifiers, pivots, future orientation). **Args:** `(text: string) → Promise<SignalAgentResult>` |
| runTrustAgent | Tool | `core/agents/trust-agent.ts` | Heuristic trust scoring (pronouns, vulnerability, specificity, consistency). **Args:** `(text: string) → Promise<SignalAgentResult>` |
| extractEngagementFeatures | Tool | `core/agents/extractors.ts` | Regex-based extraction of engagement signals from text. **Args:** `(text: string) → EngagementFeatures` |
| extractSentimentFeatures | Tool | `core/agents/extractors.ts` | Regex-based extraction of sentiment signals from text. **Args:** `(text: string) → SentimentFeatures` |
| extractTrustFeatures | Tool | `core/agents/extractors.ts` | Regex-based extraction of trust signals from text. **Args:** `(text: string) → TrustFeatures` |

### A.5 Routing Engine

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| evaluateRoutingRules | Tool | `core/routing/routing-engine.ts` | Iterates ordered rules, returns first matching goto or default. **Args:** `(rules: RoutingRule[], state: CfsState) → string` |
| evaluateWhen | Tool | `core/routing/condition-predicates.ts` | Evaluates all predicates in a when-clause as a conjunction. **Args:** `(state: CfsState, when: WhenClause) → boolean` |
| evalStatePath | Tool | `core/routing/condition-predicates.ts` | Evaluates a dynamic path expression against any state field. **Args:** `(state: CfsState, path: string, op: string, expected: unknown) → boolean` |

### A.6 CFS Step-Flow Helpers

> Domain-specific prompt builders and parsing utilities for the CFS conversation flow, located in `core/nodes/cfs/step-flow-helpers.ts`. These re-export core helpers for convenience and provide CFS-specific logic.

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| buildDiscoveryQuestionPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Formats a discovery question with a "Question N of M:" header. **Args:** `(question: string, index: number, total: number) → string` |
| buildPillarsSelectionPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds system/user prompt pair for AI pillar selection from `aiPrompts.selectPillars`. **Args:** `({ outcome?, selectedUseCases, allowedPillars }) → { system, user }` |
| buildUseCaseQuestionsPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds system/user prompt pair for AI use case question generation. Falls back to hardcoded prompt when config unavailable. **Args:** `({ problemStatement, goalStatement, vectorContext, questionBank, role?, industry?, timeframe? }) → { system, user }` |
| buildUseCaseSelectionPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds system/user prompt pair for AI use case selection and scoring. **Args:** `({ personaGroup, goalStatement, useCaseText, vectorContext }) → { system, user }` |
| parseUseCaseSelections | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Parses AI use case selection JSON response into `UseCaseSelection[]`. **Args:** `(raw: string) → UseCaseSelection[]` |
| buildUseCaseSelectionMessage | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds the numbered use case presentation message for the user. Uses config strings for header, guidance, and item format. **Args:** `({ goalStatement, selections }) → string` |
| buildKnowYourCustomerEchoFallback | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Constructs the KYC echo fallback message with user context, outcome alignment, and optional vector snippet. Uses config strings with `interpolate`. **Args:** `({ name, role, industry, timeframe, goal, outcome, vectorSnippet? }) → string` |
| buildRoleAssessmentMessage | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds the role assessment confirmation message. **Args:** `(roleName, personaGroup, examples) → string` |
| buildReadinessAssessmentPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds a pillar readiness assessment prompt for "current" or "target" mode. **Args:** `(mode, pillarName, evidence, { persona?, industry?, goal?, timeframe? }) → { system, user }` |
| buildReadoutAnalysisPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds Stage 1 analysis prompt payload for readout planning from state and evidence config. **Args:** `(state, { allowedEvidenceByDocType }) → { user }` |
| buildReadoutSectionPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds per-section generation prompt with analysis JSON and discovery risk context. **Args:** `(sectionKey, analysisJson, state, { allowedEvidenceByDocType, sectionContract }) → { user }` |
| buildReadoutQaPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds structural QA payload for full readout validation with template and formatting rules. **Args:** `(draft, analysisJson, { requiredTemplate, execSummaryDirectives, formattingRules, emojiRules, styleRoleVoiceRules }) → { user }` |
| buildReadoutStyleQaPrompt | Helper | `core/nodes/cfs/step-flow-helpers.ts` | Builds style QA payload for language quality and voice conformance. **Args:** `(fullDraft, { rolePerspective, voiceCharacteristics, behavioralIntent }) → { user }` |

### A.7 Infrastructure and Registry

| Name | Type | Location | Description & Arguments |
|------|------|----------|------------------------|
| setGraphMessagingConfig | Tool | `core/config/messaging.ts` | Stores messaging config for a graph by graphId. Overloaded: `(graphId, config)` (preferred) or legacy `(config)` which defaults to `"cfs"`. **Args:** `(graphIdOrConfig: string \| GraphMessagingConfig, config?: GraphMessagingConfig) → void` |
| requireGraphMessagingConfig | Tool | `core/config/messaging.ts` | Retrieves messaging config for the active or specified graph; throws if not set. **Args:** `(graphId?: string) → GraphMessagingConfig` |
| setActiveGraphId | Tool | `core/config/messaging.ts` | Sets the active graph ID for the current execution context. Used by `runTurn` before graph invocation. **Args:** `(graphId: string) → void` |
| getActiveGraphId | Tool | `core/config/messaging.ts` | Gets the currently active graph ID. **Args:** `() → string \| null` |
| clearGraphMessagingConfig | Tool | `core/config/messaging.ts` | Clears all stored messaging configs and resets the active graph ID. Used in test teardown. **Args:** `() → void` |
| registerHandler | Tool | `schema/handler-registry.ts` | Registers a node handler function by reference key. **Args:** `(ref: string, fn: NodeHandler) → void` |
| resolveHandler | Tool | `schema/handler-registry.ts` | Looks up a registered handler by reference key; throws if not found. **Args:** `(ref: string) → NodeHandler` |
| registerRouter | Tool | `schema/handler-registry.ts` | Registers a router function by reference key. **Args:** `(ref: string, fn: RouterFn) → void` |
| resolveRouter | Tool | `schema/handler-registry.ts` | Looks up a registered router by reference key; throws if not found. **Args:** `(ref: string) → RouterFn` |
| registerConfig | Tool | `schema/handler-registry.ts` | Registers a config init function by reference key. **Args:** `(ref: string, fn: ConfigInitFn) → void` |
| resolveConfig | Tool | `schema/handler-registry.ts` | Looks up a config init function; throws if not found. **Args:** `(ref: string) → ConfigInitFn` |
| registerConfigFn | Tool | `schema/handler-registry.ts` | Registers a runtime config closure (overlayPrefix, exampleGenerator). **Args:** `(ref: string, fn: ConfigFn) → void` |
| resolveConfigFn | Tool | `schema/handler-registry.ts` | Looks up a runtime config closure; throws if not found. **Args:** `(ref: string) → ConfigFn` |
| clearRegistry | Tool | `schema/handler-registry.ts` | Clears all 4 maps (handlers, routers, configs, configFns). Used in test teardown. **Args:** `() → void` |
| getRegisteredHandlerIds | Tool | `schema/handler-registry.ts` | Returns all registered handler reference keys. **Args:** `() → string[]` |
| getRegisteredRouterIds | Tool | `schema/handler-registry.ts` | Returns all registered router reference keys. **Args:** `() → string[]` |
| createGenericHandler | Tool | `schema/generic-handlers.ts` | Inspects nodeConfig and delegates to question/greeting/display/ingest handler factory. **Args:** `(node: NodeDef, config: GraphConfig) → NodeHandler` |
| loadGraphDsl | Tool | `schema/graph-loader.ts` | Parses a YAML file and validates against GraphDslSchema. **Args:** `(filePath: string) → GraphDsl` |
| loadAndCompileGraph | Tool | `schema/graph-loader.ts` | Loads YAML, validates, and compiles into a runnable LangGraph StateGraph. **Args:** `(filePath: string) → CompiledGraph` |
| parseGraphDslFromText | Tool | `schema/graph-loader.ts` | Parses raw YAML text (not a file path) into a validated GraphDsl. Useful for testing. **Args:** `(yamlText: string) → GraphDsl` |
| compileGraphFromDsl | Tool | `schema/graph-compiler.ts` | Validates DSL, builds messaging config, wires nodes and edges, returns compiled graph. **Args:** `(dsl: GraphDsl) → CompiledGraph` |
| buildGraphMessagingConfigFromDsl | Tool | `schema/graph-compiler.ts` | Transforms YAML config block into GraphMessagingConfig object. **Args:** `(dsl: GraphDsl) → GraphMessagingConfig \| null` |
| registerHandlersForGraph | Tool | `schema/graph-handler-modules.ts` | Looks up and calls the handler registration function for a graphId. **Args:** `(graphId: string) → void` |
| registerHandlerModule | Tool | `schema/graph-handler-modules.ts` | Registers a handler module function for a graphId. **Args:** `(graphId: string, fn: HandlerRegistrationFn) → void` |
| buildGraphFromSchema | Tool | `graph.ts` | Top-level: loads YAML, registers handlers, compiles graph. **Args:** `(yamlPath: string) → CompiledGraph` |
| buildCfsGraph | Tool | `graph.ts` | Convenience: calls `buildGraphFromSchema` with the default CFS flow path. **Args:** `() → CompiledGraph` |
| runTurn | Tool | `graph.ts` | Executes one user turn: appends HumanMessage, runs signal agents in parallel, invokes the compiled graph, merges signals, post-processes AI messages. **Args:** `(graphApp: CompiledGraph, state: CfsState, userText?: string) → Promise<CfsState>` |
| resetCfsRegistration | Tool | `schema/cfs-handlers.ts` | Resets the CFS handler registration flag so handlers can be re-registered. Used in tests. **Args:** `() → void` |

---

## References

| Resource | Path |
|----------|------|
| Schema types | `src/langgraph/schema/graph-dsl-types.ts` |
| JSON schema | `src/langgraph/schema/graphDslJsonSchema.json` |
| Compiler | `src/langgraph/schema/graph-compiler.ts` |
| Loader | `src/langgraph/schema/graph-loader.ts` |
| Generic handlers | `src/langgraph/schema/generic-handlers.ts` |
| Handler registry | `src/langgraph/schema/handler-registry.ts` |
| CFS handlers | `src/langgraph/schema/cfs-handlers.ts` |
| Handler modules | `src/langgraph/schema/graph-handler-modules.ts` |
| Routing engine | `src/langgraph/core/routing/routing-engine.ts` |
| Condition predicates | `src/langgraph/core/routing/condition-predicates.ts` |
| State schema | `src/langgraph/state.ts` |
| State slices (barrel) | `src/langgraph/slices/index.ts` |
| Session context slice | `src/langgraph/slices/session-context.ts` |
| User context slice | `src/langgraph/slices/user-context.ts` |
| Use case context slice | `src/langgraph/slices/use-case-context.ts` |
| Readout context slice | `src/langgraph/slices/readout-context.ts` |
| Relationship context slice | `src/langgraph/slices/relationship-context.ts` |
| Vector context slice | `src/langgraph/slices/vector-context.ts` |
| Internet search slice | `src/langgraph/slices/internet-search-context.ts` |
| Context weave slice | `src/langgraph/slices/context-weave-index.ts` |
| Primitive log schema | `src/langgraph/slices/primitive-log.ts` |
| Graph orchestration | `src/langgraph/graph.ts` |
| Infra re-exports | `src/langgraph/infra.ts` |
| Messaging config | `src/langgraph/core/config/messaging.ts` |
| Model factory | `src/langgraph/core/config/model-factory.ts` |
| Path helpers | `src/langgraph/core/helpers/path.ts` |
| Tracing helper | `src/langgraph/core/helpers/tracing.ts` |
| Helpers barrel | `src/langgraph/core/helpers/index.ts` |
| Primitive base | `src/langgraph/core/primitives/base.ts` |
| Flow progress | `src/langgraph/flow-progress.ts` |
| Acknowledgements | `src/langgraph/acknowledgements.ts` |
| Firecrawl policy | `src/langgraph/core/policy/firecrawl.ts` |
| CFS step-flow helpers | `src/langgraph/core/nodes/cfs/step-flow-helpers.ts` |
| CFS flow example | `clients/default/flows/cfs-default/flow.yaml` |
| Flow template | `templates/flow/template_flow.yaml` |
| Authoring guide | `docs/graph-authoring.md` |
