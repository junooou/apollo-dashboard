/**
 * Simple filters: turn a plain-English persona description into Apollo filter
 * criteria, with you as the courier.
 *
 * The app builds a prompt, you run it in Claude on whatever plan you already
 * have, and you paste the answer back. Nothing here calls an API — a Claude
 * Pro/Max subscription does not include API access, and Anthropic prohibits
 * using subscription credentials to authenticate third-party apps, so the
 * only legitimate way to use a subscription here is for a human to run the
 * prompt themselves.
 *
 * That means this module is pure string handling: build a prompt, parse a
 * reply, normalise the result. No credentials, no network, no cost.
 */

import { COUNTRIES, DEPARTMENTS, SENIORITIES } from "./taxonomy";

export type PersonaFilters = {
  departments: string[];
  personSeniorities: string[];
  personLocations: string[];
  personTitles: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  contactTarget: number;
  /** One sentence read-back of the request, shown to the user for confirmation. */
  interpretation: string;
  /** Why these criteria — surfaced so a wrong inference is visible, not silent. */
  rationale: string;
};

const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id);
const SENIORITY_VALUES = SENIORITIES.map((s) => s.value);

export class PersonaError extends Error {}

/* ------------------------------------------------------------------ */
/* Prompt construction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build the prompt to paste into Claude.
 *
 * The allowed values are generated from lib/taxonomy.ts rather than written
 * out by hand, so adding a department or country updates the prompt with no
 * second place to remember.
 */
export function buildPersonaPrompt(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) throw new PersonaError("Describe the persona you want to reach.");

  const departmentLines = DEPARTMENTS.map(
    (d) => `  - ${d.id}  (${d.label})`,
  ).join("\n");

  return `You are helping a B2B sales team turn a target persona into Apollo.io search filters.

They sell an AI customer-experience product, so their usual targets are customer experience, contact centre, digital transformation, and innovation leaders at consumer-facing companies. Do not assume that context if the description below says something different — follow what it actually says.

THE PERSONA
${trimmed}

RETURN
A single JSON object and nothing else — no explanation before or after, no markdown fence. Use exactly these keys:

{
  "interpretation": "One sentence restating who they want to reach, in plain English.",
  "rationale": "Two or three sentences on your choices. Name anything you inferred rather than were told.",
  "departments": [],
  "personSeniorities": [],
  "personLocations": [],
  "personTitles": [],
  "includeKeywords": [],
  "excludeKeywords": [],
  "contactTarget": 20
}

RULES
- "personTitles" is the search net sent to Apollo. Searching costs nothing, so be generous: 5–15 lowercase title fragments covering the obvious variants and synonyms. Fragments beat full titles — "customer experience" matches more than "head of customer experience".
- "includeKeywords" are lowercase title keywords that should score a candidate positively. "excludeKeywords" disqualify a candidate outright; only add exclusions the description justifies.
- "contactTarget" is how many contacts to aim for per company. Use 20 unless the description asks for a different number.
- An empty array means "no filter on this", which is often correct — an empty "personLocations" searches worldwide.

"departments" must contain only these ids:
${departmentLines}

"personSeniorities" must contain only these values:
${SENIORITY_VALUES.map((v) => `  - ${v}`).join("\n")}

"personLocations" must contain only these country names, spelled exactly:
${COUNTRIES.map((c) => `  - ${c}`).join("\n")}

Any value outside those lists will be discarded, so pick from them or leave the array empty.`;
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Pull the filter object out of whatever Claude replied with.
 *
 * Tolerant on purpose: a pasted answer often arrives wrapped in a ```json
 * fence, or with a sentence of preamble, and rejecting that would make the
 * user do cleanup the parser can do itself.
 */
export function parsePersonaResponse(raw: string): PersonaFilters {
  const text = raw.trim();
  if (!text) throw new PersonaError("Paste Claude's reply into the box first.");

  // Strip a markdown fence if present, then fall back to the outermost braces.
  let candidate = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // Direct parse failed, so there is text around the object — commentary
    // before it, after it, or both. Narrow to the outermost braces and retry.
    // Note this has to run even when the text STARTS with "{": a reply that
    // opens with the object and then adds "Let me know if…" still fails above.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    // No brace at all is a different mistake from a half-copied object, and
    // the fix differs too — so say which one it is.
    if (start < 0) {
      throw new PersonaError(
        "That doesn't look like the JSON object. Copy Claude's whole reply, including the opening { and closing }.",
      );
    }
    if (end <= start) {
      throw new PersonaError(
        "The reply starts but never closes — a truncated paste is the usual cause. Copy it again, all the way to the final }.",
      );
    }

    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new PersonaError(
        "Could not read that as JSON. Check the reply was copied whole — a truncated paste is the usual cause.",
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PersonaError("Expected a JSON object with the filter keys.");
  }

  const obj = parsed as Record<string, unknown>;

  // One recognisable key is enough to be confident this is the right object;
  // normalise() fills in whatever else is missing.
  const known = ["personTitles", "departments", "interpretation", "personSeniorities"];
  if (!known.some((k) => k in obj)) {
    throw new PersonaError(
      "That JSON has none of the expected keys. Make sure you pasted the reply to this prompt.",
    );
  }

  return normalise(obj as unknown as PersonaFilters);
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Coerce a parsed reply into safe criteria.
 *
 * Nothing constrains what comes back from a copy-paste, so this is the only
 * guard: it drops values outside the taxonomy, lowercases and deduplicates
 * free-text keywords, and supplies defaults for anything missing.
 */
export function normalise(raw: PersonaFilters): PersonaFilters {
  const clean = (list: unknown): string[] =>
    Array.isArray(list)
      ? [
          ...new Set(
            list
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim().toLowerCase())
              .filter(Boolean),
          ),
        ]
      : [];

  // Locations keep their original casing — Apollo matches country names as given.
  const cleanExact = (list: unknown, allowed: string[]): string[] =>
    Array.isArray(list)
      ? [...new Set(list.filter((v): v is string => typeof v === "string" && allowed.includes(v)))]
      : [];

  const target = Number(raw?.contactTarget);

  return {
    interpretation: String(raw?.interpretation ?? "").trim(),
    rationale: String(raw?.rationale ?? "").trim(),
    departments: cleanExact(raw?.departments, DEPARTMENT_IDS),
    personSeniorities: cleanExact(raw?.personSeniorities, SENIORITY_VALUES),
    personLocations: cleanExact(raw?.personLocations, COUNTRIES),
    personTitles: clean(raw?.personTitles),
    includeKeywords: clean(raw?.includeKeywords),
    excludeKeywords: clean(raw?.excludeKeywords),
    contactTarget: Number.isFinite(target) && target > 0 ? Math.round(target) : 20,
  };
}

/** Values that were dropped as out-of-taxonomy, so the UI can say so. */
export function findDiscarded(
  raw: PersonaFilters,
  cleaned: PersonaFilters,
): string[] {
  const notes: string[] = [];
  const diff = (before: unknown, after: string[], label: string) => {
    if (!Array.isArray(before)) return;
    const dropped = before.filter(
      (v): v is string => typeof v === "string" && !after.includes(v),
    );
    if (dropped.length) notes.push(`${label}: ${dropped.join(", ")}`);
  };

  diff(raw?.departments, cleaned.departments, "Unknown departments");
  diff(raw?.personSeniorities, cleaned.personSeniorities, "Unknown seniorities");
  diff(raw?.personLocations, cleaned.personLocations, "Unknown countries");
  return notes;
}
