/**
 * Deterministic relevance filter.
 *
 * This encodes the prose rules in `Apollo Lead Generation/context.md` as code.
 * Every decision carries a human-readable `reason` so a wrong call is visible
 * in the UI and fixable in Settings, rather than silently dropping someone.
 *
 * Rule precedence (first match wins):
 *   1. excludeKeywords            -> hard drop
 *   2. conditionalExcludeKeywords -> drop UNLESS a CX include keyword also matches
 *      (context.md: "Wealth management or private banking — unless the role
 *       specifically covers customer experience")
 *   3. negativeSignals            -> drop UNLESS a CX include keyword also matches
 *      (context.md: "generic Business Insights with no CX qualifier")
 *   4. includeKeywords            -> keep, scored
 *   5. no signal either way       -> keep at low score, flagged ambiguous
 *      (context.md kept bare "Product Manager" at consumer-facing companies)
 */

import { DEPARTMENTS } from "./taxonomy";
import type { Candidate, FilterDecision, ScoredCandidate, Settings } from "./types";

/**
 * Seniority weights. Higher = more decision-making authority.
 * "head" is included because Apollo's enrichment response returns it, even
 * though it isn't one of the values accepted by the search filter.
 */
const SENIORITY_SCORE: Record<string, number> = {
  c_suite: 10,
  owner: 9,
  head: 8,
  partner: 7,
  vp: 6,
  director: 5,
  manager: 3,
  senior: 2,
  entry: 0,
  intern: -5,
};

/**
 * Infer seniority from a job title.
 *
 * Needed because `mixed_people/api_search` — the endpoint that replaced the
 * deprecated `mixed_people/search` — does not return a seniority field at all.
 * Without this every candidate would score identically on seniority and the
 * ranking would collapse to keyword count alone.
 *
 * Order matters: the most senior pattern that matches wins.
 */
export function inferSeniority(title: string): string {
  const t = normalise(title);

  if (/\b(chief|ceo|cto|coo|cfo|cio|cdo|cmo|group executive)\b/.test(t)) return "c_suite";
  if (/\b(founder|owner|proprietor)\b/.test(t)) return "owner";
  if (/\b(managing director|executive director|group head|head of|head,|global head|regional head)\b/.test(t)) {
    return "head";
  }
  if (/\b(partner)\b/.test(t)) return "partner";
  if (/\b(evp|svp|vp|vice president|avp)\b/.test(t)) return "vp";
  if (/\b(director)\b/.test(t)) return "director";
  if (/\b(head|lead|principal)\b/.test(t)) return "head";
  if (/\b(manager|management)\b/.test(t)) return "manager";
  if (/\b(senior|snr|sr)\b/.test(t)) return "senior";
  if (/\b(intern|trainee)\b/.test(t)) return "intern";
  if (/\b(executive|officer|analyst|specialist|associate)\b/.test(t)) return "entry";

  return "";
}

/**
 * context.md observed that MD / Executive Director / Head titles have a
 * meaningfully higher email-reveal hit rate than VP titles at large
 * enterprises. Boosting them means we spend credits where they're likeliest
 * to return something.
 */
const HIGH_REVEAL_TITLE_PATTERNS = [
  "managing director",
  "executive director",
  "group head",
  "head of",
  "head,",
  "chief",
];

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s,&-]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Word-boundary-aware match. Substring matching would fire "risk" inside
 * "brisk" and "ux" inside "luxury" — both real titles in this dataset.
 *
 * A trailing "s" is tolerated so "tenant solution" matches the real-world title
 * "Digital Tenant Solutions".
 */
export function containsTerm(haystack: string, term: string): boolean {
  const t = normalise(term);
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}s?([^a-z0-9]|$)`, "i").test(haystack);
}

export function matchAll(haystack: string, terms: string[]): string[] {
  return terms.filter((t) => containsTerm(haystack, t));
}

/**
 * Turns a list of matched keywords into a plain-English clause, e.g.
 * `"innovation" and "customer service"` instead of a bare quoted list —
 * readable at a glance in the review table's Why column.
 */
function naturalJoin(terms: string[]): string {
  const quoted = terms.map((t) => `"${t}"`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
}

/**
 * Which departments a title belongs to.
 *
 * Done locally because Apollo's `person_departments` parameter is silently
 * ignored by api_search — sending it returns identical counts to sending a
 * nonsense parameter (verified 2026-08-05).
 */
export function departmentsForTitle(title: string): string[] {
  const t = normalise(title);
  return DEPARTMENTS.filter((d) => d.keywords.some((kw) => containsTerm(t, kw))).map(
    (d) => d.id,
  );
}

export function evaluateCandidate(
  candidate: Candidate,
  settings: Settings,
): FilterDecision {
  const title = normalise(candidate.title);

  if (!title) {
    return {
      keep: false,
      score: 0,
      reason: "No job title on the Apollo record",
      matchedInclude: [],
      matchedExclude: [],
      matchedNegative: [],
      departments: [],
    };
  }

  const departments = departmentsForTitle(candidate.title);

  // An explicit department selection is a hard narrowing instruction.
  const wanted = settings.departments ?? [];
  if (wanted.length > 0 && !departments.some((d) => wanted.includes(d))) {
    const labels = wanted
      .map((id) => DEPARTMENTS.find((d) => d.id === id)?.label ?? id)
      .join(", ");
    return {
      keep: false,
      score: 0,
      reason: `Outside the selected departments (${labels})`,
      matchedInclude: [],
      matchedExclude: [],
      matchedNegative: [],
      departments,
    };
  }

  const matchedInclude = matchAll(title, settings.includeKeywords);
  const matchedExclude = matchAll(title, settings.excludeKeywords);
  const matchedNegative = matchAll(title, settings.negativeSignals);
  const matchedConditional = matchAll(
    title,
    settings.conditionalExcludeKeywords ?? [],
  );

  // 1. Hard exclusions always win.
  if (matchedExclude.length > 0) {
    return {
      keep: false,
      score: 0,
      reason: `Excluded role — title includes ${naturalJoin(matchedExclude)}`,
      matchedInclude,
      matchedExclude,
      matchedNegative,
      departments,
    };
  }

  // 2. Conditional exclusions drop only without a CX qualifier. This is what
  //    keeps "Group Head of Consumer Banking and Wealth Management" — a real
  //    shipped DBS contact — while still dropping a plain wealth-management role.
  if (matchedConditional.length > 0 && matchedInclude.length === 0) {
    return {
      keep: false,
      score: 0,
      reason: `Excluded — title includes ${naturalJoin(matchedConditional)}, with no CX role to offset it`,
      matchedInclude,
      matchedExclude: [...matchedExclude, ...matchedConditional],
      matchedNegative,
      departments,
    };
  }

  // 3. Negative signals drop only when nothing qualifies them as CX-relevant.
  if (matchedNegative.length > 0 && matchedInclude.length === 0) {
    return {
      keep: false,
      score: 0,
      reason: `Weak signal — title includes ${naturalJoin(matchedNegative)}, with no CX role to offset it`,
      matchedInclude,
      matchedExclude,
      matchedNegative,
      departments,
    };
  }

  // api_search returns no seniority, so fall back to inferring it from the title.
  const seniority = candidate.seniority || inferSeniority(candidate.title);
  const seniorityScore = SENIORITY_SCORE[seniority] ?? 1;
  const revealBoost = HIGH_REVEAL_TITLE_PATTERNS.some((p) => title.includes(p)) ? 4 : 0;
  // Apollo tells us up front whether it holds an email. Someone it has no email
  // for will almost certainly fail enrichment, so rank them below.
  const emailBoost = candidate.hasEmail ? 3 : -6;

  // 4. Positive keyword match.
  if (matchedInclude.length > 0) {
    const keywordScore = matchedInclude.length * 6;
    // A qualified negative signal or conditional exclusion still costs it rank.
    const caveats = [...matchedNegative, ...matchedConditional];
    const penalty = caveats.length > 0 ? 5 : 0;
    const score = keywordScore + seniorityScore + revealBoost + emailBoost - penalty;

    const reason =
      caveats.length > 0
        ? `Title includes ${naturalJoin(matchedInclude)} — kept despite ${naturalJoin(caveats)} because the role is CX-facing`
        : `Title includes ${naturalJoin(matchedInclude)}`;

    return {
      keep: true,
      score,
      reason,
      matchedInclude,
      matchedExclude,
      matchedNegative,
      departments,
    };
  }

  // 5. No signal either way — keep, but rank last and say so.
  return {
    keep: true,
    score: seniorityScore + revealBoost + emailBoost - 4,
    reason: "Ambiguous — no explicit CX keyword; review before enriching",
    matchedInclude,
    matchedExclude,
    matchedNegative,
    departments,
  };
}

/**
 * Score and rank a candidate list. Returns everyone — including rejects — so
 * the UI can show what was dropped and why. Callers decide what to display.
 */
export function filterAndRank(
  candidates: Candidate[],
  settings: Settings,
): ScoredCandidate[] {
  return candidates
    .map((c) => ({ ...c, decision: evaluateCandidate(c, settings) }))
    .sort((a, b) => {
      if (a.decision.keep !== b.decision.keep) return a.decision.keep ? -1 : 1;
      return b.decision.score - a.decision.score;
    });
}

/* ------------------------------------------------------------------ */
/* Post-enrichment guards                                              */
/* ------------------------------------------------------------------ */

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

export function isPersonalEmail(email: string, personalDomains: string[]): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return personalDomains.some((d) => domain === d.toLowerCase());
}

/**
 * The IOI Properties guard.
 *
 * A contact with several concurrent employers in Apollo can come back with a
 * "verified" email belonging to the WRONG employer — that run surfaced
 * `siew_low@skyworld.my` for an IOI Properties person. context.md's conclusion:
 * a verified email at the wrong company is worse than no email.
 *
 * Returns true when the email's domain plausibly belongs to the target company.
 */
export function emailMatchesEmployer(
  email: string,
  targetDomains: (string | null)[],
): { matches: boolean; detail: string } {
  const domain = emailDomain(email);
  if (!domain) return { matches: false, detail: "unparseable email" };

  const targets = targetDomains
    .filter((d): d is string => Boolean(d))
    .map((d) => d.toLowerCase().replace(/^www\./, ""));

  if (targets.length === 0) {
    // No domain to check against — don't block on a check we can't perform.
    return { matches: true, detail: "no target domain known; guard skipped" };
  }

  for (const target of targets) {
    if (domain === target) return { matches: true, detail: `exact match on ${target}` };

    // Subdomain: sg.dbs.com vs dbs.com
    if (domain.endsWith(`.${target}`)) {
      return { matches: true, detail: `subdomain of ${target}` };
    }

    // Country variant: dbs.com.sg vs dbs.com
    if (domain.startsWith(`${target}.`)) {
      return { matches: true, detail: `country variant of ${target}` };
    }

    // Same leading label, e.g. accor.com vs accorhotels.com. Requires 4+ chars
    // so short roots like "ioi" can't collide with unrelated companies.
    const targetRoot = target.split(".")[0];
    const domainRoot = domain.split(".")[0];
    if (targetRoot.length >= 4 && domainRoot === targetRoot) {
      return { matches: true, detail: `shares root "${targetRoot}"` };
    }
    if (targetRoot.length >= 4 && domainRoot.includes(targetRoot)) {
      return { matches: true, detail: `contains root "${targetRoot}"` };
    }
  }

  return {
    matches: false,
    detail: `email domain "${domain}" does not match target ${targets.join(" / ")}`,
  };
}
