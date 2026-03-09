import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { GraphDslSchema } from "./graph-dsl-types.js";
import type { GraphDsl } from "./graph-dsl-types.js";
import { compileGraphFromDsl } from "./graph-compiler.js";
import type { CompiledGraph } from "./graph-compiler.js";

const MAX_FILE_REF_DEPTH = 5;

function isFileRef(obj: unknown): obj is { $file: string } {
  return (
    obj != null &&
    typeof obj === "object" &&
    Object.keys(obj as object).length === 1 &&
    "$file" in (obj as object) &&
    typeof (obj as { $file: unknown }).$file === "string"
  );
}

function resolveFileRef(ref: string, basePath: string, depth: number): unknown {
  if (depth > MAX_FILE_REF_DEPTH) {
    throw new Error(`$file reference depth exceeded ${MAX_FILE_REF_DEPTH} (possible circular reference)`);
  }

  const [filePath, fragment] = ref.split("#").map((s) => s.trim());
  const resolvedPath = resolve(basePath, filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`$file reference targets non-existent file: ${resolvedPath} (from ${ref})`);
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;

  if (fragment) {
    if (!(fragment in parsed)) {
      throw new Error(`$file fragment "#${fragment}" not found in ${resolvedPath}`);
    }
    return parsed[fragment];
  }

  return parsed;
}

function resolveFileRefs(
  obj: unknown,
  basePath: string,
  visited: Set<string> = new Set(),
  depth = 0,
): unknown {
  if (depth > MAX_FILE_REF_DEPTH) return obj;

  if (isFileRef(obj)) {
    const ref = obj.$file;
    const [filePath] = ref.split("#").map((s) => s.trim());
    const resolvedPath = resolve(basePath, filePath);

    if (visited.has(resolvedPath)) {
      throw new Error(`Circular $file reference detected: ${Array.from(visited).join(" -> ")} -> ${resolvedPath}`);
    }
    visited.add(resolvedPath);
    try {
      const resolved = resolveFileRef(ref, basePath, depth);
      return resolveFileRefs(resolved, dirname(resolvedPath), visited, depth + 1);
    } finally {
      visited.delete(resolvedPath);
    }
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveFileRefs(item, basePath, visited, depth));
  }

  if (obj != null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveFileRefs(value, basePath, visited, depth);
    }
    return result;
  }

  return obj;
}

/**
 * Parses and validates a YAML file against the GraphDSL v1 Zod schema.
 * Resolves $file references (with optional #fragment) before validation.
 * Returns the validated DSL object without compiling.
 */
export function loadGraphDsl(filePath: string): GraphDsl {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  const resolved = resolveFileRefs(parsed, dirname(filePath));
  return GraphDslSchema.parse(resolved);
}

/**
 * Loads a YAML graph definition, validates it, and compiles it into a
 * runnable LangGraph StateGraph instance.
 */
export function loadAndCompileGraph(filePath: string): CompiledGraph {
  const dsl = loadGraphDsl(filePath);
  return compileGraphFromDsl(dsl);
}

/**
 * Parses raw YAML text (not a file path) into a validated GraphDsl.
 * Useful for testing without filesystem access.
 */
export function parseGraphDslFromText(yamlText: string): GraphDsl {
  const parsed = parseYaml(yamlText);
  return GraphDslSchema.parse(parsed);
}
