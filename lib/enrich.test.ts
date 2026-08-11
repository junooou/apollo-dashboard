/**
 * Enrichment guard tests. Offline — no API calls, no credits.
 *
 * The waterfall cases use the real payload shape observed from a live run,
 * which returns SEVERAL emails per person including personal ones.
 */

import { describe, expect, it } from "vitest";
import { pickBestEmail, type EnrichContext } from "./enrich";
import { defaultSettings } from "./settings";
import type { ScoredCandidate } from "./types";

const settings = defaultSettings();

const ctx: EnrichContext = {
  companyName: "DBS Bank",
  targetDomains: ["dbs.com"],
  settings,
};

const candidate: ScoredCandidate = {
  apolloPersonId: "54aabf417468690630fb0817",
  firstname: "Tse",
  lastname: "Shee",
  title: "Group Head of Consumer Banking",
  company: "DBS Bank",
  seniority: "head",
  linkedinUrl: "",
  location: "Singapore",
  employmentDomains: [],
  hasEmail: true,
  hasDirectPhone: false,
  decision: {
    keep: true,
    score: 20,
    reason: "test",
    matchedInclude: [],
    matchedExclude: [],
    matchedNegative: [],
    departments: [],
  },
};

describe("pickBestEmail", () => {
  it("prefers the employer domain over a personal one", () => {
    // Exactly what a live waterfall returned for this person: both addresses,
    // both marked Verified. Taking the first would be a coin flip.
    const best = pickBestEmail(
      [
        { email: "tsekoon@gmail.com", email_status_cd: "Verified" },
        { email: "tsekoon@dbs.com", email_status_cd: "Verified" },
      ],
      ctx,
      candidate,
    );
    expect(best?.email).toBe("tsekoon@dbs.com");
  });

  it("keeps the employer domain even when the personal one comes first", () => {
    const best = pickBestEmail(
      [
        { email: "someone@yahoo.com", email_status_cd: "Verified" },
        { email: "someone@dbs.com", email_status_cd: "Verified" },
      ],
      ctx,
      candidate,
    );
    expect(best?.email).toBe("someone@dbs.com");
  });

  it("falls back to a non-personal address at another domain", () => {
    const best = pickBestEmail(
      [
        { email: "a@gmail.com", email_status_cd: "Verified" },
        { email: "a@someconsultancy.com", email_status_cd: "Verified" },
      ],
      ctx,
      candidate,
    );
    expect(best?.email).toBe("a@someconsultancy.com");
  });

  it("returns a personal address rather than nothing, so guards can log why", () => {
    const best = pickBestEmail(
      [{ email: "a@gmail.com", email_status_cd: "Verified" }],
      ctx,
      candidate,
    );
    expect(best?.email).toBe("a@gmail.com");
  });

  it("returns null when there is nothing usable", () => {
    expect(pickBestEmail([], ctx, candidate)).toBeNull();
    expect(pickBestEmail([{ email: "  " }], ctx, candidate)).toBeNull();
  });

  it("carries the status through", () => {
    const best = pickBestEmail(
      [{ email: "a@dbs.com", email_status_cd: "Verified" }],
      ctx,
      candidate,
    );
    expect(best?.status).toBe("Verified");
  });
});
