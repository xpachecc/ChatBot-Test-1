import type { CfsState } from "../../state.js";
import { evaluateWhen } from "./condition-predicates.js";

export type RoutingRule = {
  when?: Record<string, unknown>;
  goto?: string;
  default?: string;
};

export function evaluateRoutingRules(
  rules: RoutingRule[],
  state: CfsState
): string {
  for (const rule of rules) {
    if (rule.when && Object.keys(rule.when).length > 0) {
      if (evaluateWhen(state, rule.when) && rule.goto) return rule.goto;
    } else if (rule.default !== undefined) {
      return rule.default;
    }
  }
  return "end";
}
