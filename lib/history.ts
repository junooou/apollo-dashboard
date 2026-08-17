/**
 * Local run history — one record per completed enrichment run, appended
 * automatically by app/api/enrich/route.ts, so the team has a record of
 * what's been sourced without anyone hand-pasting a line into context.md.
 *
 * Stored the same way as data/settings.json: a flat JSON file in data/,
 * gitignored, local to whichever machine ran it. See AWS_DEPLOYMENT_NOTES.md —
 * this file-based store does not survive container restarts and cannot be
 * shared across instances once this app runs on AWS with multiple users; it
 * must move to a real datastore (RDS/DynamoDB) before that happens.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunSummary } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "runs.json");

/** Caps local file growth on a long-running install; oldest runs drop off. */
const MAX_RECORDS = 2000;

export type RunRecord = RunSummary & {
  id: string;
  ranAt: string;
  /**
   * OS username of whoever ran this, on the machine that ran it. A
   * local-only signal — meaningful when each person runs their own instance,
   * meaningless (always the service's own user) once this runs on a shared
   * AWS deployment. See AWS_DEPLOYMENT_NOTES.md: replace with a real signed-in
   * identity at that point rather than trusting this field.
   */
  ranBy: string;
};

export async function listRuns(): Promise<RunRecord[]> {
  try {
    const text = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

/** Best-effort: a history-logging failure must never fail the actual run. */
export async function appendRun(summary: RunSummary): Promise<void> {
  try {
    const record: RunRecord = {
      ...summary,
      id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ranAt: new Date().toISOString(),
      ranBy: os.userInfo().username,
    };

    const existing = await listRuns();
    const next = [record, ...existing].slice(0, MAX_RECORDS);

    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(HISTORY_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to append run history (non-fatal):", err);
  }
}
