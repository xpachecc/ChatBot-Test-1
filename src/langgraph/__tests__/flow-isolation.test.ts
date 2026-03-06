import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const CLIENTS_DIR = path.join(PROJECT_ROOT, "clients");


function getHandlerFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getHandlerFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      entry.name !== "index.ts"
    ) {
      results.push(full);
    }
  }
  return results;
}

function extractImports(filePath: string): { source: string; line: number }[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const imports: { source: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/from\s+["']([^"']+)["']/);
    if (match) {
      imports.push({ source: match[1], line: i + 1 });
    }
  }
  return imports;
}

function isBarrelImport(source: string): boolean {
  return /\/infra(?:\.js|\.ts)?$/.test(source) || source === "infra.js" || source === "infra.ts";
}

function isSameFlowImport(source: string, handlerDir: string, filePath: string): boolean {
  if (!source.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(filePath), source.replace(/\.js$/, ".ts"));
  return resolved.startsWith(handlerDir);
}

function isNodeBuiltinOrNpm(source: string): boolean {
  return !source.startsWith(".");
}

describe("Flow handler isolation", () => {
  const flowDirs: string[] = [];

  if (fs.existsSync(CLIENTS_DIR)) {
    for (const tenant of fs.readdirSync(CLIENTS_DIR, { withFileTypes: true })) {
      if (!tenant.isDirectory()) continue;
      const flowsDir = path.join(CLIENTS_DIR, tenant.name, "flows");
      if (!fs.existsSync(flowsDir)) continue;
      for (const flow of fs.readdirSync(flowsDir, { withFileTypes: true })) {
        if (!flow.isDirectory()) continue;
        const handlersDir = path.join(flowsDir, flow.name, "handlers");
        if (fs.existsSync(handlersDir)) {
          flowDirs.push(handlersDir);
        }
      }
    }
  }

  if (flowDirs.length === 0) {
    it("should find at least one flow handlers directory", () => {
      expect(flowDirs.length).toBeGreaterThan(0);
    });
    return;
  }

  it("found flow handler directories to validate", () => {
    expect(flowDirs.length).toBeGreaterThan(0);
  });

  for (const handlersDir of flowDirs) {
    const files = getHandlerFiles(handlersDir);

    for (const file of files) {
      const relFile = path.relative(PROJECT_ROOT, file);

      it(`${relFile} only imports from barrel, same-flow handlers, or external packages`, () => {
        const imports = extractImports(file);
        const violations: string[] = [];

        for (const imp of imports) {
          if (isBarrelImport(imp.source)) continue;
          if (isSameFlowImport(imp.source, handlersDir, file)) continue;
          if (isNodeBuiltinOrNpm(imp.source)) continue;

          violations.push(`Line ${imp.line}: import from "${imp.source}" violates flow isolation`);
        }

        if (violations.length > 0) {
          fail(
            `Flow handler ${relFile} has import boundary violations:\n` +
            violations.join("\n")
          );
        }
      });
    }
  }
});
