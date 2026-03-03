# Flow YAML Template

Standard specification for developing new LangGraph conversation flows. Reverse-engineered from `clients/default/flows/cfs-default/flow.yaml`.

## Quick Start

1. Copy `templates/flow/flow.yaml` to `clients/<tenantId>/flows/<flowId>/flow.yaml`
2. Replace `myFlow` with your graph ID everywhere (e.g. `cfs`, `seQualify`)
3. Define nodes, transitions, and routing rules
4. Create handler registration module `src/langgraph/schema/<graphId>Handlers.ts` and register all handlers/routers
5. Wire the flow: set `flowId` in `clients/<tenantId>/apps/<appId>/app.config.json`, and register your handler module in `graph-handler-modules.ts` for your `graphId`
6. Run `npm test` to verify compilation

**Note:** The template will not compile until handlers are registered and all `handlerRef`/`routerRef` values resolve in the handler registry.

## Template Structure

| Section | Required | Description |
|---------|----------|-------------|
| `graph` | yes | graphId, version, entrypoint, tags |
| `stateContractRef` | yes | Zod state schema reference |
| `nodes` | yes | Node catalog (router, question, ingest, compute, integration, terminal) |
| `transitions` | yes | static + conditional edges |
| `routingKeys` | no | State paths for routing (documentation) |
| `runtimeConfigRefs` | no | Model aliases, policy refs |
| `config` | no | Per-graph strings, prompts, steps, routing rules |
| `validation` | no | requiredStateFields, invariants |

## Node Kinds

- **router** — Passthrough; edges driven by router function
- **question** — Asks user; sets `awaiting_user: true`
- **ingest** — Processes user answer; updates state
- **compute** — AI-driven logic (selection, generation)
- **integration** — External service (Firecrawl, vector search)
- **terminal** — End-of-flow

## Optional Sections (add when needed)

| Section | When to use |
|---------|-------------|
| `readout` (sectionKeys, sectionContract) | Flow produces a readout document |
| `helperRefs` (on nodes) | Node needs additional helper functions |
| `initConfigRef` | Fallback when no inline `config` is present |
| `exampleGeneratorRef` | Dynamic role/industry/goal examples |
| `overlayPrefixRef` | Dynamic overlay prefix text |
| `deliveryPolicyRef` | Output delivery config from registry |

## References

- [Graph Authoring Guide](../../docs/graph-authoring.md)
- [GraphDSL Schema](../../src/langgraph/schema/graph-dsl-types.ts)
- [CFS Flow Example](../../clients/default/flows/cfs-default/flow.yaml)
