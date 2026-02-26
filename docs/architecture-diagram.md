# CFS Chatbot — Architecture Diagram

## 1. System Overview

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        UI[HTML/JS/CSS Template]
        UI --> |POST /chat| API
    end

    subgraph Server["Express Server"]
        API[/chat endpoint]
        API --> SessionStore[(Session Store)]
        API --> runTurn[runTurn]
        API --> Options[getOptionsForQuestionKey]
        API --> Progress[computeFlowProgress]
    end

    subgraph Graph["LangGraph Layer"]
        runTurn --> GraphInvoke[graph.invoke]
        GraphInvoke --> StateGraph[StateGraph]
        StateGraph --> Router[routeInitFlow]
        StateGraph --> Nodes[Node Handlers]
    end

    subgraph Config["Config Layer"]
        AppConfig[app.config.json]
        FlowYAML[flow.yaml]
        AppConfig --> |flowId| FlowPath[Flow Path Resolution]
        FlowPath --> FlowYAML
    end

    subgraph Data["Data & Services"]
        Supabase[(Supabase / pgvector)]
        OpenAI[OpenAI API]
        Firecrawl[Firecrawl API]
    end

    Nodes --> Supabase
    Nodes --> OpenAI
    Nodes --> Firecrawl
    GraphInvoke --> FlowYAML
```

## 2. Chat Request Flow

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Server
    participant SessionStore
    participant runTurn
    participant Graph
    participant Options

    User->>UI: Click option / type message
    UI->>Server: POST /chat { message, sessionId }
    Server->>SessionStore: get(sessionKey) or createInitialState
    Server->>runTurn: runTurn(graphApp, state, userInput)

    runTurn->>runTurn: Append HumanMessage to state
    runTurn->>Graph: invoke(nextState)
    Graph->>Graph: routeInitFlow → evaluate routing rules
    Graph->>Graph: Execute node(s) → static/conditional transitions
    Graph-->>runTurn: result state

    runTurn->>runTurn: CfsStateSchema.parse(result)
    runTurn->>runTurn: reviewResponseWithAI (if policy allows)
    runTurn-->>Server: nextState

    Server->>SessionStore: set(sessionKey, nextState)
    Server->>Options: getOptionsForQuestionKey(last_question_key, nextState)
    Options-->>Server: ChatOptions | null
    Server->>Server: computeFlowProgress(nextState)
    Server-->>UI: { response, flowProgress, options }
    UI-->>User: Display message + options
```

## 3. LangGraph Flow Topology

```mermaid
flowchart TB
    subgraph Entry["Entry"]
        routeInitFlow[routeInitFlow]
    end

    subgraph Step1["Step 1: Know Your Customer"]
        sendIntro[sendIntroAndAskUseCaseGroup]
        askName[askUserName]
        askIndustry[askIndustry]
        internetSearch[internetSearch]
        ingestGroup[ingestUseCaseGroupSelection]
        ingestConfirm[ingestConfirmStart]
        ingestName[ingestUserName]
        ingestIndustry[ingestIndustry]
        ingestRole[ingestRole]
        ingestConfirmRole[ingestConfirmRole]
        ingestTimeframe[ingestTimeframe]
        ingestKyc[ingestKycConfirm]
        knowYourCustomerEcho[knowYourCustomerEcho]
    end

    subgraph Step2["Step 2: Narrow Down Use Cases"]
        nodeDetermineUseCases[nodeDetermineUseCases]
        ingestUseCaseSelection[ingestUseCaseSelection]
        nodeDetermineQuestions[nodeDetermineUseCaseQuestions]
    end

    subgraph Step3["Step 3: Perform Discovery"]
        nodeAskQuestions[nodeAskUseCaseQuestions]
        nodeDeterminePillars[nodeDeterminePillars]
    end

    subgraph Step4["Step 4: Build Readout"]
        routePillarsLoop[routePillarsLoop]
        nodeBuildReadout[nodeBuildReadout]
        nodeDisplayReadout[nodeDisplayReadout]
    end

    routeInitFlow -->|routing rules| sendIntro
    routeInitFlow -->|routing rules| askName
    routeInitFlow -->|routing rules| ingestGroup
    routeInitFlow -->|routing rules| nodeAskQuestions
    routeInitFlow -->|routing rules| nodeDeterminePillars
    routeInitFlow -->|routing rules| nodeBuildReadout
    routeInitFlow -->|default| END1(__end__)

    ingestTimeframe --> knowYourCustomerEcho
    ingestKyc --> nodeDetermineUseCases
    ingestUseCaseSelection --> nodeDetermineQuestions
    nodeDetermineQuestions --> nodeAskQuestions
    nodeDeterminePillars --> routePillarsLoop
    routePillarsLoop -->|readout not ready| nodeBuildReadout
    routePillarsLoop -->|default| END2(__end__)
    nodeBuildReadout --> nodeDisplayReadout
    nodeDisplayReadout --> END3(__end__)
```

## 4. Config Resolution & Multi-Tenancy

```mermaid
flowchart LR
    subgraph Env["Environment"]
        TENANT_ID[TENANT_ID]
        APP_ID[APP_ID]
        APP_CONFIG_PATH[APP_CONFIG_PATH]
    end

    subgraph Resolution["Config Resolution"]
        AppConfigPath[app.config.json path]
        AppConfigPath --> LoadConfig[Load app.config]
        LoadConfig --> HasConfig{Config exists?}
        HasConfig -->|No| Legacy[Legacy: graphs/cfs.flow.yaml]
        HasConfig -->|Yes| FlowPath[Flow path: clients/tenant/flows/flowId/flow.yaml]
        FlowPath --> Template[Template: templates/chatbot1]
    end

    subgraph Output["Resolved Config"]
        flowPath[flowPath]
        templatePath[templatePath]
        tenantId[tenantId]
        appId[appId]
    end

    TENANT_ID --> AppConfigPath
    APP_ID --> AppConfigPath
    APP_CONFIG_PATH --> AppConfigPath
    Legacy --> flowPath
    FlowPath --> flowPath
    Template --> templatePath
```

## 5. State & Option Resolution

```mermaid
flowchart TB
    subgraph State["CfsState Slices"]
        messages[messages]
        session_context[session_context]
        user_context[user_context]
        use_case_context[use_case_context]
        vector_context[vector_context]
        readout_context[readout_context]
    end

    subgraph Options["getOptionsForQuestionKey"]
        questionKey[questionKey: string | null]
        questionKey --> NullKey{questionKey null?}
        NullKey -->|Yes| Continuation[continuationTriggers]
        NullKey -->|No| Suggested[suggested_options from state]
        Suggested --> ConfigOpt[config.options]
        ConfigOpt --> DynamicOpt[dynamicOptions: service | state]
        Continuation --> MatchTrigger{matchesContinuationTrigger?}
        MatchTrigger -->|Yes| Items[items: string[]]
    end

    session_context --> questionKey
    session_context --> MatchTrigger
```

## 6. Graph Compilation Pipeline

```mermaid
flowchart TB
    subgraph Input["Input"]
        YAML[flow.yaml]
    end

    subgraph Load["Load & Parse"]
        loadGraph[loadGraphDsl]
        parseYAML[parse YAML]
        validateDSL[GraphDslSchema.parse]
    end

    subgraph Compile["Compile"]
        preflight[preflight: validate refs]
        buildConfig[buildGraphMessagingConfigFromDsl]
        addNodes[addNode for each handler]
        setEntry[setEntryPoint]
        addConditional[addConditionalEdges: routing rules]
        addStatic[addStatic edges]
        compile[graph.compile]
    end

    subgraph Output["Output"]
        CompiledGraph[Compiled LangGraph]
    end

    YAML --> loadGraph
    loadGraph --> parseYAML
    parseYAML --> validateDSL
    validateDSL --> preflight
    preflight --> buildConfig
    buildConfig --> addNodes
    addNodes --> setEntry
    setEntry --> addConditional
    addConditional --> addStatic
    addStatic --> compile
    compile --> CompiledGraph
```

## 7. Node Kinds & Handler Types

```mermaid
flowchart LR
    subgraph NodeKinds["Node Kinds"]
        router[router]
        question[question]
        ingest[ingest]
        compute[compute]
        integration[integration]
    end

    subgraph Handlers["Handler Types"]
        router --> Passthrough[Identity: return state]
        question --> AskQuestion[ask-with-rephrase, push AI message]
        ingest --> IngestDispatcher[ingest-dispatcher, apply user answer]
        compute --> AiCompute[AI compute, vector retrieval]
        integration --> Firecrawl[Firecrawl search]
    end
```
