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

import { matchAll, normalise } from "./filter";
import { departmentById } from "./taxonomy";
import type { JobSignalListing } from "./mycareersfuture";
import type { Settings } from "./types";

export type ScoredJobSignal = {
  relevanceScore: number;
  isTargetCompany: boolean;
  /** True when this company's name doesn't fuzzy-match any company already
   *  collated across the "Voncierge Outreach" Google Sheets — i.e. a
   *  genuinely new lead, not just "not in the local CSV folder" (that's
   *  what isTargetCompany checks). Null when the Sheets index isn't
   *  configured or hasn't loaded, so callers can tell "confirmed new" apart
   *  from "unknown" rather than defaulting unknowns to true. */
  isNewLead: boolean | null;
  whyRelevant: string;
  suggestedOutreachAngle: string;
  recommendedAction: "generate_outreach" | "watch";
};

export type JobSignalRelevance = {
  relevant: boolean;
  reason: string;
  matchedInclude: string[];
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

/**
 * MyCareersFuture's search is a single sharp keyword per department (see
 * lib/mycareersfuture.ts), so a "Customer Experience" query happily returns
 * things like "Customer Experience Coordinator (Finance)" or a junior
 * frontline role — matches the department, but not actually who
 * `Apollo Lead Generation/context.md` wants us chasing. This mirrors
 * lib/filter.ts's exclude / conditional-exclude / negative-signal sieve
 * against the SAME Settings-driven keyword lists the Apollo people search
 * uses, so the two pipelines can't drift into disagreeing about what counts
 * as relevant.
 */
export function evaluateJobSignalRelevance(
  listing: JobSignalListing,
  settings: Pick<
    Settings,
    "includeKeywords" | "excludeKeywords" | "conditionalExcludeKeywords" | "negativeSignals"
  >,
): JobSignalRelevance {
  const title = normalise(listing.title);
  const matchedInclude = matchAll(title, settings.includeKeywords);
  const matchedExclude = matchAll(title, settings.excludeKeywords);
  const matchedConditional = matchAll(title, settings.conditionalExcludeKeywords ?? []);
  const matchedNegative = matchAll(title, settings.negativeSignals ?? []);

  if (matchedExclude.length > 0) {
    return {
      relevant: false,
      reason: `Excluded — title includes "${matchedExclude[0]}"`,
      matchedInclude,
    };
  }

  // context.md: "Wealth management or private banking — unless the role
  // specifically covers customer experience" / "Project management without
  // a clear CX, AI or digital-transformation focus".
  if (matchedConditional.length > 0 && matchedInclude.length === 0) {
    return {
      relevant: false,
      reason: `Excluded — title includes "${matchedConditional[0]}", no CX signal to offset it`,
      matchedInclude,
    };
  }

  if (matchedNegative.length > 0 && matchedInclude.length === 0) {
    return {
      relevant: false,
      reason: `Weak signal — title includes "${matchedNegative[0]}", no CX signal to offset it`,
      matchedInclude,
    };
  }

  if (isJuniorFrontline(listing)) {
    return {
      relevant: false,
      reason: `Junior/frontline customer-service posting (position level: ${listing.positionLevel})`,
      matchedInclude,
    };
  }

  return { relevant: true, reason: "Passed relevance filter", matchedInclude };
}

/**
 * context.md: "Junior customer-service or frontline support roles" — drop.
 * Job Signals has no seniority filter at fetch time (unlike Apollo people
 * search, which is pre-scoped to manager+), so this has to happen here.
 * Deliberately scoped to the Customer Service department and to listings
 * where MyCareersFuture actually returned a position level below our
 * verified Manager/Senior Executive/Senior Management bands — a missing
 * positionLevel isn't treated as junior, since that would be guessing.
 */
function isJuniorFrontline(listing: JobSignalListing): boolean {
  if (listing.department !== departmentById("customer_service")?.label) return false;
  if (titleLooksSenior(listing.title)) return false;
  if (!listing.positionLevel) return false;
  if (SENIOR_POSITION_LEVELS.has(listing.positionLevel)) return false;
  if (MID_POSITION_LEVELS.has(listing.positionLevel)) return false;
  return true;
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
 * the sourcing pipeline (local CSV shortlist, see isTargetCompany). A senior,
 * fresh role at an already-tracked company caps at 100; a junior, older role
 * at an unknown company can land as low as 50 (filtered into "ignored" below
 * the 70 threshold, same convention as News Triggers).
 *
 * `sheetsCompanyNames` is a separate, independent check against the actual
 * "Voncierge Outreach" Google Sheets contents (not the local CSV folder) —
 * it drives `isNewLead`, not the score itself. Pass `null` when the Sheets
 * index isn't configured/available so callers can distinguish "confirmed not
 * in Sheets" from "we don't know".
 */
export function scoreJobSignal(
  listing: JobSignalListing,
  targetCompanyNames: string[],
  sheetsCompanyNames: string[] | null,
): ScoredJobSignal {
  const targetMatch = isTargetCompany(listing.company.name, targetCompanyNames);
  const isNewLead =
    sheetsCompanyNames === null ? null : !isTargetCompany(listing.company.name, sheetsCompanyNames);

  let score = 50;
  score += seniorityBonus(listing);
  score += freshnessBonus(listing.postedDate);
  if (targetMatch) score += 30;
  score = Math.min(100, score);

  const whyRelevant = targetMatch
    ? `${listing.company.name} — already in the sourcing pipeline — posted a new ${listing.department} role.`
    : isNewLead
      ? `New ${listing.department} role at ${listing.company.name} — not collated in Google Sheets yet, a genuinely new lead.`
      : `New ${listing.department} role posted at ${listing.company.name}, not yet in the sourcing pipeline.`;

  const suggestedOutreachAngle = targetMatch
    ? `This is a live hiring signal at a company you already have contacts for — reference the new role or team as a timely, specific reason to reach out now rather than a cold restart.`
    : `A live hiring signal at a company not yet sourced — worth a first-touch outreach naming the specific role as the reason for reaching out.`;

  return {
    relevanceScore: score,
    isTargetCompany: targetMatch,
    isNewLead,
    whyRelevant,
    suggestedOutreachAngle,
    recommendedAction: score >= 70 ? "generate_outreach" : "watch",
  };
}
