type CurrentsArticle = {
    id: string;
    title: string;
    description: string;
    url: string;
    author: string | null;
    image: string | null;
    language: string;
    category: string[];
    published: string;
  };
  
  type CurrentsResponse = {
    status: string;
    news?: CurrentsArticle[];
    page?: number;
    msg?: string;
    message?: string;
  };
  
  export type NewsTriggerArticle = CurrentsArticle & {
    domain: string;
  };
  
  const TRUSTED_DOMAINS = [
    // Global business / general news
    "reuters.com",
    "bloomberg.com",
    "cnbc.com",
    "forbes.com",
    "fortune.com",
  
    // Singapore / Asia
    "channelnewsasia.com",
    "straitstimes.com",
    "businesstimes.com.sg",
    "nikkei.com",
    "scmp.com",
    "bernama.com",
  
    // Technology / enterprise
    "techcrunch.com",
    "cio.com",
    "computerweekly.com",
  
    // Hospitality / travel / aviation
    "skift.com",
    "hospitalitynet.org",
    "hoteldive.com",
    "businesstraveller.com",
    "travelweekly-asia.com",
  
    // Retail
    "retaildive.com",
    "retailnews.asia",
  
    // Healthcare
    "healthcareitnews.com",
  ];
  
  const SEARCH_QUERIES = [
    "hotel expansion",
    "hotel opening",
    "hotel renovation",
  
    "airport expansion",
    "airport terminal",
    "passenger experience",
  
    "mall opening",
    "mall redevelopment",
    "retail expansion",
  
    "bank branch transformation",
    "bank customer experience",
    "digital banking customer service",
  
    "hospital expansion",
    "hospital digital transformation",
    "patient experience",
  
    "customer experience AI",
    "customer service automation",
    "conversational AI customer service",
  
    "self service kiosk",
    "AI kiosk",
    "digital signage",
  
    "guest experience technology",
    "visitor experience technology",
    "multilingual customer service",
  ];
  
  function getDomain(url: string) {
    try {
      return new URL(url)
        .hostname
        .replace(/^www\./, "")
        .toLowerCase();
    } catch {
      return "";
    }
  }
  
  function isTrustedDomain(domain: string) {
    return TRUSTED_DOMAINS.some(
      (trusted) =>
        domain === trusted ||
        domain.endsWith(`.${trusted}`),
    );
  }
  
  async function searchCurrents(
    keywords: string,
  ): Promise<NewsTriggerArticle[]> {
    const apiKey =
      process.env.CURRENTS_API_KEY?.trim();
  
    if (!apiKey) {
      throw new Error(
        "CURRENTS_API_KEY is not configured.",
      );
    }
  
    const params = new URLSearchParams({
      keywords,
      language: "en",
      page_number: "1",
      page_size: "20",
    });
  
    const response = await fetch(
      `https://api.currentsapi.services/v1/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
      },
    );
  
    const rawText = await response.text();
  
    let data: CurrentsResponse;
  
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Currents returned invalid JSON (${response.status}).`,
      );
    }
  
    if (!response.ok || data.status !== "ok") {
      console.error(
        "CURRENTS ERROR",
        keywords,
        response.status,
        rawText,
      );
  
      throw new Error(
        data.msg ||
          data.message ||
          `Currents request failed (${response.status})`,
      );
    }
  
    return (data.news ?? [])
      .filter(
        (article) =>
          article.language === "en",
      )
      .map((article) => ({
        ...article,
        domain: getDomain(article.url),
      }))
      .filter((article) =>
        isTrustedDomain(article.domain),
      );
  }
  
  export async function fetchNewsTriggerCandidates() {
    const merged: NewsTriggerArticle[] = [];
    const seen = new Set<string>();
  
    /*
     * Small batches so we don't smash Currents with 20+ requests
     * at exactly the same moment.
     */
    const batchSize = 4;
  
    for (
      let i = 0;
      i < SEARCH_QUERIES.length;
      i += batchSize
    ) {
      const batch =
        SEARCH_QUERIES.slice(
          i,
          i + batchSize,
        );
  
      const results = await Promise.all(
        batch.map(async (query) => {
            try {
            return await searchCurrents(query);
            } catch (error) {
            console.error(
                `Currents search failed for "${query}":`,
                error,
            );

            return [];
            }
        }),
    );
  
      for (const group of results) {
        for (const article of group) {
          const key =
            article.url || article.id;
  
          if (seen.has(key)) {
            continue;
          }
  
          seen.add(key);
          merged.push(article);
        }
      }
    }
  
    merged.sort((a, b) => {
      return (
        new Date(b.published).getTime() -
        new Date(a.published).getTime()
      );
    });
  
    return merged;
  }
  
  export const trustedNewsDomains =
    TRUSTED_DOMAINS;