import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^firecrawl$": "<rootDir>/src/langgraph/__tests__/__mocks__/firecrawlSdk",
  },
  maxWorkers: 1,
  setupFiles: ["<rootDir>/jest.setup.ts"],
  resetModules: true,
  clearMocks: true,
  globals: {
    "ts-jest": {
      useESM: true,
      tsconfig: {
        module: "NodeNext",
        isolatedModules: true,
      },
      diagnostics: {
        ignoreCodes: [151002],
      },
    },
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};

export default config;
