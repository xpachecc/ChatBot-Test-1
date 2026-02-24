# Major Steps and Sub-Steps Mapping

This document maps the 5 major progress steps to their corresponding graph nodes and `session_context.step` values.

---

## Current Mapping

### Step 1: Know Your Customer
**Progress label:** "Know Your Customer"  
**session_context.step:** `STEP1_KNOW_YOUR_CUSTOMER`

| Sub-step (Node) | Handler | Description |
|-----------------|---------|-------------|
| sendIntroAndAskUseCaseGroup | step1.nodeInit | Send intro, ask for use case group |
| askUserName | step1.nodeAskUserName | Ask user for name |
| askIndustry | step1.nodeAskIndustry | Ask for industry |
| internetSearch | step1.nodeInternetSearch | Firecrawl industry context |
| ingestUseCaseGroupSelection | step1.nodeStep1Ingest | Ingest use case group choice |
| ingestConfirmStart | step1.nodeStep1Ingest | Ingest "ready to start" |
| ingestUserName | step1.nodeStep1Ingest | Ingest name |
| ingestIndustry | step1.nodeStep1Ingest | Ingest industry |
| ingestRole | step1.nodeStep1Ingest | Ingest role |
| ingestConfirmRole | step1.nodeStep1Ingest | Ingest role confirmation |
| ingestTimeframe | step1.nodeStep1Ingest | Ingest timeframe |
| ingestKycConfirm | step1.nodeStep1Ingest | Ingest KYC confirmation |
| knowYourCustomerEcho | step1.nodeKnowYourCustomerEcho | Echo KYC summary for confirmation |

---

### Step 2: Narrow Down Use Cases
**Progress label:** "Narrow Down Use Cases"  
**session_context.step:** `STEP2_NARROW_DOWN_USE_CASES`

| Sub-step (Node) | Handler | Description |
|-----------------|---------|-------------|
| nodeDetermineUseCases | step2.nodeDetermineUseCases | AI use case determination, sets step to STEP2 |
| ingestUseCaseSelection | step2.nodeIngestUseCaseSelection | Ingest user's use case selection |
| nodeDetermineUseCaseQuestions | step2.nodeDetermineUseCaseQuestions | Generate discovery questions, sets step to STEP2 |

---

### Step 3: Perform Discovery
**Progress label:** "Perform Discovery"  
**session_context.step:** `STEP3_PERFORM_DISCOVERY`

| Sub-step (Node) | Handler | Description |
|-----------------|---------|-------------|
| nodeAskUseCaseQuestions | step3.nodeAskUseCaseQuestions | Ask discovery questions in loop, keeps step as STEP3 |
| routeUseCaseQuestionLoop | cfs.routeUseCaseQuestionLoop | Router: all answered → nodeDeterminePillars; else end |

---

### Step 4: Build Readout
**Progress label:** "Build Readout"  
**session_context.step:** `STEP4_BUILD_READOUT`

| Sub-step (Node) | Handler | Description |
|-----------------|---------|-------------|
| nodeDeterminePillars | step3.nodeDeterminePillars | AI pillar selection; sets step to STEP4 |
| routePillarsLoop | cfs.routePillarsLoop | Router: readout ready → nodeDisplayReadout; else nodeBuildReadout |
| nodeBuildReadout | step4.nodeBuildReadout | Build readout document only (no display); sets step to STEP5 |

---

### Step 5: Readout Summary and Next Steps
**Progress label:** "Readout Summary and Next Steps"  
**session_context.step:** `STEP5_READOUT_SUMMARY_NEXT_STEPS`

| Sub-step (Node) | Handler | Description |
|-----------------|---------|-------------|
| nodeDisplayReadout | step4.nodeDisplayReadout | Display readout document and download option |

---

## Flow Chain (Execution Order)

```
Step 1: sendIntroAndAskUseCaseGroup → ... → ingestKycConfirm → nodeDetermineUseCases
Step 2: nodeDetermineUseCases → ingestUseCaseSelection → nodeDetermineUseCaseQuestions → nodeAskUseCaseQuestions
Step 3: nodeAskUseCaseQuestions ⇄ routeUseCaseQuestionLoop (loop until all answered) → nodeDeterminePillars
Step 4: nodeDeterminePillars → routePillarsLoop → nodeBuildReadout (build only, no display)
Step 5: nodeBuildReadout → nodeDisplayReadout (display readout + download option) → end
```
