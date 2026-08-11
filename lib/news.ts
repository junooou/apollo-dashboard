/**
 * Company news via the Google News RSS feed (news.google.com/rss/search).
 * No official free Google News API exists; this is the unofficial-but-widely-
 * used public endpoint — no key, no signup, no rate-limit bookkeeping. Trade-off:
 * headline + link + source + date only, no article body or images.
 */

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
};

const RSS_BASE = "https://news.google.com/rss/search";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Minimal, purpose-built RSS field extractor — avoids pulling in an XML
 * parser dependency for what is otherwise a plain-text app (see AGENTS.md). */
function extractTag(block: string, tag: string): string {
  const cdata = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdata) return decodeEntities(cdata[1].trim());
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return plain ? decodeEntities(plain[1].trim()) : "";
}

export async function fetchCompanyNews(
  companyName: string,
  opts: { max?: number; hl?: string; gl?: string; ceid?: string } = {},
): Promise<NewsItem[]> {
  const max = opts.max ?? 6;
  const hl = opts.hl ?? "en-SG";
  const gl = opts.gl ?? "SG";
  const ceid = opts.ceid ?? "SG:en";

  const url = `${RSS_BASE}?q=${encodeURIComponent(companyName)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    throw new Error(`Google News RSS returned ${res.status}`);
  }
  const xml = await res.text();

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, max).map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    source: extractTag(block, "source"),
    publishedAt: extractTag(block, "pubDate"),
  }));
}
