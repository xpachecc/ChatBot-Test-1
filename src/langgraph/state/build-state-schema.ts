import * as z from "zod";
import { CfsStateSchema } from "../state.js";
import type { GraphDsl } from "../schema/graph-dsl-types.js";

/**
 * Resolves the state schema for a flow.
 * For stateContractRef "state.CfsStateSchema", returns the canonical CFS schema.
 * Future: support stateSlices to build schema from declared slices.
 */
export function resolveStateSchema(_dsl: GraphDsl): z.ZodTypeAny {
  return CfsStateSchema;
}
