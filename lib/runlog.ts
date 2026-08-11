/**
 * Generates a ready-to-paste markdown row for the "Sourcing Runs Delivered So
 * Far" table in `Apollo Lead Generation/context.md`, so the log stays current
 * without anyone hand-writing it.
 */

import type { RunSummary } from "./types";

export function buildRunLog(summary: RunSummary): string {
  const date = new Date().toISOString().slice(0, 10);

  const parts: string[] = [];
  parts.push(
    `${summary.rawSearchResults} raw prospects, ${summary.passedFilter} passed relevance filtering, ${summary.submittedForEnrichment} submitted for enrichment.`,
  );
  if (summary.waterfallAttempted > 0) {
    parts.push(
      `Waterfall attempted on ${summary.waterfallAttempted}, recovered ${summary.waterfallRecovered}.`,
    );
  }
  if (summary.creditsUsed != null) {
    parts.push(
      `Credits: ${summary.creditsBefore} before -> ${summary.creditsAfter} after (${summary.creditsUsed} used).`,
    );
  }
  if (summary.issues.length) parts.push(summary.issues.join(" "));

  return `| ${summary.company} | ${date} | ${summary.successful} | ${parts.join(" ")} |`;
}
