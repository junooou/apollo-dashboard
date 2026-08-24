/**
 * Which geographic regions' keywords are active for the Google News source
 * of News Triggers (lib/google-news-triggers.ts). Each keyword in
 * data/news-trigger-keywords.json is tagged with the region(s) it applies
 * to; toggling a region here adds or removes exactly those keywords from
 * the next refresh — "Global"-tagged keywords (horizontal AI/CX terms with
 * no geographic bias) always run regardless of this selection.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export const NEWS_TRIGGER_REGIONS = ["Singapore", "Asia", "Europe", "Americas"] as const;
export type NewsTriggerRegion = (typeof NEWS_TRIGGER_REGIONS)[number];

const FILTERS_FILE = path.join(process.cwd(), "data", "news-trigger-filters.json");

/** Matches Voncierge's actual ICP geography (criteria.default.json's
 *  personLocations is Singapore-only) — Europe/Americas are opt-in for
 *  broader market scanning, not part of the default sourcing footprint. */
const DEFAULT_ACTIVE_REGIONS: NewsTriggerRegion[] = ["Singapore", "Asia"];

function isRegion(value: unknown): value is NewsTriggerRegion {
  return typeof value === "string" && (NEWS_TRIGGER_REGIONS as readonly string[]).includes(value);
}

export async function loadActiveNewsTriggerRegions(): Promise<NewsTriggerRegion[]> {
  try {
    const raw = await fs.readFile(FILTERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.activeRegions)) {
      const valid = parsed.activeRegions.filter(isRegion);
      if (valid.length > 0) return valid;
    }
  } catch {
    /* file missing or invalid — fall through to defaults */
  }
  return DEFAULT_ACTIVE_REGIONS;
}

export async function saveActiveNewsTriggerRegions(
  regions: unknown[],
): Promise<NewsTriggerRegion[]> {
  const deduped = Array.from(new Set(regions.filter(isRegion)));
  const toSave = deduped.length > 0 ? deduped : DEFAULT_ACTIVE_REGIONS;

  await fs.mkdir(path.dirname(FILTERS_FILE), { recursive: true });
  await fs.writeFile(FILTERS_FILE, JSON.stringify({ activeRegions: toSave }, null, 2), "utf8");
  return toSave;
}
