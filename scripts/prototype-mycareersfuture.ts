/**
 * PROTOTYPE — not wired into the app. Proves out MyCareersFuture's public
 * job-postings API (api.mycareersfuture.gov.sg/v2/jobs) as a hiring-signal
 * source before committing to a real lib/api-route/UI build, the same way
 * the News Triggers feature started.
 *
 * No API key, no auth — it's Singapore's official government job portal,
 * genuinely public. Reuses the same department keyword lists already used
 * for Apollo person search (lib/taxonomy.ts) rather than inventing a new
 * keyword set, on the theory that "who we'd search Apollo for" and "which
 * hiring signals matter" should be the same taxonomy.
 *
 * Run: npx tsx scripts/prototype-mycareersfuture.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DEPARTMENTS } from "../lib/taxonomy";

const API_BASE = "https://api.mycareersfuture.gov.sg/v2";
const RESULTS_PER_QUERY = 20;

// One sharp keyword per recommended department, not the full list — MCF's
// `search` looked AND-ish in manual testing (multi-term queries returned far
// fewer results than any single term), so broad OR-style coverage means many
// separate single-term queries, not one combined one.
const SIGNAL_QUERIES = DEPARTMENTS.filter((d) => d.recommended).map((d) => ({
  department: d.label,
  keyword: d.keywords[0],
}));

type McfJob = {
  uuid: string;
  title: string;
  postedCompany: { uen: string; name: string; employeeCount: number | null };
  metadata: { newPostingDate: string; jobDetailsUrl: string };
  positionLevels: { position: string }[];
};

type McfResponse = { results: McfJob[]; total: number };

async function searchJobs(query: string, limit = RESULTS_PER_QUERY): Promise<McfJob[]> {
  const url = `${API_BASE}/jobs?limit=${limit}&search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyCareersFuture ${res.status} for query "${query}"`);
  const data = (await res.json()) as McfResponse;
  return data.results;
}

/** Loose match, same idea as lib/sheets.ts's companyNamesMatch — absorbs
 *  "DBS" vs "DBS BANK LTD." style drift between our CSVs and MCF's names. */
function looseCompanyMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/\s+(pte\.?\s*ltd\.?|ltd\.?|inc\.?)$/i, "").trim();
  const y = b.trim().toLowerCase().replace(/\s+(pte\.?\s*ltd\.?|ltd\.?|inc\.?)$/i, "").trim();
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y));
}

function loadTargetCompanyNames(): string[] {
  const dir = path.join(process.cwd(), "..", "Apollo Lead Generation");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".csv"))
      .map((f) => f.replace(/\.csv$/, ""));
  } catch {
    return [];
  }
}

async function main() {
  console.log("MyCareersFuture prototype — CX/digital hiring signals, Singapore\n");

  const byCompany = new Map<
    string,
    { name: string; uen: string; employeeCount: number | null; jobs: { title: string; department: string; url: string; posted: string }[] }
  >();

  for (const { department, keyword } of SIGNAL_QUERIES) {
    process.stdout.write(`  querying "${keyword}" (${department})... `);
    let jobs: McfJob[] = [];
    try {
      jobs = await searchJobs(keyword);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    console.log(`${jobs.length} results`);

    for (const job of jobs) {
      const uen = job.postedCompany.uen;
      if (!byCompany.has(uen)) {
        byCompany.set(uen, {
          name: job.postedCompany.name,
          uen,
          employeeCount: job.postedCompany.employeeCount,
          jobs: [],
        });
      }
      byCompany.get(uen)!.jobs.push({
        title: job.title,
        department,
        url: job.metadata.jobDetailsUrl,
        posted: job.metadata.newPostingDate,
      });
    }
  }

  console.log(`\n${byCompany.size} distinct companies found hiring for these roles right now.\n`);

  // Cross-reference against companies already in the sourcing pipeline —
  // this is the actual signal: a company we already have contacts for is
  // ALSO actively hiring for CX/digital roles, right now.
  const targets = loadTargetCompanyNames();
  console.log(`Cross-referencing against ${targets.length} companies already in Apollo Lead Generation/:`);
  console.log(`  (${targets.join(", ")})\n`);

  let matchCount = 0;
  for (const target of targets) {
    const matches = [...byCompany.values()].filter((c) => looseCompanyMatch(c.name, target));
    if (matches.length === 0) continue;
    matchCount++;
    for (const m of matches) {
      console.log(`✓ ${target} → "${m.name}" (UEN ${m.uen}, ~${m.employeeCount ?? "?"} employees)`);
      for (const j of m.jobs) {
        console.log(`    - [${j.department}] ${j.title} (posted ${j.posted})`);
        console.log(`      ${j.url}`);
      }
    }
  }
  if (matchCount === 0) {
    console.log("  No overlap this run — expected for non-Singapore targets (MyCareersFuture is SG-only),");
    console.log("  and hiring signals are inherently time-sensitive; re-run periodically to see hits.");
  }

  console.log(`\n--- Top 10 companies by number of matching open roles (any company, not just targets) ---`);
  const ranked = [...byCompany.values()].sort((a, b) => b.jobs.length - a.jobs.length).slice(0, 10);
  for (const c of ranked) {
    console.log(`  ${c.jobs.length.toString().padStart(2)}  ${c.name}  (UEN ${c.uen})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
