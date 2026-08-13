/**
 * MyCareersFuture (Singapore's official government job portal) client.
 *
 * Public API — no key, no auth, no signup. Verified live (2026-08-13):
 * `GET /v2/jobs?search=...` is a genuinely open, unauthenticated endpoint
 * that paginates through Singapore's live job listings. Unlike Apollo,
 * OpenAI, or Google Sheets, there is no credential to configure and no cost
 * per call — this is why the fetch trigger for this feature (see
 * app/api/job-signals/route.ts) is "every page load", not a manual,
 * credit-gated refresh like News Triggers.
 *
 * Coverage note: MyCareersFuture only lists Singapore jobs. Several
 * companies already in `Apollo Lead Generation/` are based in Malaysia,
 * Thailand, or Indonesia (Sunway, Siam Piwat, The Mall Group, KLCC, Pavilion,
 * IOI Properties, Pacific Place Jakarta) and will never appear here — this
 * complements the pipeline's Singapore coverage, it doesn't replace the
 * rest.
 */

import { DEPARTMENTS } from "./taxonomy";

const API_BASE = "https://api.mycareersfuture.gov.sg/v2";

/** Results per department query. One HTTP call per department, run in
 *  parallel — 8 calls today (the "recommended" departments), well within
 *  what an unauthenticated public endpoint should be asked to shrug off. */
const RESULTS_PER_QUERY = 30;

/**
 * SSIC code for "Employment placement agencies and executive search
 * services" in Singapore's official industry classification. Verified live
 * (2026-08-13) against five known recruitment/staffing firms that were
 * dominating early test results (Persol, GMP Recruitment, The Supreme HR
 * Advisory, EA Recruitment, People Profilers, JobStudio) — all five report
 * exactly this code. A posting from one of these isn't a hiring signal for
 * the agency itself; it's a signal for whichever undisclosed client they're
 * staffing, which this API doesn't reveal. Filtering them out trades a
 * small amount of recall (a genuine staffing-agency lead, if that were ever
 * relevant) for a large amount of precision (not attributing someone else's
 * hire to a recruiter).
 */
const RECRUITMENT_AGENCY_SSIC_CODES = new Set(["78104"]);

export type JobSignalListing = {
  uuid: string;
  title: string;
  jobUrl: string;
  postedDate: string;
  positionLevel: string | null;
  employmentType: string | null;
  company: {
    uen: string;
    name: string;
    employeeCount: number | null;
    ssicCode: string | null;
  };
  /** Which lib/taxonomy.ts department this was found under. A listing can
   *  legitimately match more than one department query; kept as the first
   *  (highest-priority) department it matched. */
  department: string;
};

type RawMcfCompany = {
  uen?: string;
  name?: string;
  employeeCount?: number | null;
  ssicCode?: string | null;
};

type RawMcfJob = {
  uuid?: string;
  title?: string;
  postedCompany?: RawMcfCompany;
  metadata?: { newPostingDate?: string; jobDetailsUrl?: string };
  positionLevels?: { position?: string }[];
  employmentTypes?: { employmentType?: string }[];
};

type RawMcfResponse = { results?: RawMcfJob[] };

async function searchJobs(query: string, limit = RESULTS_PER_QUERY): Promise<RawMcfJob[]> {
  const url = `${API_BASE}/jobs?limit=${limit}&search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MyCareersFuture ${res.status} for query "${query}"`);
  }
  const data = (await res.json()) as RawMcfResponse;
  return data.results ?? [];
}

function isRecruitmentAgency(company: RawMcfCompany | undefined): boolean {
  const code = company?.ssicCode;
  return Boolean(code && RECRUITMENT_AGENCY_SSIC_CODES.has(code));
}

function toListing(raw: RawMcfJob, department: string): JobSignalListing | null {
  if (!raw.uuid || !raw.title || !raw.postedCompany?.uen || !raw.postedCompany.name) {
    return null; // Malformed record — skip rather than show a broken card.
  }
  return {
    uuid: raw.uuid,
    title: raw.title,
    jobUrl: raw.metadata?.jobDetailsUrl ?? "",
    postedDate: raw.metadata?.newPostingDate ?? "",
    positionLevel: raw.positionLevels?.[0]?.position ?? null,
    employmentType: raw.employmentTypes?.[0]?.employmentType ?? null,
    company: {
      uen: raw.postedCompany.uen,
      name: raw.postedCompany.name,
      employeeCount: raw.postedCompany.employeeCount ?? null,
      ssicCode: raw.postedCompany.ssicCode ?? null,
    },
    department,
  };
}

/**
 * One search per "recommended" department (lib/taxonomy.ts), run in
 * parallel — the same taxonomy already used for Apollo person search, on
 * the theory that "who we'd search Apollo for" and "which hiring signals
 * matter" should be one list, not two independently-maintained ones.
 *
 * Deliberately one sharp keyword per department rather than the full
 * keyword list per department: MyCareersFuture's `search` behaves like an
 * AND across terms (multi-word queries returned far fewer results than any
 * single term in manual testing), so broad coverage means many separate
 * single-term queries, not one combined one.
 */
export async function fetchJobSignalCandidates(): Promise<JobSignalListing[]> {
  const queries = DEPARTMENTS.filter((d) => d.recommended).map((d) => ({
    department: d.label,
    keyword: d.keywords[0],
  }));

  const perDepartment = await Promise.all(
    queries.map(async ({ department, keyword }) => {
      try {
        const raw = await searchJobs(keyword);
        return raw
          .filter((job) => !isRecruitmentAgency(job.postedCompany))
          .map((job) => toListing(job, department))
          .filter((l): l is JobSignalListing => l !== null);
      } catch (err) {
        console.error(`MyCareersFuture query failed for "${keyword}":`, err);
        return [];
      }
    }),
  );

  // A listing can match more than one department query (e.g. a "Head of
  // Digital Customer Experience" role matches both Customer Experience and
  // Digital Transformation) — keep the first department it was found under
  // rather than showing it twice.
  const seen = new Map<string, JobSignalListing>();
  for (const listing of perDepartment.flat()) {
    if (!seen.has(listing.uuid)) seen.set(listing.uuid, listing);
  }
  return [...seen.values()];
}
