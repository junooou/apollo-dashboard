/**
 * Read-only lookups that feed the LinkedIn Drafts generator with signals
 * that already exist elsewhere in the app — no new fetches, no new OpenAI
 * scoring calls, no new cost. Deliberately separate from
 * app/api/news-triggers/route.ts and app/api/job-signals/route.ts (which own
 * fetching/scoring/history-writing for their tabs) — this only ever reads
 * the same on-disk history files they already maintain.
 */

import fs from "fs/promises";
import path from "path";

const NEWS_HISTORY_PATH = path.join(process.cwd(), "data", "news-history.json");
const JOB_SIGNALS_HISTORY_PATH = path.join(process.cwd(), "data", "job-signals-history.json");

/** Same bar both News Triggers and Job Signals already use to mean "worth
 *  acting on" (`app/api/news-triggers/route.ts`, `app/api/job-signals/route.ts`
 *  both filter `relevanceScore >= 70`) — reused here rather than inventing a
 *  third threshold. */
const RELEVANCE_FLOOR = 70;

/** Below this length a substring match is too likely to be noise ("A" would
 *  match everything) — same rule as `lib/sheets.ts`'s companyNamesMatch. */
const MIN_FUZZY_LEN = 3;

function companyNamesMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return (
    x === y ||
    (x.length >= MIN_FUZZY_LEN && y.includes(x)) ||
    (y.length >= MIN_FUZZY_LEN && x.includes(y))
  );
}

export type PersonalizationAngle = {
  source: "news" | "job_signal";
  /** Short, human-readable angle text — fed straight into the LLM prompt. */
  summary: string;
  relevanceScore: number;
};

type NewsHistoryFile = {
  entries?: Array<{
    article: { title: string };
    score: {
      company: string | null;
      relevanceScore: number;
      suggestedOutreachAngle: string;
    };
  }>;
};

/** The single best-scoring News Trigger already computed for `companyName`,
 *  if any cleared the 70-point bar — a pure file read, costs nothing. */
export async function findNewsAngle(companyName: string): Promise<PersonalizationAngle | null> {
  try {
    const raw = await fs.readFile(NEWS_HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as NewsHistoryFile;
    const entries = parsed.entries ?? [];

    const matches = entries.filter(
      (e) =>
        e.score.company &&
        companyNamesMatch(e.score.company, companyName) &&
        e.score.relevanceScore >= RELEVANCE_FLOOR,
    );
    if (matches.length === 0) return null;

    matches.sort((a, b) => b.score.relevanceScore - a.score.relevanceScore);
    const best = matches[0];

    return {
      source: "news",
      summary: `Recent news: "${best.article.title}." ${best.score.suggestedOutreachAngle}`,
      relevanceScore: best.score.relevanceScore,
    };
  } catch {
    return null;
  }
}

type JobSignalsHistoryFile = {
  entries?: Array<{
    listing: { title: string; company: { name: string } };
    score: { relevanceScore: number; suggestedOutreachAngle: string };
  }>;
};

/** The single best-scoring open role already found for `companyName`, if any
 *  cleared the 70-point bar — a pure file read, costs nothing. */
export async function findJobSignalAngle(companyName: string): Promise<PersonalizationAngle | null> {
  try {
    const raw = await fs.readFile(JOB_SIGNALS_HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as JobSignalsHistoryFile;
    const entries = parsed.entries ?? [];

    const matches = entries.filter(
      (e) =>
        companyNamesMatch(e.listing.company.name, companyName) &&
        e.score.relevanceScore >= RELEVANCE_FLOOR,
    );
    if (matches.length === 0) return null;

    matches.sort((a, b) => b.score.relevanceScore - a.score.relevanceScore);
    const best = matches[0];

    return {
      source: "job_signal",
      summary: `Hiring signal: open role "${best.listing.title}." ${best.score.suggestedOutreachAngle}`,
      relevanceScore: best.score.relevanceScore,
    };
  } catch {
    return null;
  }
}
