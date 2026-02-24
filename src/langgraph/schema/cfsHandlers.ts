import {
  nodeInit,
  nodeStep1Ingest,
  nodeAskUserName,
  nodeAskIndustry,
  nodeKnowYourCustomerEcho,
} from "../flows/step1KnowYourCustomerNodes.js";
import {
  nodeDetermineUseCases,
  nodeIngestUseCaseSelection,
  nodeDetermineUseCaseQuestions,
} from "../flows/step2NarrowDownUseCasesNodes.js";
import {
  nodeAskUseCaseQuestions,
  nodeDeterminePillars,
} from "../flows/step3PerformDiscoveryNodes.js";
import {
  nodeBuildReadout,
  nodeDisplayReadout,
} from "../flows/step4FinalReadoutNextStepsNodes.js";
import { nodeInternetSearch } from "../internetSearch.js";
import {
  routeInitFlow,
  routeUseCaseQuestionLoop,
  routePillarsLoop,
} from "../flows/routers.js";
import { exampleGenerator, overlayPrefix } from "../flows/stepFlowConfig.js";
import type { CfsState } from "../state.js";
import { registerHandler, registerRouter, registerConfigFn } from "./handlerRegistry.js";

let registered = false;

export function resetCfsRegistration(): void {
  registered = false;
}

export function registerCfsHandlers(): void {
  if (registered) return;
  registered = true;

  // Router passthrough nodes (identity — state passes through unchanged)
  registerHandler("cfs.routeInitFlow", (s: CfsState) => s);
  registerHandler("cfs.routeUseCaseQuestionLoop", (s: CfsState) => s);
  registerHandler("cfs.routePillarsLoop", (s: CfsState) => s);

  // Step 1: Know Your Customer
  registerHandler("step1.nodeInit", nodeInit);
  registerHandler("step1.nodeAskUserName", nodeAskUserName);
  registerHandler("step1.nodeAskIndustry", nodeAskIndustry);
  registerHandler("step1.nodeStep1Ingest", nodeStep1Ingest);
  registerHandler("step1.nodeKnowYourCustomerEcho", nodeKnowYourCustomerEcho);
  registerHandler("step1.nodeInternetSearch", nodeInternetSearch);

  // Step 2: Narrow Down Use Cases
  registerHandler("step2.nodeDetermineUseCases", nodeDetermineUseCases);
  registerHandler("step2.nodeIngestUseCaseSelection", nodeIngestUseCaseSelection);
  registerHandler("step2.nodeDetermineUseCaseQuestions", nodeDetermineUseCaseQuestions);

  // Step 3: Perform Discovery
  registerHandler("step3.nodeAskUseCaseQuestions", nodeAskUseCaseQuestions);
  registerHandler("step3.nodeDeterminePillars", nodeDeterminePillars);

  // Step 4: Build Readout
  registerHandler("step4.nodeBuildReadout", nodeBuildReadout);
  // Step 5: Readout Summary and Next Steps
  registerHandler("step4.nodeDisplayReadout", nodeDisplayReadout);

  // Router functions (conditional edge dispatchers)
  registerRouter("cfs.routeInitFlow", routeInitFlow);
  registerRouter("cfs.routeUseCaseQuestionLoop", routeUseCaseQuestionLoop);
  registerRouter("cfs.routePillarsLoop", routePillarsLoop);

  // Dynamic config functions (logic that cannot live in YAML)
  registerConfigFn("cfs.exampleGenerator", exampleGenerator);
  registerConfigFn("cfs.overlayPrefix", overlayPrefix);
}
