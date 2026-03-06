import {
  nodeStep1Ingest,
  nodeKnowYourCustomerEcho,
} from "./step1-know-your-customer-nodes.js";
import {
  nodeDetermineUseCases,
  nodeIngestUseCaseSelection,
  nodeDetermineUseCaseQuestions,
} from "./step2-narrow-down-use-cases-nodes.js";
import {
  nodeAskUseCaseQuestions,
  nodeDeterminePillars,
} from "./step3-perform-discovery-nodes.js";
import {
  nodeBuildReadout,
} from "./step4-final-readout-next-steps-nodes.js";
import { nodeInternetSearch } from "../../../../../src/langgraph/core/services/internet-search.js";
import type { CfsState } from "../../../../../src/langgraph/state.js";
import { registerHandler } from "../../../../../src/langgraph/schema/handler-registry.js";

let registered = false;

export function resetCfsRegistration(): void {
  registered = false;
}

export function registerCfsHandlers(): void {
  if (registered) return;
  registered = true;

  registerHandler("cfs.routeInitFlow", (s: CfsState) => s);
  registerHandler("cfs.routeUseCaseQuestionLoop", (s: CfsState) => s);
  registerHandler("cfs.routePillarsLoop", (s: CfsState) => s);
  registerHandler("cfs.routeAfterIngestUseCaseSelection", (s: CfsState) => s);

  registerHandler("step1.nodeStep1Ingest", nodeStep1Ingest);
  registerHandler("step1.nodeKnowYourCustomerEcho", nodeKnowYourCustomerEcho);
  registerHandler("step1.nodeInternetSearch", nodeInternetSearch);

  registerHandler("step2.nodeDetermineUseCases", nodeDetermineUseCases);
  registerHandler("step2.nodeIngestUseCaseSelection", nodeIngestUseCaseSelection);
  registerHandler("step2.nodeDetermineUseCaseQuestions", nodeDetermineUseCaseQuestions);

  registerHandler("step3.nodeAskUseCaseQuestions", nodeAskUseCaseQuestions);
  registerHandler("step3.nodeDeterminePillars", nodeDeterminePillars);

  registerHandler("step4.nodeBuildReadout", nodeBuildReadout);
}
