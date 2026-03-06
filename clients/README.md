# Client Flows

This directory contains per-tenant, per-flow conversation implementations. Each flow is a self-contained unit with a YAML graph definition and optional custom handler code.

## Directory Structure

```
clients/<tenantId>/flows/<flowId>/
  flow.yaml              ← Graph definition (YAML DSL)
  handlers/
    index.ts             ← Handler registration (imports + registerHandler calls)
    step1-*.ts           ← Custom handler implementations for this flow
    step2-*.ts
    ...
```

## Import Boundary Rules

Flow handlers may import from:

1. **The platform API barrel** (`src/langgraph/infra.ts`) — all reusable primitives, helpers, services, and types are surfaced through this single entry point
2. **Other files within the same flow's `handlers/` directory** — for flow-specific helper functions shared across step files
3. **Node.js built-ins and approved npm packages** — `zod`, `node:crypto`, etc.

Flow handlers must **NOT** import from:

1. **Platform internal paths** (e.g., `src/langgraph/core/services/...`, `src/langgraph/core/helpers/...`) — use the barrel instead
2. **Another flow's `handlers/` directory** — each flow is isolated

This boundary is enforced by `src/langgraph/__tests__/flow-isolation.test.ts`.

## Handler Registration Convention

Each flow has a `handlers/index.ts` that registers its custom handlers via `registerHandler()` from the platform's handler registry:

```typescript
import { registerHandler } from "path/to/handler-registry.js";
import { nodeMyCustomStep } from "./step1-my-custom-step.js";

export function registerMyFlowHandlers(): void {
  registerHandler("myFlow.myCustomStep", nodeMyCustomStep);
}
```

Registration functions are wired into the platform via `src/langgraph/schema/graph-handler-modules.ts`, which maps `graphId` strings to registration functions.

Router passthrough handlers (identity functions for YAML-driven routing) are also registered in `handlers/index.ts`:

```typescript
registerHandler("myFlow.routeMain", (s: CfsState) => s);
```

## `handlerRef` Philosophy

`handlerRef` is the permanent, first-class mechanism for flow-specific node logic. It is **not** a workaround or legacy pattern — it is the intended way to handle the ~20% of behavior that is too specific to generalize into a YAML config block.

The platform follows an **80/20 model**:

- **~80%** of node behavior is handled by generic YAML config blocks (`question`, `greeting`, `display`, `ingest`, `aiCompute`, `vectorSelect`)
- **~20%** remains as flow-specific custom handlers accessed via `handlerRef`

When deciding between adding a YAML config block vs. writing a custom handler, refer to `docs/config-block-graduation-checklist.md`.

Custom handlers should:

- Import only from the platform barrel (`infra.ts`)
- Be co-located with their flow in `handlers/`
- Include an `intent` annotation in the YAML node definition explaining what the handler achieves from the user's perspective
