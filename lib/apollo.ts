/**
 * Apollo.io REST client.
 *
 * Note this talks to the REST API with an `x-api-key`, NOT the MCP connector used
 * in Claude Code sessions — MCP connectors only exist inside an AI client and
 * cannot be called from a server.
 *
 * Credit behaviour that shapes this file:
 *   - mixed_people/search  -> FREE, returns no emails
 *   - people/bulk_match    -> COSTS credits, max 10 people per call
 */

import type { Candidate, Organization, OrganizationProfile } from "./types";

const BASE = "https://api.apollo.io/api/v1";

/** Apollo rate-limits per minute; keep concurrent calls modest to avoid 429 storms. */
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 4;

/**
 * Placeholder webhook target for waterfall requests. Apollo requires the
 * parameter but only validates its format, so nothing is ever delivered here —
 * results are collected by polling. Override with WATERFALL_WEBHOOK_URL if you
 * ever run this somewhere with a real public endpoint.
 */
const WATERFALL_SINK_URL =
  process.env.WATERFALL_WEBHOOK_URL || "https://example.com/apollo-waterfall-sink";

export class ApolloError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApolloError";
  }
}

export function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) {
    throw new ApolloError(
      "APOLLO_API_KEY is not set. Copy .env.local.example to .env.local and add your key from Apollo -> Settings -> Integrations -> API.",
      500,
    );
  }
  return key;
}

/** Simple semaphore so we never have more than MAX_CONCURRENT requests in flight. */
let active = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const { data } = await requestWithRaw<T>(path, init);
  return data;
}

/**
 * Same as `request`, but also hands back the raw response text.
 *
 * Needed because Apollo's `request_id` is a signed 64-bit integer that exceeds
 * Number.MAX_SAFE_INTEGER. JSON.parse silently rounds it — a real id of
 * -13768839000940095 comes back as -13768839000940096, and polling that value
 * 404s. Callers that need the exact id must read it out of the raw text.
 */
async function requestWithRaw<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ data: T; raw: string }> {
  await acquire();
  try {
    let lastError: ApolloError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(`${BASE}${path}`, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          accept: "application/json",
          "x-api-key": getApiKey(),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });

      if (res.ok) {
        const raw = await res.text();
        return { data: JSON.parse(raw) as T, raw };
      }

      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep raw text */
      }

      // 429 and 5xx are worth retrying; everything else is a real error.
      if (res.status === 429 || res.status >= 500) {
        lastError = new ApolloError(
          `Apollo ${res.status} on ${path}`,
          res.status,
          parsed,
        );
        // Respect Retry-After when Apollo sends it, else exponential backoff.
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 1000, 16000);
        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }
      }

      if (res.status === 401 || res.status === 403) {
        throw new ApolloError(
          `Apollo rejected the API key (${res.status}). Check APOLLO_API_KEY is a master key with search + enrichment scopes.`,
          res.status,
          parsed,
        );
      }

      throw new ApolloError(`Apollo ${res.status} on ${path}`, res.status, parsed);
    }

    throw lastError ?? new ApolloError(`Apollo request failed: ${path}`, 500);
  } finally {
    release();
  }
}

/* ------------------------------------------------------------------ */
/* Organization resolution                                             */
/* ------------------------------------------------------------------ */

type RawOrg = {
  id?: string;
  /** Only present on `mixed_companies/search` results in the `accounts` bucket — the real Apollo org ID, distinct from `id` (an account ID). */
  organization_id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  domain?: string;
  estimated_num_employees?: number;
  linkedin_url?: string;
};

function normaliseDomain(input?: string | null): string | null {
  if (!input) return null;
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "") || null;
}

/**
 * `idField` selects which raw field is the real Apollo organization ID.
 * `mixed_companies/search` returns two buckets with different ID semantics:
 * `organizations` entries use `id` directly, but `accounts` entries (companies
 * already saved to this Apollo team) use `id` for an *account* ID — the real
 * org ID lives in `organization_id`. Passing the wrong one resolves the
 * company "successfully" but makes every downstream people-search silently
 * match nothing, since Apollo's organization_ids filter only accepts org IDs.
 */
function toOrganization(raw: RawOrg, idField: "id" | "organization_id" = "id"): Organization {
  const domains = [raw.primary_domain, raw.domain, raw.website_url]
    .map(normaliseDomain)
    .filter((d): d is string => Boolean(d));
  const unique = [...new Set(domains)];
  return {
    id: (idField === "organization_id" ? raw.organization_id : raw.id) ?? raw.id ?? "",
    name: raw.name ?? "",
    domain: unique[0] ?? null,
    altDomains: unique.slice(1),
    employeeCount: raw.estimated_num_employees ?? null,
    linkedinUrl: raw.linkedin_url ?? null,
  };
}

/**
 * Resolve a company name (or domain) to Apollo organizations.
 * Returns several matches so the user can disambiguate — this matters because
 * group structures like "Sunway" span multiple domains (corporate vs mall unit).
 */
export async function searchOrganizations(query: string): Promise<Organization[]> {
  // Requires the whole trimmed input to be domain-shaped (label.label...tld),
  // not just "contains a period" — a name like "Grab.com Holdings" or an
  // abbreviation with a stray dot must not get routed to the domain-only path.
  const looksLikeDomain =
    /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(query.trim());

  if (looksLikeDomain) {
    const domain = normaliseDomain(query);
    const data = await request<{ organization?: RawOrg }>(
      `/organizations/enrich?domain=${encodeURIComponent(domain ?? query)}`,
      { method: "GET" },
    );
    if (data.organization) {
      return [toOrganization(data.organization)];
    }
    // No exact domain match — the query may have been misclassified (or is a
    // domain Apollo just doesn't have), so fall through to the name search
    // below instead of returning empty.
  }

  const data = await request<{ organizations?: RawOrg[]; accounts?: RawOrg[] }>(
    "/mixed_companies/search",
    {
      method: "POST",
      body: { q_organization_name: query, page: 1, per_page: 10 },
    },
  );

  const orgs = [
    ...(data.organizations ?? []).map((o) => toOrganization(o, "id")),
    ...(data.accounts ?? []).map((a) => toOrganization(a, "organization_id")),
  ];

  // Apollo returns many records for one company ("Maybank" returns 10, mostly
  // subsidiaries). Rank the likeliest parent entity first.
  //
  // Note mixed_companies/search carries NO headcount field, so size can't be
  // used here. Name closeness is the usable signal: an exact match beats a
  // prefix match, a record with a domain beats one without (domains are what
  // people-search actually filters on), and among equals the shorter name is
  // more likely the parent — "Maybank" over "Maybank Investment Banking Group".
  const q = query.trim().toLowerCase();
  return orgs
    .filter((o) => o.id)
    .sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();

      const exact = Number(bn === q) - Number(an === q);
      if (exact !== 0) return exact;

      // Prefer the query appearing as a whole word: "DBS Bank" over "DBSync".
      const wholeWord = (name: string) =>
        Number(name === q || name.startsWith(`${q} `) || name.startsWith(`${q}-`));
      const word = wholeWord(bn) - wholeWord(an);
      if (word !== 0) return word;

      const prefix = Number(bn.startsWith(q)) - Number(an.startsWith(q));
      if (prefix !== 0) return prefix;

      const hasDomain = Number(Boolean(b.domain)) - Number(Boolean(a.domain));
      if (hasDomain !== 0) return hasDomain;

      return a.name.length - b.name.length;
    });
}

/**
 * Fields `organizations/enrich` returns beyond what `toOrganization` above
 * pulls out — industry, HQ, funding. `mixed_companies/search` (the name-search
 * path) never carries these, so this is the only source for them.
 */
type RawOrgProfile = RawOrg & {
  industry?: string;
  founded_year?: number;
  short_description?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  keywords?: string[];
  total_funding_printed?: string;
  latest_funding_stage?: string;
  latest_funding_round_date?: string;
  publicly_traded_symbol?: string | null;
};

/**
 * Fetch firmographic detail (industry, size, HQ, funding stage) for one
 * resolved organization, to orient the user before they spend a search on it.
 *
 * Requires a domain — Apollo's org-enrich endpoint takes `domain`, not an
 * `id`, which is why this is called only after the user has picked a specific
 * organization (its domain is known by then), not for every raw search match.
 *
 * COSTS 1 CREDIT PER CALL — verified live (2026-08-13): three calls in a row
 * dropped the account's lead-credit balance by exactly 1 each time. This is
 * true even though `searchOrganizations`'s existing domain-lookup path also
 * calls this same endpoint during Step 1 (free) company search — that call
 * happens to be free in practice only because it's the rarer path (most
 * lookups go through the by-name `mixed_companies/search`, which is free).
 * Callers of THIS function must treat it like `people/bulk_match`: never call
 * it without an explicit user action. See the "Company profile" button in
 * app/page.tsx — deliberately not automatic on company selection, matching
 * the credit-gate rule in AGENTS.md.
 */
export async function enrichOrganization(domain: string): Promise<OrganizationProfile | null> {
  const normalised = normaliseDomain(domain);
  if (!normalised) return null;

  const data = await request<{ organization?: RawOrgProfile }>(
    `/organizations/enrich?domain=${encodeURIComponent(normalised)}`,
    { method: "GET" },
  );
  const raw = data.organization;
  if (!raw) return null;

  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    domain: normaliseDomain(raw.primary_domain ?? raw.domain ?? normalised),
    websiteUrl: raw.website_url ?? null,
    linkedinUrl: raw.linkedin_url ?? null,
    industry: raw.industry ?? null,
    employeeCount: raw.estimated_num_employees ?? null,
    foundedYear: raw.founded_year ?? null,
    shortDescription: raw.short_description ?? null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    country: raw.country ?? null,
    phone: raw.phone ?? null,
    keywords: Array.isArray(raw.keywords) ? raw.keywords.slice(0, 8) : [],
    totalFundingPrinted: raw.total_funding_printed ?? null,
    latestFundingStage: raw.latest_funding_stage ?? null,
    latestFundingDate: raw.latest_funding_round_date ?? null,
    publiclyTraded: Boolean(raw.publicly_traded_symbol),
    stockSymbol: raw.publicly_traded_symbol ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* People search (free)                                                */
/* ------------------------------------------------------------------ */

/**
 * Search response shape for `mixed_people/api_search`.
 *
 * This endpoint deliberately returns LESS than the old (now deprecated)
 * mixed_people/search: last names are masked ("Ga***i"), and seniority,
 * location and LinkedIn URL are absent entirely — Apollo only tells you whether
 * it *has* those fields. Full details arrive at enrichment time.
 *
 * The upside is `has_email`: we learn whether Apollo holds an email at all
 * before spending anything, which lets the review table steer selection toward
 * candidates that will actually resolve.
 */
type RawSearchPerson = {
  id?: string;
  first_name?: string;
  last_name_obfuscated?: string;
  title?: string;
  has_email?: boolean;
  has_direct_phone?: string;
  has_city?: boolean;
  has_country?: boolean;
  organization?: { name?: string };
};

function toCandidate(raw: RawSearchPerson, fallbackCompany: string): Candidate {
  return {
    apolloPersonId: raw.id ?? "",
    firstname: raw.first_name ?? "",
    // Masked at search time; the real surname arrives from bulk_match.
    lastname: raw.last_name_obfuscated ?? "",
    title: raw.title ?? "",
    company: raw.organization?.name ?? fallbackCompany,
    // Not returned by api_search — inferred from the title in lib/filter.ts.
    seniority: "",
    linkedinUrl: "",
    location: "",
    employmentDomains: [],
    hasEmail: raw.has_email ?? false,
    hasDirectPhone:
      typeof raw.has_direct_phone === "string"
        ? raw.has_direct_phone.toLowerCase().startsWith("yes")
        : false,
  };
}

export type PeopleSearchParams = {
  organizationIds?: string[];
  domains?: string[];
  companyName: string;
  personTitles: string[];
  personSeniorities: string[];
  personLocations: string[];
  /** Hard cap on how many people to pull. Search is free but not instant. */
  maxResults?: number;
};

/**
 * Paginate `mixed_people/api_search`. Consumes NO credits and returns NO emails —
 * this is the wide net; narrowing happens in lib/filter.ts.
 *
 * Note the endpoint: plain `mixed_people/search` now returns HTTP 422
 * ("deprecated for API callers") and must not be used.
 */
export async function searchPeople(
  params: PeopleSearchParams,
): Promise<{ candidates: Candidate[]; totalAvailable: number }> {
  const perPage = 100;
  const maxResults = params.maxResults ?? 500;
  const candidates: Candidate[] = [];
  let totalAvailable = 0;
  let page = 1;

  while (candidates.length < maxResults) {
    const body: Record<string, unknown> = { page, per_page: perPage };

    // Prefer domain filtering and do NOT combine it with organization_ids.
    //
    // Apollo often holds several org records for one company — a "Maybank"
    // search returns 10, most of them near-empty duplicates. Filtering by an
    // organization_id pins you to whichever record the picker resolved, which
    // returned 0 people for Maybank while the same search by domain returned 76.
    // A domain matches people by their employer regardless of which duplicate
    // record they hang off, so it is used whenever one is known.
    if (params.domains?.length) {
      body.q_organization_domains_list = params.domains;
    } else if (params.organizationIds?.length) {
      body.organization_ids = params.organizationIds;
    }
    if (params.personTitles.length) body.person_titles = params.personTitles;
    if (params.personSeniorities.length) {
      body.person_seniorities = params.personSeniorities;
    }
    if (params.personLocations.length) {
      body.person_locations = params.personLocations;
    }

    const data = await request<{
      people?: RawSearchPerson[];
      contacts?: RawSearchPerson[];
      total_entries?: number;
      pagination?: { total_entries?: number; total_pages?: number };
    }>("/mixed_people/api_search", { method: "POST", body });

    const batch = [...(data.people ?? []), ...(data.contacts ?? [])];
    // api_search reports total_entries at the top level, not under pagination.
    totalAvailable =
      data.total_entries ?? data.pagination?.total_entries ?? totalAvailable;

    if (batch.length === 0) break;

    for (const p of batch) {
      const c = toCandidate(p, params.companyName);
      if (c.apolloPersonId) candidates.push(c);
    }

    const totalPages =
      data.pagination?.total_pages ??
      (totalAvailable ? Math.ceil(totalAvailable / perPage) : 1);
    if (page >= totalPages || page >= 500) break;
    page++;
  }

  // Apollo occasionally returns the same person across pages; keep the first.
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.apolloPersonId)) return false;
    seen.add(c.apolloPersonId);
    return true;
  });

  return { candidates: deduped.slice(0, maxResults), totalAvailable };
}

/* ------------------------------------------------------------------ */
/* Enrichment (costs credits)                                          */
/* ------------------------------------------------------------------ */

export type BulkMatchDetail = {
  id?: string;
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  domain?: string;
  linkedin_url?: string;
};

export type MatchedPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: { name?: string; primary_domain?: string };
  employment_history?: Array<{
    current?: boolean;
    organization_name?: string;
    domain?: string;
  }>;
};

/**
 * Enrich up to 10 people in one call. Costs 1–9 credits per person, 0 when
 * Apollo finds nothing. Callers must chunk to 10 — see enrichInBatches.
 */
export async function bulkMatch(
  details: BulkMatchDetail[],
  opts: { runWaterfallEmail?: boolean; webhookUrl?: string } = {},
): Promise<{ matches: MatchedPerson[]; requestId: string | null }> {
  if (details.length > 10) {
    throw new ApolloError("bulk_match accepts at most 10 people per call", 400);
  }

  const body: Record<string, unknown> = {
    details,
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };

  if (opts.runWaterfallEmail) {
    body.run_waterfall_email = true;
    // Apollo REJECTS a waterfall request without a webhook_url (verified: HTTP
    // 400, "Please add a valid 'webhook_url' parameter"). It only validates the
    // URL's format, not its reachability — so we pass a deliberately dead URL
    // and collect results by polling /webhook_result instead. This keeps
    // prospect emails inside Apollo rather than routing them through a
    // third-party sink like webhook.site.
    body.webhook_url = opts.webhookUrl || WATERFALL_SINK_URL;
  }

  const { data, raw } = await requestWithRaw<{
    matches?: MatchedPerson[];
    request_id?: string | number;
  }>("/people/bulk_match", { method: "POST", body });

  return {
    matches: data.matches ?? [],
    requestId: extractRequestId(raw, data.request_id),
  };
}

/**
 * Read `request_id` from the raw JSON text so its full precision survives.
 * Falls back to the parsed value only if the pattern is absent.
 */
export function extractRequestId(
  raw: string,
  parsed?: string | number | null,
): string | null {
  const match = raw.match(/"request_id"\s*:\s*"?(-?\d+)"?/);
  if (match) return match[1];
  return parsed != null ? String(parsed) : null;
}

/** Chunk an arbitrary list into Apollo's 10-per-call limit. */
export function chunk<T>(items: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Waterfall polling                                                   */
/* ------------------------------------------------------------------ */

export type WebhookResult = {
  request_id?: string;
  webhook_status?: "success" | "in_progress" | "failed" | string;
  request_type?: string;
  failure_reason?: string | null;
  webhook_result?: unknown;
};

export async function pollWebhookResult(requestId: string): Promise<WebhookResult> {
  return request<WebhookResult>(`/webhook_result/${encodeURIComponent(requestId)}`, {
    method: "GET",
  });
}

/**
 * Poll until the waterfall result is available.
 *
 * Important: `webhook_status` describes DELIVERY of the callback, not the
 * enrichment. Because this app runs on localhost it deliberately supplies an
 * unreachable webhook_url, so delivery always reports "failed" — while
 * `webhook_result` still contains the complete, successful enrichment. So the
 * exit condition is the presence of `webhook_result`, never the status field.
 */
export async function waitForWaterfall(
  requestId: string,
  { timeoutMs = 90_000, intervalMs = 3_000 } = {},
): Promise<WebhookResult> {
  const deadline = Date.now() + timeoutMs;
  let last: WebhookResult = {};

  while (Date.now() < deadline) {
    last = await pollWebhookResult(requestId);
    if (last.webhook_result) return last;
    // Only a genuine terminal failure with no payload should stop us early.
    if (last.webhook_status === "failed" && last.failure_reason && !last.webhook_result) {
      // Delivery failures are expected and harmless; keep waiting for the payload.
      if (!/webhook error/i.test(last.failure_reason)) return last;
    }
    await sleep(intervalMs);
  }

  return { ...last, failure_reason: "timed out while polling for waterfall results" };
}

/** A person's emails as returned inside a waterfall payload. */
export type WaterfallPerson = {
  id?: string;
  emails?: Array<{
    email?: string;
    email_status_cd?: string;
    position?: number;
  }>;
};

/**
 * Pull the people out of a waterfall payload.
 * Shape: webhook_result.people[].emails[] — quite different from bulk_match.
 */
export function extractWaterfallPeople(result: WebhookResult): WaterfallPerson[] {
  const payload = result.webhook_result;
  if (!payload || typeof payload !== "object") return [];
  const people = (payload as Record<string, unknown>).people;
  return Array.isArray(people) ? (people as WaterfallPerson[]) : [];
}

/** Credits the waterfall actually consumed, as reported by Apollo. */
export function extractWaterfallCredits(result: WebhookResult): number | null {
  const payload = result.webhook_result;
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).credits_consumed;
  return typeof value === "number" ? value : null;
}

/* ------------------------------------------------------------------ */
/* Credit usage                                                        */
/* ------------------------------------------------------------------ */

type CreditBucket = { limit?: number; consumed?: number; left_over?: number };

export type CreditSnapshot = {
  /** Lead credits left — what email reveals draw from. The headline number. */
  leadCreditsLeft: number | null;
  leadCreditsConsumed: number | null;
  leadCreditLimit: number | null;
  exportCreditsLeft: number | null;
  directDialCreditsLeft: number | null;
};

/**
 * Credit snapshot.
 *
 * Note this is a **POST** to `/usage_stats/credit_usage_stats`. The documented
 * `GET /usage_stats/api_usage_stats` returns an empty body on this plan, and
 * the GET form of this path 404s. Verified live: `lead_credit.limit` came back
 * as 6570, matching the figure recorded in context.md.
 */
export async function getCreditUsage(): Promise<CreditSnapshot | null> {
  try {
    const data = await request<{
      credit_usage_stats?: {
        lead_credit?: CreditBucket;
        export_credit?: CreditBucket;
        direct_dial_credit?: CreditBucket;
      };
    }>("/usage_stats/credit_usage_stats", { method: "POST", body: {} });

    const stats = data.credit_usage_stats;
    if (!stats) return null;

    return {
      leadCreditsLeft: stats.lead_credit?.left_over ?? null,
      leadCreditsConsumed: stats.lead_credit?.consumed ?? null,
      leadCreditLimit: stats.lead_credit?.limit ?? null,
      exportCreditsLeft: stats.export_credit?.left_over ?? null,
      directDialCreditsLeft: stats.direct_dial_credit?.left_over ?? null,
    };
  } catch {
    // A missing snapshot must never block a sourcing run.
    return null;
  }
}

/** Lead credits remaining, or null if the snapshot is unavailable. */
export async function getCreditsRemaining(): Promise<number | null> {
  const snapshot = await getCreditUsage();
  return snapshot?.leadCreditsLeft ?? null;
}

/* ------------------------------------------------------------------ */
/* Labels (Apollo's team-shared "Lists") — 0 credits                   */
/* ------------------------------------------------------------------ */

type RawLabel = {
  id?: string;
  name?: string;
  modality?: string;
  cached_count?: number;
};

export type ApolloLabel = {
  id: string;
  name: string;
  modality: "contacts" | "accounts";
  count: number;
  /** Canonical deep link into the Apollo web app, per Apollo's own docs. */
  appUrl: string;
};

function toLabel(raw: RawLabel): ApolloLabel {
  const id = raw.id ?? "";
  return {
    id,
    name: raw.name ?? "",
    modality: raw.modality === "accounts" ? "accounts" : "contacts",
    count: raw.cached_count ?? 0,
    appUrl: id ? `https://app.apollo.io/#/lists/${id}` : "",
  };
}

/** Every list ("label") visible to the team, contacts and accounts alike. Free. */
export async function listLabels(): Promise<ApolloLabel[]> {
  const data = await request<RawLabel[]>("/labels", { method: "GET" });
  return Array.isArray(data) ? data.map(toLabel) : [];
}

export type LabelContactInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  title?: string | null;
  organizationName: string;
  linkedinUrl?: string | null;
};

/**
 * Create-or-dedupe up to 100 contacts in Apollo's team CRM and tag them with
 * one or more lists, in the same call, via `append_label_names`.
 *
 * This is the only way to label a person. Apollo's label endpoints
 * (`/labels/add_entity_ids_to_label_names`) take `entity_ids` that must
 * already be Contact/Account records saved to the team — never the
 * `apolloPersonId` this app already carries from `mixed_people/api_search` or
 * `people/bulk_match`, which lives in Apollo's separate prospect database.
 * Verified against Apollo's own API docs (2026-08-15): "Search for Contacts"
 * explicitly "only returns contacts in the search results... To search for
 * people in the Apollo database, call the People API Search endpoint" —
 * confirming Contacts and searched People are different record types.
 * `/contacts/bulk_create` is what bridges the two: it saves a Contact (or, with
 * `run_dedupe: true`, finds the existing one by email/name+company) and can
 * apply labels in the same request, so no separate add-to-label call is
 * needed for the common path.
 *
 * FREE — labeling costs 0 credits per Apollo's docs, unlike enrichOrganization
 * and bulkMatch above. Still gated behind an explicit user action rather than
 * running automatically: it writes into the team's shared Apollo CRM, visible
 * to everyone on the account, same reasoning as "Push to Sheet".
 */
export async function tagContactsInApollo(
  contacts: LabelContactInput[],
  labelNames: string[],
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const batch of chunk(contacts, 100)) {
    const body = {
      contacts: batch.map((c) => ({
        first_name: c.firstName,
        last_name: c.lastName,
        email: c.email || undefined,
        title: c.title || undefined,
        organization_name: c.organizationName,
        linkedin_url: c.linkedinUrl || undefined,
      })),
      append_label_names: labelNames,
      run_dedupe: true,
    };

    const data = await request<{
      created_contacts?: unknown[];
      existing_contacts?: unknown[];
    }>("/contacts/bulk_create", { method: "POST", body });

    created += data.created_contacts?.length ?? 0;
    existing += data.existing_contacts?.length ?? 0;
  }

  return { created, existing };
}
