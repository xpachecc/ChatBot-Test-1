import {
  nodeInit,
  nodeStep1Ingest,
  nodeAskUserName,
  nodeAskIndustry,
  nodeKnowYourCustomerEcho,
} from "../core/nodes/step1-know-your-customer-nodes.js";
import {
  nodeDetermineUseCases,
  nodeIngestUseCaseSelection,
  nodeDetermineUseCaseQuestions,
} from "../core/nodes/step2-narrow-down-use-cases-nodes.js";
import {
  nodeAskUseCaseQuestions,
  nodeDeterminePillars,
} from "../core/nodes/step3-perform-discovery-nodes.js";
import {
  nodeBuildReadout,
  nodeDisplayReadout,
} from "../core/nodes/step4-final-readout-next-steps-nodes.js";
import { nodeInternetSearch } from "../core/services/internet-search.js";
import type { CfsState } from "../state.js";
import { registerHandler } from "./handler-registry.js";

let registered = false;

export function resetCfsRegistration(): void {
  registered = false;
}

export function registerCfsHandlers(): void {
  if (registered) return;
  registered = true;

  // Router passthrough nodes (identity — state passes through unchanged; routing from YAML)
  registerHandler("cfs.routeInitFlow", (s: CfsState) => s);
  registerHandler("cfs.routeUseCaseQuestionLoop", (s: CfsState) => s);
  registerHandler("cfs.routePillarsLoop", (s: CfsState) => s);
  registerHandler("cfs.routeAfterIngestUseCaseSelection", (s: CfsState) => s);

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

  // Routers are resolved from YAML routingRules in graph-compiler; no TS registration needed
}
