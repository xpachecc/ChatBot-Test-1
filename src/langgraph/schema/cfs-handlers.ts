import {
  nodeStep1Ingest,
  nodeKnowYourCustomerEcho,
} from "../core/nodes/cfs/step1-know-your-customer-nodes.js";
import {
  nodeDetermineUseCases,
  nodeIngestUseCaseSelection,
  nodeDetermineUseCaseQuestions,
} from "../core/nodes/cfs/step2-narrow-down-use-cases-nodes.js";
import {
  nodeAskUseCaseQuestions,
  nodeDeterminePillars,
} from "../core/nodes/cfs/step3-perform-discovery-nodes.js";
import {
  nodeBuildReadout,
} from "../core/nodes/cfs/step4-final-readout-next-steps-nodes.js";
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

  // Router passthrough nodes (identity — routing from YAML routingRules)
  registerHandler("cfs.routeInitFlow", (s: CfsState) => s);
  registerHandler("cfs.routeUseCaseQuestionLoop", (s: CfsState) => s);
  registerHandler("cfs.routePillarsLoop", (s: CfsState) => s);
  registerHandler("cfs.routeAfterIngestUseCaseSelection", (s: CfsState) => s);

  // Step 1: Custom handlers only (generic nodes use YAML nodeConfig)
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

  // Step 4: Build Readout (nodeDisplayReadout uses YAML nodeConfig)
  registerHandler("step4.nodeBuildReadout", nodeBuildReadout);
}
