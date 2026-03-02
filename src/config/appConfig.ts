import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppConfig {
  flowId?: string;
  graph?: string;
  template: string;
  uiOverrides?: Record<string, unknown>;
}

export interface ResolvedAppConfig {
  flowId: string | null;
  flowPath: string;
  template: string;
  tenantId: string;
  appId: string;
  uiOverrides: Record<string, unknown>;
}

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function getTenantId(): string {
  const id = process.env.TENANT_ID;
  if (!id) throw new Error("TENANT_ID env var is required");
  return id;
}

function getAppId(): string {
  const id = process.env.APP_ID;
  if (!id) throw new Error("APP_ID env var is required");
  return id;
}

/**
 * Resolve the path to app.config.json.
 * Priority: APP_CONFIG_PATH env > clients/<tenantId>/apps/<appId>/app.config.json
 */
function getAppConfigPath(): string {
  const explicitPath = process.env.APP_CONFIG_PATH;
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(PROJECT_ROOT, explicitPath);
    return resolved;
  }
  const tenantId = getTenantId();
  const appId = getAppId();
  return path.join(PROJECT_ROOT, "clients", tenantId, "apps", appId, "app.config.json");
}

/**
 * Load and parse app.config.json.
 * Returns null if file does not exist (legacy mode).
 */
export function loadAppConfig(): AppConfig | null {
  const configPath = getAppConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AppConfig;
  if (!parsed.template) {
    parsed.template = "chatbot1";
  }
  return parsed;
}

/**
 * Resolve flow path from flowId.
 * Path: clients/<tenantId>/flows/<flowId>/flow.yaml
 */
export function getFlowPath(tenantId: string, flowId: string): string {
  return path.join(PROJECT_ROOT, "clients", tenantId, "flows", flowId, "flow.yaml");
}

/**
 * Resolve template directory path.
 * Path: templates/<templateName>/
 */
export function getTemplatePath(templateName: string): string {
  return path.join(PROJECT_ROOT, "templates", templateName);
}

/**
 * Validate that flow file and template directory exist.
 * Throws with clear error message if validation fails.
 */
export function validateAppConfig(config: ResolvedAppConfig): void {
  if (!existsSync(config.flowPath)) {
    throw new Error(
      `Flow not found: ${config.flowPath}. ` +
        "Ensure the flow file exists under clients/<tenantId>/flows/<flowId>/."
    );
  }
  const templatePath = getTemplatePath(config.template);
  if (!existsSync(templatePath)) {
    throw new Error(
      `Template not found: ${templatePath}. ` +
        `Template "${config.template}" does not exist under templates/.`
    );
  }
}

/**
 * Resolve the default flow path when no app config or flowId is specified.
 * Path: clients/<tenantId>/flows/cfs-default/flow.yaml
 */
export function getDefaultFlowPath(): string {
  return getFlowPath(getTenantId(), "cfs-default");
}

/**
 * Load app config and resolve all paths.
 * Returns resolved config for server startup.
 * If no app config exists, returns config for clients/<tenantId>/flows/cfs-default/flow.yaml.
 */
export function resolveAppConfig(): ResolvedAppConfig {
  const tenantId = getTenantId();
  const appId = getAppId();

  const config = loadAppConfig();

  if (!config) {
    const defaultFlowPath = getFlowPath(tenantId, "cfs-default");
    const defaultConfig: ResolvedAppConfig = {
      flowId: null,
      flowPath: defaultFlowPath,
      template: "chatbot1",
      tenantId,
      appId,
      uiOverrides: {},
    };
    validateAppConfig(defaultConfig);
    return defaultConfig;
  }

  let flowPath: string;
  let flowId: string | null = config.flowId ?? null;

  if (config.graph) {
    // Path-based override (legacy compatibility)
    flowPath = path.isAbsolute(config.graph)
      ? config.graph
      : path.join(PROJECT_ROOT, config.graph);
    flowId = null;
  } else if (config.flowId) {
    flowPath = getFlowPath(tenantId, config.flowId);
  } else {
    flowPath = getFlowPath(tenantId, "cfs-default");
  }

  const resolved: ResolvedAppConfig = {
    flowId,
    flowPath,
    template: config.template,
    tenantId,
    appId,
    uiOverrides: config.uiOverrides ?? {},
  };

  validateAppConfig(resolved);
  return resolved;
}
