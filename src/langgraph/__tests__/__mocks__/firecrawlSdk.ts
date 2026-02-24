/**
 * Manual mock for firecrawl, mapped via moduleNameMapper in jest.config.ts.
 */
export class Firecrawl {
  constructor(_opts?: Record<string, unknown>) {}
  async search() {
    return { web: [] };
  }
  async scrape() {
    return { markdown: "" };
  }
}
