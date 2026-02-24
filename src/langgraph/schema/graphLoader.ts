import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { GraphDslSchema } from "./graphDslTypes.js";
import type { GraphDsl } from "./graphDslTypes.js";
import { compileGraphFromDsl } from "./graphCompiler.js";
import type { CompileResult } from "./graphCompiler.js";

/**
 * Parses and validates a YAML file against the GraphDSL v1 Zod schema.
 * Returns the validated DSL object without compiling.
 */
export function loadGraphDsl(filePath: string): GraphDsl {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  return GraphDslSchema.parse(parsed);
}

/**
 * Loads a YAML graph definition, validates it, and compiles it into a
 * runnable LangGraph StateGraph instance.
 */
export function loadAndCompileGraph(filePath: string): CompileResult {
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
