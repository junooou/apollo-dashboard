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
import { loadSettings } from "@/lib/settings";

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

function buildResponse(history: JobSignalHistory) {
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
    counts: {
      totalListings: results.length,
      opportunities: opportunities.length,
      watching: watching.length,
      newListings: newListings.length,
      targetCompanyHits: results.filter((r) => r.score.isTargetCompany).length,
    },
    cache: { lastRefreshAt: history.lastRefreshAt },
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

  const [candidates, targetCompanyNames, settings] = await Promise.all([
    fetchJobSignalCandidates(),
    loadTargetCompanyNames(),
    loadSettings(),
  ]);

  const existingByUuid = new Map(history.entries.map((e) => [e.listing.uuid, e]));
  const nextEntries: JobSignalHistoryEntry[] = [];

  for (const listing of candidates) {
    // Same exclude / conditional-exclude / negative-signal rules as the
    // Apollo people search (Apollo Lead Generation/context.md), plus a
    // junior-frontline check this feed needs and the people search doesn't
    // (that pipeline is already pre-scoped to manager+ seniority). A listing
    // that fails this check never enters history — same hard-drop semantics
    // as an excluded Apollo candidate.
    if (!evaluateJobSignalRelevance(listing, settings).relevant) continue;

    const score = scoreJobSignal(listing, targetCompanyNames);
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
    return NextResponse.json(buildResponse(history));
  } catch (err) {
    console.error("Job signal pipeline failed:", err);
    const message = err instanceof Error ? err.message : "Job signal pipeline failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
