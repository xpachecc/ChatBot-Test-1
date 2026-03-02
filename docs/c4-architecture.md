# CFS Chatbot — C4 Architecture (C3 Levels)

C4 model documentation for the CFS (Customer-Facing Sales) Chatbot. This document covers the first three levels: **Context**, **Container**, and **Component**.

---

## Level 1: System Context (C4Context)

Shows the CFS Chatbot system and its relationships with users and external systems.

```mermaid
C4Context
    title System Context — CFS Chatbot

    Person(user, "User", "Customer engaging in the discovery conversation")

    System_Boundary(cfs, "CFS Chatbot System") {
        System(chatbot, "CFS Chatbot", "4-step consultative conversation: Know Your Customer, Narrow Down Use Cases, Perform Discovery, and Final Readout")
    }

    System_Ext(openai, "OpenAI API", "GPT-4o, GPT-3.5-turbo, text-embedding-3-small")
    System_Ext(supabase, "Supabase", "PostgreSQL, pgvector for document similarity search")
    System_Ext(firecrawl, "Firecrawl API", "Web search and scraping for industry clarification")

    Rel(user, chatbot, "Uses", "HTTPS")
    Rel(chatbot, openai, "Chat completions, embeddings")
    Rel(chatbot, supabase, "Vector search, persistence")
    Rel(chatbot, firecrawl, "Industry search")
```

---

## Level 2: Container (C4Container)

Shows the main deployable units within the CFS Chatbot system.

```mermaid
C4Container
    title Container Diagram — CFS Chatbot

    Person(user, "User", "Customer")

    System_Boundary(cfs, "CFS Chatbot System") {
        Container(web_ui, "Web UI", "HTML, JavaScript, CSS", "Static template served from templates/chatbot1. Renders chat, options, progress.")
        Container(api, "Express API", "Node.js, Express, TypeScript", "REST: GET /, POST /chat, GET /readout/:sessionId.md. Session store, runTurn orchestration.")
        Container(langgraph, "LangGraph Engine", "LangGraph, GraphDSL YAML", "Compiles flow.yaml, executes state graph, routes to node handlers.")
    }

    ContainerDb(supabase, "Supabase", "PostgreSQL, pgvector", "Documents, embeddings, match_documents RPC")
    System_Ext(openai, "OpenAI API", "LLM, embeddings")
    System_Ext(firecrawl, "Firecrawl API", "Web search")

    Rel(user, web_ui, "Uses", "HTTPS")
    Rel(web_ui, api, "POST /chat, GET /", "JSON, HTTP")
    Rel(api, langgraph, "invoke(state)", "in-process")
    Rel(langgraph, openai, "Chat, embeddings")
    Rel(langgraph, supabase, "Vector search")
    Rel(langgraph, firecrawl, "Search")
```

---

## Level 3: Component (C4Component)

Zooms into the Express API and LangGraph Engine to show internal components.

```mermaid
C4Component
    title Component Diagram — CFS Chatbot Application

    Container_Boundary(api, "Express API") {
        Component(chat_endpoint, "Chat Endpoint", "Express", "POST /chat: session lookup, runTurn, options, flowProgress")
        Component(session_store, "Session Store", "Map<string, CfsState>", "In-memory per-session state")
        Component(flow_progress, "Flow Progress", "computeFlowProgress", "Step completion, progress rules from config")
        Component(resolve_options, "Options Resolver", "getOptionsForQuestionKey", "Config options, dynamicOptions, continuationTriggers")
    }

    Container_Boundary(langgraph, "LangGraph Engine") {
        Component(graph_loader, "Graph Loader", "loadAndCompileGraph", "Parse flow.yaml, validate DSL, compile StateGraph")
        Component(routing_engine, "Routing Engine", "evaluateRoutingRules", "Condition predicates, routingRules from config")
        Component(node_handlers, "Node Handlers", "step1–4 nodes", "KYC, use cases, discovery, readout. Ingest, compute, question, integration.")
        Component(state_schema, "State Schema", "CfsStateSchema, slices", "Zod validation, user_context, use_case_context, readout_context, etc.")
    }

    Container_Boundary(services, "Shared Services") {
        Component(ai_service, "AI Service", "OpenAI, invokeChatModel", "Chat completions, reviewResponseWithAI")
        Component(vector_service, "Vector Service", "Supabase RPC", "match_documents, retrieveReadoutDocuments")
        Component(search_service, "Internet Search", "Firecrawl SDK", "Industry clarification, sub-industry discovery")
    }

    System_Ext(openai, "OpenAI API")
    System_Ext(supabase, "Supabase")
    System_Ext(firecrawl, "Firecrawl API")

    Rel(chat_endpoint, session_store, "get/set")
    Rel(chat_endpoint, graph_loader, "invoke")
    Rel(chat_endpoint, resolve_options, "getOptionsForQuestionKey")
    Rel(chat_endpoint, flow_progress, "computeFlowProgress")
    Rel(graph_loader, routing_engine, "evaluates")
    Rel(graph_loader, node_handlers, "executes")
    Rel(graph_loader, state_schema, "validates")
    Rel(node_handlers, ai_service, "uses")
    Rel(node_handlers, vector_service, "uses")
    Rel(node_handlers, search_service, "uses")
    Rel(ai_service, openai, "calls")
    Rel(vector_service, supabase, "queries")
    Rel(search_service, firecrawl, "calls")
```

---

## Component Summary

| Component        | Technology              | Responsibility                                              |
|------------------|-------------------------|-------------------------------------------------------------|
| Chat Endpoint    | Express                 | POST /chat: session lookup, runTurn, options, flowProgress |
| Session Store    | Map                     | In-memory CfsState per sessionId                           |
| Flow Progress    | computeFlowProgress     | Step completion from progressRules, questionKeyMap         |
| Options Resolver | getOptionsForQuestionKey| options, dynamicOptions, continuationTriggers from config   |
| Graph Loader     | loadAndCompileGraph     | Parse flow.yaml, compile LangGraph StateGraph              |
| Routing Engine   | evaluateRoutingRules    | Condition predicates, routingRules from flow config        |
| Node Handlers    | step1–4 nodes           | KYC, use cases, discovery, readout (ingest/compute/question)|
| State Schema     | CfsStateSchema, slices | Zod validation, extensible state slices                    |
| AI Service       | OpenAI                  | Chat completions, embeddings, response review               |
| Vector Service   | Supabase pgvector       | match_documents, readout document retrieval                |
| Internet Search  | Firecrawl               | Industry clarification, sub-industry discovery                |

---

## Config & Multi-Tenancy

```mermaid
flowchart LR
    subgraph Env["Environment"]
        TENANT_ID
        APP_ID
        APP_CONFIG_PATH
    end

    subgraph Resolution["Config Resolution"]
        AppConfig[app.config.json]
        AppConfig --> FlowPath[clients/tenant/flows/flowId/flow.yaml]
        AppConfig --> Template[templates/chatbot1]
    end

    FlowPath --> GraphLoader[Graph Loader]
    Template --> WebUI[Web UI]
```

---

## Diagram Legend

- **Person**: Human user
- **System**: Software system
- **System_Ext**: External system (outside our control)
- **Container**: Deployable/runnable unit
- **ContainerDb**: Database
- **Component**: Internal building block
- **Rel**: Relationship/dependency
