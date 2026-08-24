import { describe, expect, it } from "vitest";
import { parseGoogleNewsRss, selectActiveKeywords } from "./google-news-triggers";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<item>
  <title>DBS Bank rolls out AI customer service across branches - The Straits Times</title>
  <link>https://news.google.com/rss/articles/CBMi_example1</link>
  <guid isPermaLink="false">abc123</guid>
  <pubDate>Wed, 20 Aug 2026 03:00:00 GMT</pubDate>
  <description><![CDATA[<a href="https://news.google.com/rss/articles/CBMi_example1">DBS Bank rolls out AI customer service across branches</a>&nbsp;&nbsp;<font color="#6f6f6f">The Straits Times</font>]]></description>
  <source url="https://www.straitstimes.com">The Straits Times</source>
</item>
<item>
  <title>Untrusted blog speculates about AI trends</title>
  <link>https://news.google.com/rss/articles/CBMi_example2</link>
  <guid isPermaLink="false">def456</guid>
  <pubDate>Wed, 20 Aug 2026 02:00:00 GMT</pubDate>
  <description><![CDATA[<a href="https://random-blog.example.com">Untrusted blog speculates about AI trends</a>]]></description>
  <source url="https://random-blog.example.com">Random Blog</source>
</item>
<item>
  <title>Changi Airport expands self-service kiosks - Channel NewsAsia</title>
  <link>https://news.google.com/rss/articles/CBMi_example3</link>
  <guid isPermaLink="false">ghi789</guid>
  <pubDate>Wed, 20 Aug 2026 01:00:00 GMT</pubDate>
  <description><![CDATA[<a href="https://www.channelnewsasia.com/some-article">Changi Airport expands self-service kiosks</a>]]></description>
  <source url="https://www.channelnewsasia.com">CNA</source>
</item>
<item>
  <title>Bank hits record profit</title>
  <link>https://news.google.com/rss/articles/CBMi_example4</link>
  <guid isPermaLink="false">jkl012</guid>
  <pubDate>Wed, 20 Aug 2026 00:00:00 GMT</pubDate>
  <description><![CDATA[<a href="https://www.straitstimes.com/some-article">Bank hits record profit</a>]]></description>
  <source url="https://www.straitstimes.com">The Straits Times</source>
</item>
</channel>
</rss>`;

describe("parseGoogleNewsRss", () => {
  it("keeps only trusted-domain items", () => {
    const results = parseGoogleNewsRss(SAMPLE_RSS, "self service kiosk");
    const domains = results.map((r) => r.domain);

    expect(domains).toContain("straitstimes.com");
    expect(domains).toContain("channelnewsasia.com");
    expect(domains).not.toContain("random-blog.example.com");
    expect(results).toHaveLength(3);
  });

  it("reads the real publisher domain from <source url>, not the news.google.com link", () => {
    const [dbsArticle] = parseGoogleNewsRss(SAMPLE_RSS, "customer experience AI");
    expect(dbsArticle.domain).toBe("straitstimes.com");
    expect(dbsArticle.url).toContain("news.google.com");
  });

  it("falls back the description to the title when Google's description is just the re-linked headline with no added text", () => {
    const results = parseGoogleNewsRss(SAMPLE_RSS, "bank profit");
    const bankArticle = results.find((r) => r.title === "Bank hits record profit");
    expect(bankArticle?.description).toBe("Bank hits record profit");
  });

  it("drops items with no title, url, or trusted domain", () => {
    const empty = parseGoogleNewsRss("<rss><channel></channel></rss>", "anything");
    expect(empty).toEqual([]);
  });
});

describe("selectActiveKeywords", () => {
  const entries = [
    { text: "airport self-service kiosk", regions: ["Global"] },
    { text: "airport terminal expansion Singapore", regions: ["Singapore", "Asia"] },
    { text: "airport expansion Europe", regions: ["Europe"] },
    { text: "airport expansion North America", regions: ["Americas"] },
  ];

  it("always includes Global-tagged keywords regardless of active regions", () => {
    const result = selectActiveKeywords(entries, []);
    expect(result).toEqual(["airport self-service kiosk"]);
  });

  it("includes a region-tagged keyword only when that region is active", () => {
    const result = selectActiveKeywords(entries, ["Singapore"]);
    expect(result).toContain("airport terminal expansion Singapore");
    expect(result).not.toContain("airport expansion Europe");
    expect(result).not.toContain("airport expansion North America");
  });

  it("adds keywords back when a region is toggled on", () => {
    const withoutEurope = selectActiveKeywords(entries, ["Singapore"]);
    const withEurope = selectActiveKeywords(entries, ["Singapore", "Europe"]);

    expect(withoutEurope).not.toContain("airport expansion Europe");
    expect(withEurope).toContain("airport expansion Europe");
    expect(withEurope.length).toBe(withoutEurope.length + 1);
  });

  it("a keyword tagged with multiple regions matches on any one of them", () => {
    const result = selectActiveKeywords(entries, ["Asia"]);
    expect(result).toContain("airport terminal expansion Singapore");
  });
});
