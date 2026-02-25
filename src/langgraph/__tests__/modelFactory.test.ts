import { jest } from "@jest/globals";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("modelFactory", () => {
  it("getModel returns a ChatOpenAI instance for a known alias", async () => {
    const { getModel, clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    const model = getModel("knowYourCustomer");
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe("function");
  });

  it("getModel caches instances by alias", async () => {
    const { getModel, clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    const m1 = getModel("knowYourCustomer");
    const m2 = getModel("knowYourCustomer");
    expect(m1).toBe(m2);
  });

  it("getModel throws for unknown alias without explicit config", async () => {
    const { getModel, clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    expect(() => getModel("nonexistent")).toThrow("No model configuration found");
  });

  it("getModel accepts explicit config and does not cache it", async () => {
    const { getModel, clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    const m1 = getModel("custom", { model: "gpt-4", temperature: 0.1, maxRetries: 2 });
    const m2 = getModel("custom", { model: "gpt-4", temperature: 0.1, maxRetries: 2 });
    expect(m1).not.toBe(m2);
  });

  it("setModelConfig overrides defaults and clears cache", async () => {
    const { getModel, setModelConfig, clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    const before = getModel("knowYourCustomer");
    setModelConfig("knowYourCustomer", { model: "gpt-4o-mini", temperature: 0.2, maxRetries: 3 });
    const after = getModel("knowYourCustomer");
    expect(before).not.toBe(after);
    clearModelCache();
  });

  it("getModel throws when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { getModel, clearModelCache } = await import("../core/config/model-factory.js");
    clearModelCache();
    expect(() => getModel("knowYourCustomer")).toThrow("OPENAI_API_KEY");
  });
});
