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
import type { JobSignalListing } from "./mycareersfuture";

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
  /** True when the title matches a frontline/operational CX role (concierge,
   *  guest relations, front desk, ...) — see isFrontlineSignal. Surfaced so
   *  the UI and the /api/job-signals overview stats can call these out as a
   *  distinct kind of signal from a decision-maker hire. */
  isFrontlineSignal: boolean;
  whyRelevant: string;
  suggestedOutreachAngle: string;
  recommendedAction: "generate_outreach" | "watch";
};

export type JobSignalRelevance = {
  relevant: boolean;
  reason: string;
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
 * 2026-08-13 follow-up: a company hiring a JUNIOR, frontline CX role — a
 * mall concierge, a guest-service officer, a front-desk hire — is not noise
 * to filter out here. It IS the hiring signal: it means that company is
 * still running the exact manpower-dependent, doesn't-scale service model
 * Voncierge's positioning (context.md) is built to replace. That's a
 * different read than Apollo's people-search criteria, where a junior title
 * is dropped because it's not who to PITCH to — Job Signals isn't picking a
 * pitch contact, it's picking companies with a live operational pain point.
 * So this list stays deliberately generous: frontline/guest-facing titles
 * MyCareersFuture's search surfaces under the Customer Service / Contact
 * Centre and Customer Experience department queries.
 */
const FRONTLINE_SIGNAL_KEYWORDS = [
  "concierge",
  "guest relations",
  "guest service",
  "guest experience",
  "visitor experience",
  "front desk",
  "front office",
  "customer care",
  "customer service officer",
  "customer service executive",
  "customer service assistant",
  "customer service ambassador",
  "guest relations officer",
];

/** Whether a title matches one of the frontline/operational CX signal
 *  patterns above — exported so the /api/job-signals overview stats can
 *  report how many listings in a refresh are this kind of signal. */
export function isFrontlineSignal(title: string): boolean {
  return matchAll(normalise(title), FRONTLINE_SIGNAL_KEYWORDS).length > 0;
}

/**
 * A frontline/operational hire is a strong signal in its own right — worth
 * as much as (or more than) finding a senior decision-maker, since it's
 * direct evidence of the staffing pain Voncierge solves, not just evidence
 * that CX is a priority somewhere in the org. Sized so a fresh frontline
 * posting alone (50 base + 25) clears the 70-point "opportunity" threshold
 * without needing a seniority bonus it will never earn.
 */
function frontlineBonus(listing: JobSignalListing): number {
  return isFrontlineSignal(listing.title) ? 25 : 0;
}

/**
 * Hard exclusions for Job Signals — deliberately its OWN short list, not
 * Apollo's people-search exclusion rules (Apollo Lead Generation/context.md).
 * That list is tuned for "who's worth pitching to" (drops junior/frontline,
 * project management, wealth management, etc.); Job Signals is tuned for
 * "which hiring signals are worth knowing about", a broader and different
 * question — see FRONTLINE_SIGNAL_KEYWORDS above. This stays narrow: just
 * unambiguous wrong-department markers, guarding against MyCareersFuture's
 * single-keyword search occasionally catching an unrelated role (e.g. an
 * "innovation" query surfacing a Cybersecurity Innovation Lead).
 */
const JOB_SIGNAL_EXCLUDE_KEYWORDS = [
  "cyber",
  "cybersecurity",
  "information security",
  "ciso",
  "audit",
  "risk",
  "compliance",
  "finance",
  "financial control",
  "accounting",
  "treasury",
  "legal",
  "counsel",
  "human resources",
  "talent acquisition",
  "recruit",
  "software engineer",
  "infrastructure",
  "devops",
  "site reliability",
  "cloud engineer",
  "data engineer",
  "network engineer",
  "marketing communications",
  "corporate communications",
  "public relations",
  "campaign",
  "sales",
  "business development",
  "account executive",
];

export function evaluateJobSignalRelevance(listing: JobSignalListing): JobSignalRelevance {
  const title = normalise(listing.title);
  const matchedExclude = matchAll(title, JOB_SIGNAL_EXCLUDE_KEYWORDS);

  if (matchedExclude.length > 0) {
    return { relevant: false, reason: `Excluded — title includes "${matchedExclude[0]}"` };
  }

  return { relevant: true, reason: "Passed relevance filter" };
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
 * for seniority OR 25 for a frontline/operational signal (see
 * frontlineBonus — the two can both apply, e.g. a "Guest Relations Manager")
 * + up to 10 for freshness + 30 if the company is already in the sourcing
 * pipeline (local CSV shortlist, see isTargetCompany). A senior or
 * frontline, fresh role at an already-tracked company caps at 100; a bare
 * department-match with no other signal can land as low as 50 (filtered
 * into "ignored" below the 70 threshold, same convention as News Triggers).
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
  const frontlineSignal = isFrontlineSignal(listing.title);

  let score = 50;
  score += seniorityBonus(listing);
  score += frontlineBonus(listing);
  score += freshnessBonus(listing.postedDate);
  if (targetMatch) score += 30;
  score = Math.min(100, score);

  const newLeadClause = isNewLead ? " Not collated in Google Sheets yet — a genuinely new lead." : "";

  const whyRelevant = targetMatch
    ? `${listing.company.name} — already in the sourcing pipeline — posted a new ${listing.department} role.`
    : frontlineSignal
      ? `${listing.company.name} is hiring for a frontline ${listing.title} — exactly the manpower-dependent, doesn't-scale service gap Voncierge's AI concierge is built to close.${newLeadClause}`
      : `New ${listing.department} role posted at ${listing.company.name}, not yet in the sourcing pipeline.${newLeadClause}`;

  const suggestedOutreachAngle = targetMatch
    ? `This is a live hiring signal at a company you already have contacts for — reference the new role or team as a timely, specific reason to reach out now rather than a cold restart.`
    : frontlineSignal
      ? `Lead with the role itself: this company is actively staffing up the exact frontline function Voncierge's AI concierge augments or replaces — a concrete, specific reason to reach out now rather than a generic pitch.`
      : `A live hiring signal at a company not yet sourced — worth a first-touch outreach naming the specific role as the reason for reaching out.`;

  return {
    relevanceScore: score,
    isTargetCompany: targetMatch,
    isNewLead,
    isFrontlineSignal: frontlineSignal,
    whyRelevant,
    suggestedOutreachAngle,
    recommendedAction: score >= 70 ? "generate_outreach" : "watch",
  };
}
