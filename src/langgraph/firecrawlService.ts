import { Firecrawl } from "firecrawl";
import { isAllowedUrl, MAX_PAGES } from "./firecrawlPolicy.js";

export type FirecrawlSearchItem = {
  title?: string | null;
  description?: string | null;
  url?: string | null;
};

type FirecrawlSearchResponse = {
  items?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
};

export class FirecrawlService {
  private client: Firecrawl;

  constructor(apiKey: string) {
    this.client = new Firecrawl({ apiKey });
  }

  async safeSearch(query: string, _tenantId: string): Promise<FirecrawlSearchItem[]> {
    const results = (await this.client.search(query, {
      limit: MAX_PAGES,
    })) as FirecrawlSearchResponse;

    const items = results.items ?? results.web ?? [];
    return items.filter((item) => (item.url ? isAllowedUrl(item.url) : false));
  }

}
