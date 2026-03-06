# Config Block Graduation Checklist

## Platform Architecture Philosophy (80/20 Model)

The platform follows an intentional two-layer architecture:

- **~80% Generic (YAML config blocks):** Common node behaviors are expressed declaratively via `nodeConfig` blocks in the flow YAML. The platform's generic handler factory reads these configs and produces working handlers automatically. Examples: `question`, `greeting`, `display`, `ingest`, `aiCompute`, `vectorSelect`.

- **~20% Custom (handlerRef):** Flow-specific logic that is too unique, complex, or conditional to generalize lives in custom TypeScript handlers referenced via `handlerRef`. These handlers import only from the platform barrel (`infra.ts`) and are co-located with their flow in `clients/<tenantId>/flows/<flowId>/handlers/`.

This is not a gap to close — it is an architectural boundary by design. The YAML schema expresses *intent* (what the node does), not *implementation* (how it does it). Generic config blocks cover repeatable patterns; `handlerRef` is the permanent, first-class mechanism for everything else.

### Analogies

This follows the same model as:

- **Shopify**: Liquid templates for 80%, custom code for the rest
- **WordPress**: Customizer for 80%, PHP for the rest
- **Retool**: Drag-and-drop for 80%, custom JS for the rest

### Key Principles

1. The YAML expresses topology, configuration, and strings — not control flow or branching logic
2. Generic config blocks are for repeatable, composable patterns with no conditional logic
3. `handlerRef` is the intended way to handle the ~20% of behavior too specific to generalize
4. Custom handlers should carry an `intent` annotation so the YAML remains human-readable
5. When in doubt, write a custom handler — premature generalization is worse than duplication

---

## Config Block Graduation Criteria

Before adding any new `nodeConfig` block to the platform, it must pass **all five** criteria:

### 1. Reuse Threshold

The pattern must appear in **3+ flows** or **5+ nodes** within the existing codebase. If only one flow uses it, it belongs as a custom handler in that flow.

### 2. Complexity Ceiling

The config schema must have **fewer than 8 fields**. If the config requires 8+ fields, the pattern is too complex for declarative configuration and should remain as a custom handler.

### 3. No Conditional Logic

The config block must not require if/then/else branching, loops, or state-dependent behavior that can't be expressed as a flat key-value configuration. Conditional logic belongs in custom handlers.

### 4. Composable from Existing Primitives

The generic handler implementation must compose from **1-3 existing primitives** (e.g., `runAiCompute`, `vectorSelect`, `askWithRephrase`). If it requires new infrastructure, the cost of adding a config block is too high.

### 5. Escape Hatch Preserved

A `handlerRef` must always be able to override the config block for any node. The config block adds convenience but never constrains what a custom handler can do.

---

## Decision Flow

```
Does the pattern appear in 3+ flows or 5+ nodes?
  No  → Write a custom handler (handlerRef)
  Yes ↓
Does the config need fewer than 8 fields?
  No  → Write a custom handler
  Yes ↓
Does it require conditional logic (if/else, loops)?
  Yes → Write a custom handler
  No  ↓
Can it compose from 1-3 existing primitives?
  No  → Write a custom handler
  Yes ↓
Does handlerRef still work as an escape hatch?
  No  → Redesign the approach
  Yes → Graduate to a nodeConfig block ✓
```

If a proposed config block fails any criterion, the answer is: write a custom handler and put it in the flow's `handlers/` directory.
