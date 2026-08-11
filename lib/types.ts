/** Shared types for the sourcing pipeline. */

/** Canonical CSV column order — matches all 19 shipped files in `Apollo Lead Generation/`. */
export const CSV_COLUMNS = [
  "firstname",
  "lastname",
  "title",
  "company",
  "seniority",
  "email",
  "email_status",
  "linkedin_url",
  "location",
  "apollo_person_id",
] as const;

export type Organization = {
  id: string;
  name: string;
  domain: string | null;
  /** Other domains Apollo knows for this org — used by the wrong-employer guard. */
  altDomains: string[];
  employeeCount: number | null;
  linkedinUrl: string | null;
};

/** A person as returned by search, before any credits are spent. */
export type Candidate = {
  apolloPersonId: string;
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  seniority: string;
  linkedinUrl: string;
  location: string;
  /** Domains from Apollo's employment history — feeds the wrong-employer guard. */
  employmentDomains: string[];
  /**
   * Whether Apollo holds an email for this person. Known before any credits are
   * spent, so the review table can steer selection toward people who will
   * actually resolve.
   */
  hasEmail: boolean;
  hasDirectPhone: boolean;
};

export type FilterDecision = {
  /** True if the candidate survives the rules and is worth spending credits on. */
  keep: boolean;
  score: number;
  /** Human-readable rule that decided this, surfaced in the UI. */
  reason: string;
  matchedInclude: string[];
  matchedExclude: string[];
  matchedNegative: string[];
  /** Department ids this title matched — powers the post-result filter bar. */
  departments: string[];
};

export type ScoredCandidate = Candidate & {
  decision: FilterDecision;
  /** Set when this person already appears in a shipped CSV. */
  alreadySourcedIn?: string;
};

/** Why a candidate was dropped after enrichment. Drives the issues log. */
export type DropReason =
  | "no_email"
  | "personal_domain"
  | "wrong_employer"
  | "invalid_format";

export type EnrichedContact = {
  apolloPersonId: string;
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  seniority: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  location: string;
  /** Present only when the contact was dropped; absent means it made the CSV. */
  dropped?: DropReason;
  droppedDetail?: string;
  /** True when the email came from a waterfall pass rather than a standard reveal. */
  viaWaterfall?: boolean;
};

export type RunSummary = {
  company: string;
  domain: string | null;
  rawSearchResults: number;
  passedFilter: number;
  submittedForEnrichment: number;
  /** Contacts with a usable business email that made it into the CSV. */
  successful: number;
  failed: number;
  waterfallAttempted: number;
  waterfallRecovered: number;
  /** Credits the waterfall reported consuming, straight from Apollo's payload. */
  waterfallCredits: number;
  creditsBefore: number | null;
  creditsAfter: number | null;
  creditsUsed: number | null;
  issues: string[];
  droppedContacts: EnrichedContact[];
};

export type Settings = {
  waterfallEnabled: boolean;
  waterfallCap: number;
  contactTarget: number;
  filenameOverride: string;
  includePhone: boolean;
  personTitles: string[];
  personSeniorities: string[];
  personLocations: string[];
  /** Department ids from lib/taxonomy.ts. Matched locally — Apollo ignores its
   *  own person_departments parameter. Empty means "no department filter". */
  departments: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  /** Excluded only when no include keyword also matches (e.g. wealth management). */
  conditionalExcludeKeywords: string[];
  negativeSignals: string[];
  personalEmailDomains: string[];
};
