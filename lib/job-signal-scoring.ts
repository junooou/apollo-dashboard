/**
 * Deterministic scoring for job-posting hiring signals — no OpenAI, no
 * network call, no cost.
 *
 * Unlike News Triggers, this doesn't need an LLM's judgment: a job posting
 * either matches one of our target departments or it doesn't, and MCF
 * already tells us the seniority band and posting date directly. Keeping
 * this deterministic (and therefore free and instant) is what makes it safe
 * to score on every single page load rather than gating it behind a manual,
 * cost-aware refresh the way News Triggers' OpenAI scoring has to be.
 *
 * Mirrors the shape of lib/news-scoring.ts's ScoredNewsTrigger where it
 * makes sense (relevanceScore, whyRelevant, suggestedOutreachAngle,
 * recommendedAction) so the two feeds can share UI conventions, even though
 * nothing here calls a model.
 */

import type { JobSignalListing } from "./mycareersfuture";

export type ScoredJobSignal = {
  relevanceScore: number;
  isTargetCompany: boolean;
  whyRelevant: string;
  suggestedOutreachAngle: string;
  recommendedAction: "generate_outreach" | "watch";
};

/** MyCareersFuture's coarse seniority bands — verified live (2026-08-13)
 *  against 50 real Customer Experience listings; these are the only values
 *  the API actually returns, not a guess at a longer list. */
const SENIOR_POSITION_LEVELS = new Set(["Senior Management"]);
const MID_POSITION_LEVELS = new Set(["Manager", "Senior Executive"]);

/** A title-text fallback for roles MCF's coarse position-level bucket
 *  under-labels (e.g. a "Head of Digital Experience" posting is commonly
 *  filed under "Manager", not "Senior Management"). Reuses the same
 *  "budget holder" instinct as Apollo's own seniority filters elsewhere in
 *  this app — someone with "Head of" / "Director" / "VP" / "Chief" in their
 *  title is who actually approves a Voncierge deal. */
const SENIOR_TITLE_MARKERS = [
  "chief",
  "head of",
  "director",
  " vp,",
  " vp ",
  "vice president",
  "svp",
  "avp",
  "group head",
];

function titleLooksSenior(title: string): boolean {
  const t = title.toLowerCase();
  return SENIOR_TITLE_MARKERS.some((marker) => t.includes(marker));
}

function seniorityBonus(listing: JobSignalListing): number {
  if (listing.positionLevel && SENIOR_POSITION_LEVELS.has(listing.positionLevel)) return 15;
  if (titleLooksSenior(listing.title)) return 15;
  if (listing.positionLevel && MID_POSITION_LEVELS.has(listing.positionLevel)) return 8;
  return 0;
}

function freshnessBonus(postedDate: string): number {
  if (!postedDate) return 0;
  const posted = new Date(postedDate).getTime();
  if (Number.isNaN(posted)) return 0;
  const ageDays = (Date.now() - posted) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 10;
  if (ageDays <= 14) return 5;
  return 0; // Older postings naturally fall out of the "new signal" tier —
  // this is meant to decay, not stay pinned at a fixed score forever.
}

/** Loose company-name equality — same idea as lib/sheets.ts's
 *  companyNamesMatch, absorbing "DBS" vs "DBS BANK LTD." style drift
 *  between our CSV filenames and MyCareersFuture's registered company
 *  names. */
function looseCompanyMatch(a: string, b: string): boolean {
  const strip = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+(pte\.?\s*ltd\.?|ltd\.?|inc\.?|group)$/i, "")
      .trim();
  const x = strip(a);
  const y = strip(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y));
}

export function isTargetCompany(companyName: string, targetCompanyNames: string[]): boolean {
  return targetCompanyNames.some((target) => looseCompanyMatch(companyName, target));
}

/**
 * Score = 50 base (matched one of our target departments at all) + up to 15
 * for seniority + up to 10 for freshness + 30 if the company is already in
 * the sourcing pipeline. A senior, fresh role at an already-tracked company
 * caps at 100; a junior, older role at an unknown company can land as low
 * as 50 (filtered into "ignored" below the 70 threshold, same convention as
 * News Triggers).
 */
export function scoreJobSignal(
  listing: JobSignalListing,
  targetCompanyNames: string[],
): ScoredJobSignal {
  const targetMatch = isTargetCompany(listing.company.name, targetCompanyNames);

  let score = 50;
  score += seniorityBonus(listing);
  score += freshnessBonus(listing.postedDate);
  if (targetMatch) score += 30;
  score = Math.min(100, score);

  const whyRelevant = targetMatch
    ? `${listing.company.name} — already in the sourcing pipeline — posted a new ${listing.department} role.`
    : `New ${listing.department} role posted at ${listing.company.name}, not yet in the sourcing pipeline.`;

  const suggestedOutreachAngle = targetMatch
    ? `This is a live hiring signal at a company you already have contacts for — reference the new role or team as a timely, specific reason to reach out now rather than a cold restart.`
    : `A live hiring signal at a company not yet sourced — worth a first-touch outreach naming the specific role as the reason for reaching out.`;

  return {
    relevanceScore: score,
    isTargetCompany: targetMatch,
    whyRelevant,
    suggestedOutreachAngle,
    recommendedAction: score >= 70 ? "generate_outreach" : "watch",
  };
}
