/**
 * Groups scored News Trigger articles by company so the dashboard shows one
 * card per company instead of one card per article — a "SIA posts record
 * quarter" story and a "SIA hiring more workers" story are two separate
 * signals worth knowing about, but not two separate cards to scroll past.
 *
 * Pure and offline — no fetch, no OpenAI call — grouping is a display-time
 * concern over data OpenAI already scored, not a new scoring step. Kept
 * generic over the trigger shape so both the client (app/page.tsx) and any
 * future server-side consumer can share it without a circular import back to
 * page.tsx's local types.
 */

type Groupable = {
  score: {
    company: string | null;
    relevanceScore: number;
  };
};

export type NewsTriggerGroup<T extends Groupable> = {
  /** Normalized grouping key — a slug for React keys, not for display. */
  groupKey: string;
  /** Original (non-normalized) company name for display, or null when no
   *  company was identified (each such article is its own ungrouped group). */
  company: string | null;
  /** The highest-scoring article in the group — its score/summary/capabilities
   *  drive the card's main content. */
  primary: T;
  /** All articles in the group, primary first, rest sorted by score desc
   *  then most-recently-seen-as-new first. Includes the primary article. */
  articles: T[];
};

/** Strips common legal suffixes and normalizes case/whitespace so "Singapore
 *  Airlines Ltd" and "Singapore Airlines" land in the same group. Doesn't
 *  attempt fuzzy/substring matching (e.g. "SIA" vs "Singapore Airlines") —
 *  that risks merging unrelated companies with short, ambiguous names, and
 *  OpenAI's own extraction (lib/news-scoring.ts) tends to be internally
 *  consistent about which form it returns for a given company. */
function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+(pte\.?\s*ltd\.?|ltd\.?|inc\.?|group|holdings|limited)$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function groupNewsTriggersByCompany<T extends Groupable>(
  triggers: T[],
): NewsTriggerGroup<T>[] {
  const groups = new Map<string, NewsTriggerGroup<T>>();
  let ungroupedIndex = 0;

  for (const trigger of triggers) {
    const company = trigger.score.company;
    const key = company ? `company:${normalizeCompanyName(company)}` : `ungrouped:${ungroupedIndex++}`;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        groupKey: key,
        company,
        primary: trigger,
        articles: [trigger],
      });
      continue;
    }

    existing.articles.push(trigger);
    if (trigger.score.relevanceScore > existing.primary.score.relevanceScore) {
      existing.primary = trigger;
    }
  }

  const result = Array.from(groups.values());

  for (const group of result) {
    group.articles.sort((a, b) => b.score.relevanceScore - a.score.relevanceScore);
  }

  // Groups ordered by their best article's score, same convention the
  // ungrouped feed already used (highest relevance first).
  result.sort((a, b) => b.primary.score.relevanceScore - a.primary.score.relevanceScore);

  return result;
}
