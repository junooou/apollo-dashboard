/**
 * CSV read/write pinned to the schema every shipped file in
 * `Apollo Lead Generation/` already uses:
 *
 *   firstname,lastname,title,company,seniority,email,email_status,linkedin_url,location,apollo_person_id
 *
 * context.md line 21 also mentions a `phone` column, but no shipped CSV has one,
 * so phone is opt-in via settings and appended at the end when enabled.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { CSV_COLUMNS, type EnrichedContact } from "./types";

function escapeCell(value: string): string {
  const v = value ?? "";
  // Quote when the value contains a comma, quote, or newline — matches how the
  // existing files quote the `location` column.
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** Columns the shipped CSVs quote unconditionally, regardless of content. */
const ALWAYS_QUOTED = new Set(["location"]);

/**
 * Shared row shape behind both `buildCsv` and the Google Sheets push — one
 * column order, used everywhere a contact becomes tabular data.
 */
export function contactsToRows(
  contacts: EnrichedContact[],
  opts: { includePhone?: boolean } = {},
): { columns: string[]; rows: string[][] } {
  const columns = opts.includePhone ? [...CSV_COLUMNS, "phone"] : [...CSV_COLUMNS];

  const rows = contacts.map((c) => {
    const record: Record<string, string> = {
      firstname: c.firstname,
      lastname: c.lastname,
      title: c.title,
      company: c.company,
      seniority: c.seniority,
      email: c.email,
      email_status: c.email_status,
      linkedin_url: c.linkedin_url,
      location: c.location,
      apollo_person_id: c.apolloPersonId,
      phone: "",
    };
    return columns.map((col) => record[col] ?? "");
  });

  return { columns, rows };
}

/**
 * Same 10-column contact row plus three columns specific to the "Job
 * Signals Outreach" Google Sheet (lib/sheets.ts): which job listing
 * surfaced this contact, and which persona rule picked them (see
 * lib/job-signal-persona.ts). Extends `contactsToRows`'s output rather than
 * modifying it, so the fixed 10-column CSV schema in `Apollo Lead
 * Generation/` is untouched — same precedent as `ensureLinkedinTrackingColumns`
 * only ever extending a sheet's own header.
 */
export function jobSignalContactsToRows(
  contacts: EnrichedContact[],
  meta: { jobTitle: string; jobUrl: string; outreachPersona: string },
): { columns: string[]; rows: string[][] } {
  const { columns, rows } = contactsToRows(contacts);
  return {
    columns: [...columns, "job_title", "job_url", "outreach_persona"],
    rows: rows.map((row) => [...row, meta.jobTitle, meta.jobUrl, meta.outreachPersona]),
  };
}

export function buildCsv(
  contacts: EnrichedContact[],
  opts: { includePhone?: boolean } = {},
): string {
  const { columns, rows } = contactsToRows(contacts, opts);

  const header = columns.join(",");
  const lines = rows.map((row) =>
    row
      .map((value, i) => {
        const col = columns[i];
        if (ALWAYS_QUOTED.has(col)) return `"${value.replace(/"/g, '""')}"`;
        return escapeCell(value);
      })
      .join(","),
  );

  return [header, ...lines].join("\n") + "\n";
}

/**
 * Filename convention from context.md: the company name, capitalised naturally,
 * no slug and no suffix — e.g. `DBS.csv`, `Siam Piwat.csv`.
 */
export function csvFilename(company: string, override?: string): string {
  const base = (override?.trim() || company.trim()).replace(/\.csv$/i, "");
  // Strip characters that are illegal in filenames, keep spaces and hyphens.
  const safe = base.replace(/[/\\:*?"<>|]/g, "").trim();
  return `${safe || "contacts"}.csv`;
}

export function outputDir(): string {
  if (process.env.OUTPUT_DIR) return process.env.OUTPUT_DIR;
  // Default to the sibling folder holding the existing CSVs.
  return path.resolve(process.cwd(), "..", "Apollo Lead Generation");
}

export async function saveCsvToDisk(
  filename: string,
  content: string,
): Promise<string> {
  const dir = outputDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, filename);
  await fs.writeFile(target, content, "utf8");
  return target;
}

/* ------------------------------------------------------------------ */
/* Dedupe against already-shipped CSVs                                 */
/* ------------------------------------------------------------------ */

/** Minimal CSV line splitter that respects quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Index every apollo_person_id already present in the output folder, mapped to
 * the file it came from. Lets the UI flag "already sourced in DBS.csv" so you
 * never pay to enrich the same person twice.
 */
export async function indexExistingContacts(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const dir = outputDir();

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return index; // Folder missing is fine — nothing to dedupe against.
  }

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".csv")) continue;
    try {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;

      const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const idCol = header.indexOf("apollo_person_id");
      if (idCol < 0) continue;

      for (const line of lines.slice(1)) {
        const id = splitCsvLine(line)[idCol]?.trim();
        if (id && !index.has(id)) index.set(id, file);
      }
    } catch {
      continue; // Skip unreadable files rather than failing the whole run.
    }
  }

  return index;
}
