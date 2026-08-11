/** Settings load/save. Defaults come from criteria.default.json (context.md rules). */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Settings } from "./types";
import defaults from "../criteria.default.json";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

/** Strip the `_comment` / `_fieldName` documentation keys out of the JSON defaults. */
export function defaultSettings(): Settings {
  const raw = defaults as unknown as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith("_")) clean[k] = v;
  }
  return clean as unknown as Settings;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const text = await fs.readFile(SETTINGS_FILE, "utf8");
    const saved = JSON.parse(text) as Partial<Settings>;
    // Merge over defaults so a new setting added later doesn't break old files.
    return { ...defaultSettings(), ...saved };
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(next: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await loadSettings()), ...next };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export async function resetSettings(): Promise<Settings> {
  try {
    await fs.unlink(SETTINGS_FILE);
  } catch {
    /* already absent */
  }
  return defaultSettings();
}
