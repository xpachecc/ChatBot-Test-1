import type { CfsState } from "../../state.js";

/**
 * Read a value from an object using a dot-separated path (e.g. "user_context.industry").
 * Returns undefined if any segment is null/undefined or not an object.
 */
export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Mutating write: set a value at a dot-separated path, creating intermediate objects as needed.
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Immutable write: build a Partial<CfsState> patch that sets a value at a dot-separated path.
 * Preserves the top-level slice structure for LangGraph state reducers.
 */
export function buildNestedPatch(state: CfsState, path: string, value: unknown): Partial<CfsState> {
  const parts = path.split(".");
  if (parts.length === 1) return { [parts[0]]: value } as Partial<CfsState>;
  const [slice, ...rest] = parts;
  const sliceState = (state as Record<string, unknown>)[slice];
  const base = sliceState && typeof sliceState === "object" ? { ...sliceState } : {};
  let current: Record<string, unknown> = base;
  for (let i = 0; i < rest.length - 1; i++) {
    const part = rest[i];
    const next = (current[part] && typeof current[part] === "object" ? { ...(current[part] as object) } : {}) as Record<string, unknown>;
    current[part] = next;
    current = next;
  }
  current[rest[rest.length - 1]] = value;
  return { [slice]: base } as Partial<CfsState>;
}
