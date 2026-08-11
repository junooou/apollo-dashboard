/**
 * Enrichment pipeline — the only part of the app that spends credits.
 *
 * Order of operations mirrors context.md's standing workflow:
 *   1. Standard reveal in batches of 10 (bulk_match).
 *   2. Post-checks: personal-domain drop, wrong-employer guard.
 *   3. Optional waterfall pass over the failures only, capped.
 */

import {
  bulkMatch,
  chunk,
  extractWaterfallCredits,
  extractWaterfallPeople,
  waitForWaterfall,
  type BulkMatchDetail,
  type MatchedPerson,
} from "./apollo";
import { emailMatchesEmployer, isPersonalEmail } from "./filter";
import type { EnrichedContact, ScoredCandidate, Settings } from "./types";

export type EnrichContext = {
  companyName: string;
  targetDomains: (string | null)[];
  settings: Settings;
};

function toDetail(c: ScoredCandidate, companyName: string): BulkMatchDetail {
  const detail: BulkMatchDetail = {
    id: c.apolloPersonId,
    first_name: c.firstname,
    last_name: c.lastname,
    organization_name: c.company || companyName,
  };
  if (c.linkedinUrl) detail.linkedin_url = c.linkedinUrl;
  return detail;
}

function locationOf(m: MatchedPerson, fallback: string): string {
  const loc = [m.city, m.state, m.country].filter(Boolean).join(", ");
  return loc || fallback;
}

/**
 * Turn a matched person into a contact, applying the post-reveal guards.
 * A candidate with no email is a "failure" but costs nothing — Apollo charges
 * 0 credits when it finds nothing.
 */
function applyGuards(
  match: MatchedPerson,
  candidate: ScoredCandidate,
  ctx: EnrichContext,
  viaWaterfall: boolean,
): EnrichedContact {
  const base: EnrichedContact = {
    apolloPersonId: candidate.apolloPersonId,
    firstname: match.first_name || candidate.firstname,
    lastname: match.last_name || candidate.lastname,
    title: match.title || candidate.title,
    company: match.organization?.name || candidate.company || ctx.companyName,
    seniority: match.seniority || candidate.seniority,
    email: "",
    email_status: match.email_status || "",
    linkedin_url: match.linkedin_url || candidate.linkedinUrl,
    location: locationOf(match, candidate.location),
    viaWaterfall,
  };

  const email = (match.email || "").trim();

  if (!email || email.toLowerCase().includes("email_not_unlocked")) {
    return { ...base, dropped: "no_email", droppedDetail: "No email available from Apollo" };
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      ...base,
      email,
      dropped: "invalid_format",
      droppedDetail: `Malformed email "${email}"`,
    };
  }

  if (isPersonalEmail(email, ctx.settings.personalEmailDomains)) {
    return {
      ...base,
      email,
      dropped: "personal_domain",
      droppedDetail: `Personal email domain — dropped per context.md`,
    };
  }

  // The IOI Properties guard: check the email actually belongs to this employer.
  const employerCheck = emailMatchesEmployer(email, [
    ...ctx.targetDomains,
    ...candidate.employmentDomains,
  ]);
  if (!employerCheck.matches) {
    return {
      ...base,
      email,
      dropped: "wrong_employer",
      droppedDetail: employerCheck.detail,
    };
  }

  return { ...base, email, email_status: match.email_status || "verified" };
}

/** Match Apollo's response rows back to the candidates we submitted. */
function pairMatches(
  batch: ScoredCandidate[],
  matches: MatchedPerson[],
): Array<{ candidate: ScoredCandidate; match: MatchedPerson | null }> {
  const byId = new Map<string, MatchedPerson>();
  for (const m of matches) {
    if (m.id) byId.set(String(m.id), m);
  }

  return batch.map((candidate, index) => {
    // Prefer an id match; Apollo otherwise returns results positionally,
    // including nulls for people it could not match at all.
    const byIdMatch = byId.get(candidate.apolloPersonId);
    const positional = matches[index] ?? null;
    return { candidate, match: byIdMatch ?? positional };
  });
}

/**
 * Choose the best address when waterfall returns several.
 *
 * Waterfall genuinely returns multiple emails for one person — a live run on a
 * DBS contact returned both `tsekoon@dbs.com` and `tsekoon@gmail.com`, both
 * marked Verified. Taking the first would sometimes write a personal address
 * into the CSV, which context.md explicitly forbids. So: prefer an address that
 * matches the employer, then any non-personal address, and only then give up.
 */
export function pickBestEmail(
  emails: Array<{ email?: string; email_status_cd?: string }>,
  ctx: EnrichContext,
  candidate: ScoredCandidate,
): { email: string; status: string } | null {
  const usable = emails
    .map((e) => ({ email: (e.email ?? "").trim(), status: e.email_status_cd ?? "" }))
    .filter((e) => e.email);

  if (usable.length === 0) return null;

  const targets = [...ctx.targetDomains, ...candidate.employmentDomains];
  const business = usable.filter(
    (e) => !isPersonalEmail(e.email, ctx.settings.personalEmailDomains),
  );

  const employerMatch = business.find((e) => emailMatchesEmployer(e.email, targets).matches);
  if (employerMatch) return employerMatch;

  if (business.length > 0) return business[0];

  // Only personal addresses available — return it so the guards can log the
  // reason rather than reporting a bare "no email".
  return usable[0];
}

export type EnrichResult = {
  contacts: EnrichedContact[];
  waterfallAttempted: number;
  waterfallRecovered: number;
  /** Credits the waterfall reported consuming, straight from Apollo's payload. */
  waterfallCredits: number;
  issues: string[];
};

export async function enrichCandidates(
  candidates: ScoredCandidate[],
  ctx: EnrichContext,
): Promise<EnrichResult> {
  const issues: string[] = [];
  const results: EnrichedContact[] = [];

  // --- Pass 1: standard reveal, 10 at a time -------------------------------
  for (const batch of chunk(candidates, 10)) {
    try {
      const { matches } = await bulkMatch(batch.map((c) => toDetail(c, ctx.companyName)));
      for (const { candidate, match } of pairMatches(batch, matches)) {
        if (!match) {
          results.push({
            apolloPersonId: candidate.apolloPersonId,
            firstname: candidate.firstname,
            lastname: candidate.lastname,
            title: candidate.title,
            company: candidate.company || ctx.companyName,
            seniority: candidate.seniority,
            email: "",
            email_status: "",
            linkedin_url: candidate.linkedinUrl,
            location: candidate.location,
            dropped: "no_email",
            droppedDetail: "Apollo returned no match for this person",
          });
          continue;
        }
        results.push(applyGuards(match, candidate, ctx, false));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push(`Standard enrichment failed for a batch of ${batch.length}: ${msg}`);
      for (const candidate of batch) {
        results.push({
          apolloPersonId: candidate.apolloPersonId,
          firstname: candidate.firstname,
          lastname: candidate.lastname,
          title: candidate.title,
          company: candidate.company || ctx.companyName,
          seniority: candidate.seniority,
          email: "",
          email_status: "",
          linkedin_url: candidate.linkedinUrl,
          location: candidate.location,
          dropped: "no_email",
          droppedDetail: `Enrichment call failed: ${msg}`,
        });
      }
    }
  }

  // --- Pass 2: waterfall over failures only, capped ------------------------
  let waterfallAttempted = 0;
  let waterfallRecovered = 0;
  // Apollo reports waterfall credit consumption directly in the payload, which
  // is more reliable than diffing the account-level usage endpoint.
  let waterfallCredits = 0;

  if (ctx.settings.waterfallEnabled) {
    // Only retry people who genuinely had no email. A wrong-employer or
    // personal-domain result is a rejection, not a miss — retrying wastes credits.
    const retryable = results.filter((r) => r.dropped === "no_email");
    const toRetry = retryable.slice(0, Math.max(0, ctx.settings.waterfallCap));

    if (toRetry.length > 0) {
      const byId = new Map(candidates.map((c) => [c.apolloPersonId, c]));

      for (const batch of chunk(toRetry, 10)) {
        const batchCandidates = batch
          .map((r) => byId.get(r.apolloPersonId))
          .filter((c): c is ScoredCandidate => Boolean(c));
        if (batchCandidates.length === 0) continue;

        waterfallAttempted += batchCandidates.length;

        try {
          const { matches, requestId } = await bulkMatch(
            batchCandidates.map((c) => toDetail(c, ctx.companyName)),
            { runWaterfallEmail: true },
          );

          if (!requestId) {
            issues.push("Waterfall returned no request_id; cannot collect results.");
            continue;
          }

          // Waterfall is asynchronous and the sync response carries no email.
          // Poll for the payload — see waitForWaterfall on why a "failed"
          // delivery status still yields a complete result here.
          const polled = await waitForWaterfall(requestId);
          const people = extractWaterfallPeople(polled);

          const credits = extractWaterfallCredits(polled);
          if (credits != null) waterfallCredits += credits;

          if (people.length === 0) {
            if (polled.failure_reason && !/webhook error/i.test(polled.failure_reason)) {
              issues.push(`Waterfall request ${requestId}: ${polled.failure_reason}`);
            }
            continue;
          }

          // Demographics come from the synchronous response; emails from the poll.
          const demographics = new Map<string, MatchedPerson>();
          for (const m of matches) {
            if (m.id) demographics.set(String(m.id), m);
          }

          for (const person of people) {
            const candidate = batchCandidates.find(
              (c) => c.apolloPersonId === String(person.id ?? ""),
            );
            if (!candidate) continue;

            const best = pickBestEmail(person.emails ?? [], ctx, candidate);
            if (!best) continue;

            const merged: MatchedPerson = {
              ...(demographics.get(candidate.apolloPersonId) ?? {}),
              id: candidate.apolloPersonId,
              email: best.email,
              email_status: best.status || "verified",
            };

            const enriched = applyGuards(merged, candidate, ctx, true);
            const idx = results.findIndex(
              (r) => r.apolloPersonId === candidate.apolloPersonId,
            );
            // Replace the earlier failure either way, so a waterfall result that
            // is itself rejected (personal domain, wrong employer) is reported
            // with its real reason rather than a stale "no email".
            if (idx >= 0) results[idx] = enriched;
            if (!enriched.dropped) waterfallRecovered++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          issues.push(`Waterfall pass failed for ${batchCandidates.length} candidates: ${msg}`);
        }
      }

      if (retryable.length > toRetry.length) {
        issues.push(
          `Waterfall cap of ${ctx.settings.waterfallCap} reached — ${retryable.length - toRetry.length} failed contacts were not retried.`,
        );
      }
      if (waterfallAttempted > 0 && waterfallRecovered === 0) {
        issues.push(
          `Waterfall found nothing for all ${waterfallAttempted} retried contacts (Apollo charges 0 credits when no data is found).`,
        );
      }
    }
  }

  return {
    contacts: results,
    waterfallAttempted,
    waterfallRecovered,
    waterfallCredits,
    issues,
  };
}
