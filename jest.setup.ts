import { jest } from "@jest/globals";

declare global {
  // eslint-disable-next-line no-var
  var __chatOpenAIMockContent: string | undefined;
}

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


