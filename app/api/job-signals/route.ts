import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { fetchJobSignalCandidates, type JobSignalListing } from "@/lib/mycareersfuture";
import {
  evaluateJobSignalRelevance,
  scoreJobSignal,
  type ScoredJobSignal,
} from "@/lib/job-signal-scoring";
import { outputDir } from "@/lib/csv";
import { warmSheetsIndex } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_PATH = path.join(process.cwd(), "data", "job-signals-history.json");

type JobSignalHistoryEntry = {
  listing: JobSignalListing;
  score: ScoredJobSignal;
  firstSeenAt: string;
  lastSeenAt: string;
};

type JobSignalHistory = {
  lastRefreshAt: string | null;
  entries: JobSignalHistoryEntry[];
};

export type JobSignalResult = JobSignalListing & {
  score: ScoredJobSignal;
  firstSeenAt: string;
  isNew: boolean;
};

function emptyHistory(): JobSignalHistory {
  return { lastRefreshAt: null, entries: [] };
}

async function readHistory(): Promise<JobSignalHistory> {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return emptyHistory();
    return parsed as JobSignalHistory;
  } catch {
    return emptyHistory();
  }
}

async function writeHistory(history: JobSignalHistory): Promise<void> {
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf8");
}

/** Target company names already in the sourcing pipeline — same folder
 *  lib/csv.ts's indexExistingContacts reads, just listing filenames instead
 *  of parsing CSV rows. */
async function loadTargetCompanyNames(): Promise<string[]> {
  const dir = outputDir();
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.toLowerCase().endsWith(".csv")).map((f) => f.replace(/\.csv$/i, ""));
  } catch {
    return [];
  }
}

/**
 * Every company name collated across the "Voncierge Outreach" Google Sheets
 * — what `isNewLead` checks against, distinct from `loadTargetCompanyNames`'s
 * local CSV folder. Deliberately lets a genuine warm-up failure (bad
 * credentials, unreachable folder) THROW rather than silently returning an
 * empty list: an empty list would make every single company look like a
 * "new lead", which is worse than surfacing the error and blocking the
 * refresh — the whole point of this feature is that the flag is only
 * trustworthy once Sheets has actually loaded.
 *
 * Returns `null` (not an error) when Sheets export isn't configured at all
 * (no GOOGLE_PARENT_FOLDER_ID) — that's an intentionally-off feature, not a
 * failure, and callers use `null` to mean "unknown" rather than "confirmed
 * new".
 *
 * In practice this reuses the SAME in-memory cache app/page.tsx's mount-time
 * call to /api/sheets-index already warms (see lib/sheets.ts) — it doesn't
 * trigger a second scan once that's landed.
 */
async function loadSheetsCompanyNames(): Promise<string[] | null> {
  const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
  if (!folderId) return null;

  const index = await warmSheetsIndex(folderId);
  return [...new Set(index.contacts.map((c) => c.company).filter(Boolean))];
}

export type JobSignalOverviewRow = { label: string; count: number };

export type JobSignalOverview = {
  /** Top departments/roles by listing count — "what companies are hiring
   *  for", not just "what scored highest". */
  roleBreakdown: JobSignalOverviewRow[];
  /** Companies posting the most CX-relevant listings this refresh. */
  topCompanies: JobSignalOverviewRow[];
  /** Count of listings matching a frontline/operational CX title (concierge,
   *  guest relations, front desk, ...) — see lib/job-signal-scoring.ts's
   *  isFrontlineSignal. */
  frontlineSignals: number;
  /** Listings posted within the last 7 days. */
  postedThisWeek: number;
};

/** Ranks `label` occurrences by frequency, most common first. */
function topCounts(labels: string[], limit: number): JobSignalOverviewRow[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function isPostedThisWeek(postedDate: string): boolean {
  if (!postedDate) return false;
  const posted = new Date(postedDate).getTime();
  if (Number.isNaN(posted)) return false;
  return (Date.now() - posted) / (1000 * 60 * 60 * 24) <= 7;
}

/**
 * "After job listings have been gathered, I want a brief overview of what
 * roles companies are hiring" — built from EVERY listing that survived the
 * relevance filter (opportunities + watching), not just the ones that
 * crossed the 70-point threshold, since a below-threshold role can still be
 * useful context for "what's out there right now".
 */
function buildOverview(results: JobSignalResult[]): JobSignalOverview {
  return {
    roleBreakdown: topCounts(results.map((r) => r.department), 8),
    topCompanies: topCounts(results.map((r) => r.company.name), 6),
    frontlineSignals: results.filter((r) => r.score.isFrontlineSignal).length,
    postedThisWeek: results.filter((r) => isPostedThisWeek(r.postedDate)).length,
  };
}

function buildResponse(history: JobSignalHistory, sheetsConfigured: boolean) {
  const latestRefreshAt = history.lastRefreshAt;

  const results: JobSignalResult[] = history.entries.map((entry) => ({
    ...entry.listing,
    score: entry.score,
    firstSeenAt: entry.firstSeenAt,
    isNew: Boolean(latestRefreshAt) && entry.firstSeenAt === latestRefreshAt,
  }));

  const opportunities = results
    .filter((r) => r.score.relevanceScore >= 70)
    .sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return b.score.relevanceScore - a.score.relevanceScore;
    });

  const watching = results
    .filter((r) => r.score.relevanceScore < 70)
    .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());

  const newListings = results.filter((r) => r.isNew);

  return {
    opportunities,
    watching,
    overview: buildOverview(results),
    counts: {
      totalListings: results.length,
      opportunities: opportunities.length,
      watching: watching.length,
      newListings: newListings.length,
      targetCompanyHits: results.filter((r) => r.score.isTargetCompany).length,
      // Companies not collated anywhere across the Voncierge Outreach Google
      // Sheets — see isNewLead. Only meaningful once Sheets export is
      // configured, hence the separate sheetsConfigured flag below.
      newLeads: results.filter((r) => r.score.isNewLead === true).length,
    },
    cache: { lastRefreshAt: history.lastRefreshAt },
    sheetsConfigured,
  };
}

/**
 * Always fetches live from MyCareersFuture — no manual-refresh gate like
 * News Triggers has. That gate exists there because Currents + OpenAI cost
 * money per call; MyCareersFuture is a free, unauthenticated public API, so
 * there's no reason to make the user ask for fresh data. Every page load
 * (and every browser refresh) re-fetches and re-scores.
 */
async function refreshJobSignals(history: JobSignalHistory): Promise<JobSignalHistory> {
  const refreshAt = new Date().toISOString();

  // Sheets is loaded FIRST and awaited directly (not folded into the
  // Promise.all below) so a Sheets failure surfaces clearly rather than
  // racing ambiguously against the other loads — this feed hinges on
  // knowing which companies are already in Sheets before it can label
  // anything a "new lead".
  const sheetsCompanyNames = await loadSheetsCompanyNames();

  const [candidates, targetCompanyNames] = await Promise.all([
    fetchJobSignalCandidates(),
    loadTargetCompanyNames(),
  ]);

  const existingByUuid = new Map(history.entries.map((e) => [e.listing.uuid, e]));
  const nextEntries: JobSignalHistoryEntry[] = [];

  for (const listing of candidates) {
    // Job Signals' own short exclude list (lib/job-signal-scoring.ts) — NOT
    // the Apollo people-search exclusion rules. A listing that fails this
    // check never enters history — same hard-drop semantics as an excluded
    // Apollo candidate.
    if (!evaluateJobSignalRelevance(listing).relevant) continue;

    const score = scoreJobSignal(listing, targetCompanyNames, sheetsCompanyNames);
    const existing = existingByUuid.get(listing.uuid);

    nextEntries.push({
      listing,
      score,
      firstSeenAt: existing?.firstSeenAt ?? refreshAt,
      lastSeenAt: refreshAt,
    });
  }

  // Deliberately DROP entries not present in this fetch — unlike News
  // Triggers, which keeps every article forever (a news event stays true
  // once it happened), a job posting that's no longer returned by
  // MyCareersFuture has very likely been filled or expired. Referencing an
  // outreach angle around a role that's already closed is worse than not
  // mentioning it, so stale listings shouldn't linger in "watching" either.
  nextEntries.sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());

  return { lastRefreshAt: refreshAt, entries: nextEntries };
}

export async function GET() {
  try {
    const history = await refreshJobSignals(await readHistory());
    await writeHistory(history);
    const sheetsConfigured = Boolean(process.env.GOOGLE_PARENT_FOLDER_ID?.trim());
    return NextResponse.json(buildResponse(history, sheetsConfigured));
  } catch (err) {
    console.error("Job signal pipeline failed:", err);
    const message = err instanceof Error ? err.message : "Job signal pipeline failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
