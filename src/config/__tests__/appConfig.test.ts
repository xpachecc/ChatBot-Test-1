import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAppConfig,
  resolveAppConfig,
  validateAppConfig,
  getFlowPath,
  getTemplatePath,
  type ResolvedAppConfig,
} from "../appConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

describe("appConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APP_CONFIG_PATH;
    delete process.env.TENANT_ID;
    delete process.env.APP_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getFlowPath", () => {
    it("returns path clients/<tenantId>/flows/<flowId>/flow.yaml", () => {
      expect(getFlowPath("default", "cfs-default")).toMatch(/clients\/default\/flows\/cfs-default\/flow\.yaml$/);
    });
  });

  describe("getTemplatePath", () => {
    it("returns path templates/<templateName>/", () => {
      expect(getTemplatePath("chatbot1")).toMatch(/templates\/chatbot1/);
    });
  });

  describe("loadAppConfig", () => {
    it("returns null when app config file does not exist", () => {
      process.env.APP_CONFIG_PATH = path.join(PROJECT_ROOT, "clients/nonexistent/apps/nonexistent/app.config.json");
      expect(loadAppConfig()).toBeNull();
    });

    it("loads and parses app config when file exists", () => {
      const tmpDir = path.join(PROJECT_ROOT, "tmp-app-config-test");
      mkdirSync(tmpDir, { recursive: true });
      const configPath = path.join(tmpDir, "app.config.json");
      writeFileSync(configPath, JSON.stringify({ flowId: "cfs-default", template: "chatbot1" }));

      try {
        process.env.APP_CONFIG_PATH = configPath;
        const config = loadAppConfig();
        expect(config).not.toBeNull();
        expect(config!.flowId).toBe("cfs-default");
        expect(config!.template).toBe("chatbot1");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("defaults template to chatbot1 when missing", () => {
      const tmpDir = path.join(PROJECT_ROOT, "tmp-app-config-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, "app.config.json"), JSON.stringify({ flowId: "cfs-default" }));

      try {
        process.env.APP_CONFIG_PATH = path.join(tmpDir, "app.config.json");
        const config = loadAppConfig();
        expect(config!.template).toBe("chatbot1");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("validateAppConfig", () => {
    it("throws when flow file does not exist", () => {
      const config: ResolvedAppConfig = {
        flowId: "nonexistent",
        flowPath: path.join(PROJECT_ROOT, "clients/default/flows/nonexistent-flow/flow.yaml"),
        template: "chatbot1",
        tenantId: "default",
        appId: "cfs-chatbot",
        uiOverrides: {},
      };
      expect(() => validateAppConfig(config)).toThrow(/Flow not found/);
    });

    it("throws when template directory does not exist", () => {
      const config: ResolvedAppConfig = {
        flowId: "cfs-default",
        flowPath: path.join(PROJECT_ROOT, "clients/default/flows/cfs-default/flow.yaml"),
        template: "nonexistent-template",
        tenantId: "default",
        appId: "cfs-chatbot",
        uiOverrides: {},
      };
      expect(() => validateAppConfig(config)).toThrow(/Template not found/);
    });

    it("does not throw when flow and template exist", () => {
      const config: ResolvedAppConfig = {
        flowId: "cfs-default",
        flowPath: path.join(PROJECT_ROOT, "clients/default/flows/cfs-default/flow.yaml"),
        template: "chatbot1",
        tenantId: "default",
        appId: "cfs-chatbot",
        uiOverrides: {},
      };
      expect(() => validateAppConfig(config)).not.toThrow();
    });
  });

  describe("resolveAppConfig", () => {
    it("returns legacy config when app config file does not exist", () => {
      process.env.APP_CONFIG_PATH = path.join(PROJECT_ROOT, "clients/nonexistent/apps/nonexistent/app.config.json");
      const resolved = resolveAppConfig();
      expect(resolved.flowId).toBeNull();
      expect(resolved.flowPath).toMatch(/graphs\/cfs\.flow\.yaml/);
      expect(resolved.template).toBe("chatbot1");
    });

    it("returns resolved config when app config exists", () => {
      const appConfigPath = path.join(PROJECT_ROOT, "clients/default/apps/cfs-chatbot/app.config.json");
      if (!existsSync(appConfigPath)) {
        return; // skip if app config not created yet
      }
      const resolved = resolveAppConfig();
      expect(resolved.flowId).toBe("cfs-default");
      expect(resolved.flowPath).toMatch(/cfs-default\/flow\.yaml/);
      expect(resolved.template).toBe("chatbot1");
    });
  });
});
