/**
 * Company/topic news via Google News RSS (news.google.com/rss/search) — the
 * same free, unofficial, no-key endpoint lib/news.ts already uses for the
 * per-company "Company Overview" feed, but run here across a list of
 * ICP-relevant keywords (data/news-trigger-keywords.json) instead of a
 * single company name.
 *
 * This is an additional SOURCE for the existing News Triggers pipeline, not
 * a separate feature: results are shaped into the same NewsTriggerArticle
 * type lib/currents.ts produces, filtered through the same trusted-domain
 * allowlist, and merged into the same OpenAI relevance scoring
 * (lib/news-scoring.ts) in app/api/news-triggers/route.ts. The scoring step
 * doesn't know or care which source an article came from.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { NewsTriggerArticle } from "./currents";
import { trustedNewsDomains } from "./currents";
import { loadActiveNewsTriggerRegions } from "./news-trigger-filters";

const RSS_BASE = "https://news.google.com/rss/search";

const KEYWORDS_FILE = path.join(process.cwd(), "data", "news-trigger-keywords.json");

/** Each keyword is tagged with the region(s) it's relevant to — "Global"
 *  keywords (horizontal AI/CX terms with no geographic bias) always run;
 *  region-specific keywords (see lib/news-trigger-filters.ts) only run when
 *  that region is active. This is what lets the region filter add/remove
 *  keywords instead of just re-biasing the same fixed query set. */
export type NewsTriggerKeywordEntry = {
  text: string;
  regions: string[];
};

/**
 * Starter list, editable directly in data/news-trigger-keywords.json — that
 * file is gitignored, same as data/settings.json, so changes stay local and
 * take effect on the next refresh with no code change or redeploy. This
 * constant is only the fallback for a fresh install where that file doesn't
 * exist yet.
 */
const DEFAULT_KEYWORD_ENTRIES: NewsTriggerKeywordEntry[] = [
  { text: "airport terminal expansion Singapore", regions: ["Singapore", "Asia"] },
  { text: "airport passenger experience", regions: ["Global"] },
  { text: "airport self-service kiosk", regions: ["Global"] },

  { text: "mall redevelopment Singapore", regions: ["Singapore", "Asia"] },
  { text: "shopping mall customer experience", regions: ["Global"] },
  { text: "retail kiosk digital experience", regions: ["Global"] },

  { text: "hotel guest experience technology", regions: ["Global"] },
  { text: "hotel digital concierge", regions: ["Global"] },
  { text: "hospitality customer service automation", regions: ["Global"] },

  { text: "bank branch digital transformation Singapore", regions: ["Singapore", "Asia"] },
  { text: "consumer banking customer experience", regions: ["Global"] },
  { text: "digital banking customer service", regions: ["Global"] },

  { text: "property management tenant experience technology", regions: ["Global"] },
  { text: "facility management visitor kiosk", regions: ["Global"] },

  { text: "hospital patient experience technology", regions: ["Global"] },
  { text: "healthcare digital transformation Singapore", regions: ["Singapore", "Asia"] },

  { text: "government digital service kiosk Singapore", regions: ["Singapore", "Asia"] },
  { text: "public service video kiosk", regions: ["Global"] },

  { text: "museum visitor experience technology", regions: ["Global"] },
  { text: "transit hub passenger kiosk", regions: ["Global"] },
  { text: "event venue guest experience technology", regions: ["Global"] },

  { text: "AI concierge customer service", regions: ["Global"] },
  { text: "video concierge kiosk", regions: ["Global"] },
  { text: "conversational AI customer experience", regions: ["Global"] },
  { text: "multilingual AI customer service", regions: ["Global"] },
  { text: "agentic AI customer experience", regions: ["Global"] },
  { text: "customer experience transformation Singapore", regions: ["Singapore", "Asia"] },

  { text: "airport expansion Asia Pacific", regions: ["Asia"] },
  { text: "bank digital transformation Asia", regions: ["Asia"] },
  { text: "mall redevelopment Asia", regions: ["Asia"] },
  { text: "hospital digital transformation Asia", regions: ["Asia"] },

  { text: "airport expansion Europe", regions: ["Europe"] },
  { text: "bank branch digital transformation Europe", regions: ["Europe"] },
  { text: "mall redevelopment Europe", regions: ["Europe"] },
  { text: "hospital digital transformation Europe", regions: ["Europe"] },

  { text: "airport expansion North America", regions: ["Americas"] },
  { text: "bank branch digital transformation United States", regions: ["Americas"] },
  { text: "mall redevelopment United States", regions: ["Americas"] },
  { text: "hospital digital transformation United States", regions: ["Americas"] },
];

function isKeywordEntry(value: unknown): value is NewsTriggerKeywordEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.text === "string" &&
    Array.isArray(entry.regions) &&
    entry.regions.every((r) => typeof r === "string")
  );
}

async function loadKeywordEntries(): Promise<NewsTriggerKeywordEntry[]> {
  try {
    const raw = await fs.readFile(KEYWORDS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isKeywordEntry) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    /* file missing or invalid — fall through to defaults */
  }
  return DEFAULT_KEYWORD_ENTRIES;
}

/**
 * Pure — no fs, no network — so region on/off behavior can be unit tested
 * without touching data/news-trigger-keywords.json or data/settings-style
 * filter files.
 */
export function selectActiveKeywords(
  entries: NewsTriggerKeywordEntry[],
  activeRegions: string[],
): string[] {
  const active = new Set(activeRegions);

  return entries
    .filter((entry) => entry.regions.includes("Global") || entry.regions.some((r) => active.has(r)))
    .map((entry) => entry.text.trim())
    .filter((text) => text.length > 0);
}

export async function loadNewsTriggerKeywords(): Promise<string[]> {
  const [entries, activeRegions] = await Promise.all([
    loadKeywordEntries(),
    loadActiveNewsTriggerRegions(),
  ]);

  return selectActiveKeywords(entries, activeRegions);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const cdata = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdata) return decodeEntities(cdata[1].trim());
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return plain ? decodeEntities(plain[1].trim()) : "";
}

/** Google News RSS puts the real publisher domain in <source url="...">,
 *  not <link> (which is a news.google.com redirect) — this is what makes
 *  the trusted-domain filter possible at all. */
function extractSourceUrl(block: string): string {
  const match = block.match(/<source[^>]*\surl="([^"]+)"/);
  return match ? decodeEntities(match[1]) : "";
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isTrustedDomain(domain: string): boolean {
  return trustedNewsDomains.some((trusted) => domain === trusted || domain.endsWith(`.${trusted}`));
}

/**
 * Pure parsing — no network call — so this can be exercised offline in
 * tests against a captured RSS payload, same convention as the rest of the
 * app's 122-test, zero-API-call suite.
 */
export function parseGoogleNewsRss(xml: string, keyword: string): NewsTriggerArticle[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items
    .map((block) => {
      const link = extractTag(block, "link");
      const sourceUrl = extractSourceUrl(block);
      const domain = getDomain(sourceUrl || link);
      const title = extractTag(block, "title");
      const guid = extractTag(block, "guid");
      const rawDescription = extractTag(block, "description");
      const description = stripHtml(rawDescription);

      const article: NewsTriggerArticle = {
        id: guid || link || `${keyword}:${title}`,
        title,
        // Google News RSS descriptions are usually just the title re-linked,
        // not a distinct summary — fall back to the title so OpenAI scoring
        // (lib/news-scoring.ts) still has something to read.
        description: description && description !== title ? description : title,
        url: link,
        author: null,
        image: null,
        language: "en",
        category: [],
        published: extractTag(block, "pubDate"),
        domain,
      };

      return article;
    })
    .filter((article) => article.title && article.url && isTrustedDomain(article.domain));
}

async function searchGoogleNews(keyword: string): Promise<NewsTriggerArticle[]> {
  const url = `${RSS_BASE}?q=${encodeURIComponent(keyword)}&hl=en-SG&gl=SG&ceid=SG:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    throw new Error(`Google News RSS returned ${res.status} for "${keyword}"`);
  }
  const xml = await res.text();
  return parseGoogleNewsRss(xml, keyword);
}

/**
 * Mirrors fetchNewsTriggerCandidates' shape (lib/currents.ts) so
 * app/api/news-triggers/route.ts can merge the two sources before scoring —
 * same small-batch-of-4 concurrency as the Currents fetcher, to stay polite
 * to Google's public endpoint, which has no key and no published quota to
 * throttle against.
 */
export async function fetchGoogleNewsTriggerCandidates(): Promise<NewsTriggerArticle[]> {
  const keywords = await loadNewsTriggerKeywords();
  const merged: NewsTriggerArticle[] = [];
  const seen = new Set<string>();
  const batchSize = 4;

  for (let i = 0; i < keywords.length; i += batchSize) {
    const batch = keywords.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (keyword) => {
        try {
          return await searchGoogleNews(keyword);
        } catch (error) {
          console.error(`Google News RSS search failed for "${keyword}":`, error);
          return [];
        }
      }),
    );

    for (const group of results) {
      for (const article of group) {
        const key = article.url || article.id;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(article);
      }
    }
  }

  merged.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

  return merged;
}
