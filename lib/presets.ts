/**
 * Saved filter presets, so a persona worked out once can be reused.
 * Stored beside settings in data/, gitignored — local to each user.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PersonaFilters } from "./persona";

const DATA_DIR = path.join(process.cwd(), "data");
const PRESETS_FILE = path.join(DATA_DIR, "presets.json");

export type Preset = {
  id: string;
  name: string;
  description: string;
  filters: PersonaFilters;
  createdAt: string;
};

export async function listPresets(): Promise<Preset[]> {
  try {
    const text = await fs.readFile(PRESETS_FILE, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Preset[]) : [];
  } catch {
    return [];
  }
}

export async function savePreset(
  name: string,
  description: string,
  filters: PersonaFilters,
): Promise<Preset[]> {
  const presets = await listPresets();
  const trimmed = name.trim() || "Untitled persona";

  const preset: Preset = {
    id: `p_${Date.now().toString(36)}`,
    name: trimmed,
    description,
    filters,
    createdAt: new Date().toISOString(),
  };

  // Saving under an existing name replaces it rather than accumulating duplicates.
  const next = [preset, ...presets.filter((p) => p.name !== trimmed)];

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PRESETS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function deletePreset(id: string): Promise<Preset[]> {
  const next = (await listPresets()).filter((p) => p.id !== id);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PRESETS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
