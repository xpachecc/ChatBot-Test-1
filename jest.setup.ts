import { jest } from "@jest/globals";

declare global {
  // eslint-disable-next-line no-var
  var __chatOpenAIMockContent: string | undefined;
}

// Required by appConfig and graph modules
process.env.TENANT_ID = process.env.TENANT_ID ?? "default";
process.env.APP_ID = process.env.APP_ID ?? "cfs-chatbot";

jest.unstable_mockModule("@langchain/openai", () => ({
  ChatOpenAI: class {
    async invoke() {
      return { content: globalThis.__chatOpenAIMockContent ?? "" };
    }
  },
  OpenAIEmbeddings: class {
    constructor() {}
    async embedQuery() {
      return [];
    }
  },
}));


