import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadGraphDsl } from "../schema/graph-loader.js";
import { parse as parseYaml } from "yaml";

const TEST_DIR = join(tmpdir(), `fileRef-test-${Date.now()}`);

function setupTestDir(): string {
  mkdirSync(TEST_DIR, { recursive: true });
  return TEST_DIR;
}

function teardownTestDir(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe("resolveFileRefs ($file with #fragment)", () => {
  afterEach(teardownTestDir);

  it("resolves $file without fragment to full file contents", () => {
    const dir = setupTestDir();
    const contentPath = join(dir, "content.yaml");
    writeFileSync(contentPath, "selectPersona: bar\nselectMarket: qux\n");

    const flowPath = join(dir, "flow.yaml");
    writeFileSync(
      flowPath,
      `
schemaVersion: 2
graph: { graphId: test, version: "1.0", entrypoint: a }
stateContractRef: "state.CfsStateSchema"
nodes:
  - id: a
    kind: compute
    handlerRef: "test.a"
    intent: "test"
transitions: { static: [], conditional: [] }
config:
  meta: { flowTitle: "", flowDescription: "", steps: [] }
  aiPrompts: { $file: "./content.yaml" }
`,
    );

    const dsl = loadGraphDsl(flowPath);
    expect(dsl.config?.aiPrompts).toEqual({ selectPersona: "bar", selectMarket: "qux" });
  });

  it("resolves $file with #fragment to specific top-level key", () => {
    const dir = setupTestDir();
    const contentPath = join(dir, "flow-content.yaml");
    writeFileSync(
      contentPath,
      `
aiPrompts:
  selectPersona: "Select the best persona."
  selectMarket: "Select the best market."
strings:
  greet: "Hello!"
  farewell: "Goodbye!"
`,
    );

    const flowPath = join(dir, "flow.yaml");
    writeFileSync(
      flowPath,
      `
schemaVersion: 2
graph: { graphId: test, version: "1.0", entrypoint: a }
stateContractRef: "state.CfsStateSchema"
nodes:
  - id: a
    kind: compute
    handlerRef: "test.a"
    intent: "test"
transitions: { static: [], conditional: [] }
config:
  meta: { flowTitle: "", flowDescription: "", steps: [] }
  aiPrompts: { $file: "./flow-content.yaml#aiPrompts" }
  strings: { $file: "./flow-content.yaml#strings" }
`,
    );

    const dsl = loadGraphDsl(flowPath);
    expect(dsl.config?.aiPrompts).toEqual({
      selectPersona: "Select the best persona.",
      selectMarket: "Select the best market.",
    });
    expect(dsl.config?.strings).toEqual({ greet: "Hello!", farewell: "Goodbye!" });
  });

  it("throws when $file targets non-existent file", () => {
    const dir = setupTestDir();
    const flowPath = join(dir, "flow.yaml");
    writeFileSync(
      flowPath,
      `
schemaVersion: 2
graph: { graphId: test, version: "1.0", entrypoint: a }
stateContractRef: "state.CfsStateSchema"
nodes:
  - id: a
    kind: compute
    handlerRef: "test.a"
    intent: "test"
transitions: { static: [], conditional: [] }
config:
  meta: { flowTitle: "", flowDescription: "", steps: [] }
  aiPrompts: { $file: "./missing.yaml#aiPrompts" }
`,
    );

    expect(() => loadGraphDsl(flowPath)).toThrow(/non-existent file/);
  });

  it("throws when #fragment does not exist in target file", () => {
    const dir = setupTestDir();
    const contentPath = join(dir, "content.yaml");
    writeFileSync(contentPath, "foo: bar\n");

    const flowPath = join(dir, "flow.yaml");
    writeFileSync(
      flowPath,
      `
schemaVersion: 2
graph: { graphId: test, version: "1.0", entrypoint: a }
stateContractRef: "state.CfsStateSchema"
nodes:
  - id: a
    kind: compute
    handlerRef: "test.a"
    intent: "test"
transitions: { static: [], conditional: [] }
config:
  meta: { flowTitle: "", flowDescription: "", steps: [] }
  aiPrompts: { $file: "./content.yaml#nonexistent" }
`,
    );

    expect(() => loadGraphDsl(flowPath)).toThrow(/fragment.*nonexistent.*not found/);
  });

  it("throws on circular $file reference", () => {
    const dir = setupTestDir();
    writeFileSync(join(dir, "a.yaml"), 'aiPrompts: { $file: "./b.yaml#aiPrompts" }\n');

    writeFileSync(
      join(dir, "b.yaml"),
      'aiPrompts:\n  x: "from b"\n  nested: { $file: "./a.yaml" }\n',
    );

    const flowPath = join(dir, "flow.yaml");
    writeFileSync(
      flowPath,
      `
schemaVersion: 2
graph: { graphId: test, version: "1.0", entrypoint: a }
stateContractRef: "state.CfsStateSchema"
nodes:
  - id: a
    kind: compute
    handlerRef: "test.a"
    intent: "test"
transitions: { static: [], conditional: [] }
config:
  meta: { flowTitle: "", flowDescription: "", steps: [] }
  aiPrompts: { $file: "./a.yaml#aiPrompts" }
`,
    );

    expect(() => loadGraphDsl(flowPath)).toThrow(/Circular \$file reference/);
  });
});
