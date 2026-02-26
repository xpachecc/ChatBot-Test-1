import type { CfsState } from "../../state.js";
import { lastHumanMessage } from "../helpers/messaging.js";

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export type WhenClause = Record<string, unknown>;

const BUILTIN_PREDICATES: Record<
  string,
  (state: CfsState, value: unknown) => boolean
> = {
  awaiting_user: (s, v) => (s.session_context?.awaiting_user ?? false) === v,
  started: (s, v) => (s.session_context?.started ?? false) === v,
  last_question_key: (s, v) => (s.session_context?.last_question_key ?? null) === v,
  primitive_counter: (s, v) => (s.session_context?.primitive_counter ?? 0) === v,
  messages_empty: (s, v) => {
    const empty = (s.messages?.length ?? 0) === 0;
    return v === true ? empty : !empty;
  },
  trace_includes: (s, v) => {
    const trace = Array.isArray(s.session_context?.reason_trace) ? s.session_context.reason_trace : [];
    return typeof v === "string" && trace.includes(v);
  },
  trace_not_includes: (s, v) => {
    const trace = Array.isArray(s.session_context?.reason_trace) ? s.session_context.reason_trace : [];
    return typeof v === "string" && !trace.includes(v);
  },
  step_equals: (s, v) => (s.session_context?.step ?? null) === v,
  last_answer_equals: (s, v) => {
    const content = (lastHumanMessage(s)?.content?.toString() ?? "").trim().toLowerCase();
    return typeof v === "string" && content === v.toLowerCase();
  },
};

function evalStatePath(state: CfsState, path: string, op: string, expected: unknown): boolean {
  const val = getByPath(state, path);
  switch (op) {
    case "empty":
      return val == null || val === "" || (Array.isArray(val) && val.length === 0);
    case "not_empty":
      if (val == null) return false;
      if (typeof val === "string") return val.length > 0;
      if (Array.isArray(val)) return val.length > 0;
      return true;
    case "equals":
      return val === expected;
    case "not_equals":
      return val !== expected;
    case "length_gt": {
      const arr = Array.isArray(val) ? val : typeof val === "string" ? val : null;
      const n = typeof expected === "number" ? expected : Number(expected);
      return arr != null && arr.length > n;
    }
    default:
      return false;
  }
}

export function evaluateWhen(state: CfsState, when: WhenClause): boolean {
  for (const [key, value] of Object.entries(when)) {
    const builtin = BUILTIN_PREDICATES[key];
    if (builtin) {
      if (!builtin(state, value)) return false;
      continue;
    }
    if (key === "state_path_empty" && typeof value === "string") {
      if (!evalStatePath(state, value, "empty", undefined)) return false;
      continue;
    }
    if (key === "state_path_not_empty" && typeof value === "string") {
      if (!evalStatePath(state, value, "not_empty", undefined)) return false;
      continue;
    }
    if (key === "state_path_equals" && value && typeof value === "object" && "path" in value && "value" in value) {
      const { path, value: v } = value as { path: string; value: unknown };
      if (!evalStatePath(state, path, "equals", v)) return false;
      continue;
    }
    if (key === "state_path_not_equals" && value && typeof value === "object" && "path" in value && "value" in value) {
      const { path, value: v } = value as { path: string; value: unknown };
      if (!evalStatePath(state, path, "not_equals", v)) return false;
      continue;
    }
    if (key === "state_path_length_gt" && value && typeof value === "object" && "path" in value && "value" in value) {
      const { path, value: v } = value as { path: string; value: number };
      if (!evalStatePath(state, path, "length_gt", v)) return false;
      continue;
    }
  }
  return true;
}
