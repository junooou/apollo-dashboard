/**
 * Persona prompt/parse tests. Entirely offline — this module never calls an
 * API, so there is nothing to mock and nothing to pay for.
 *
 * The parser is the risky part: it consumes whatever a human pasted out of a
 * chat window, so the cases below are the real shapes a reply arrives in.
 */

import { describe, expect, it } from "vitest";
import {
  PersonaError,
  buildPersonaPrompt,
  findDiscarded,
  normalise,
  parsePersonaResponse,
  type PersonaFilters,
} from "./persona";
import { COUNTRIES, DEPARTMENTS, SENIORITIES } from "./taxonomy";

const VALID = {
  interpretation: "CX leaders at Singapore banks",
  rationale: "Inferred seniority from 'heads of'.",
  departments: ["customer_experience"],
  personSeniorities: ["director"],
  personLocations: ["Singapore"],
  personTitles: ["customer experience"],
  includeKeywords: ["cx"],
  excludeKeywords: ["audit"],
  contactTarget: 20,
};

describe("buildPersonaPrompt", () => {
  it("includes the persona description", () => {
    const p = buildPersonaPrompt("Heads of CX at banks");
    expect(p).toContain("Heads of CX at banks");
  });

  it("lists every department id, so Claude can't invent one", () => {
    const p = buildPersonaPrompt("anything");
    for (const d of DEPARTMENTS) expect(p).toContain(d.id);
  });

  it("lists every seniority value Apollo accepts", () => {
    const p = buildPersonaPrompt("anything");
    for (const s of SENIORITIES) expect(p).toContain(s.value);
  });

  it("lists every country in the picker", () => {
    const p = buildPersonaPrompt("anything");
    for (const c of COUNTRIES) expect(p).toContain(c);
  });

  it("rejects an empty description", () => {
    expect(() => buildPersonaPrompt("   ")).toThrow(PersonaError);
  });
});

describe("parsePersonaResponse — real paste shapes", () => {
  it("reads a bare JSON object", () => {
    const out = parsePersonaResponse(JSON.stringify(VALID));
    expect(out.departments).toEqual(["customer_experience"]);
  });

  it("strips a ```json fence", () => {
    const out = parsePersonaResponse("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(out.personTitles).toEqual(["customer experience"]);
  });

  it("strips a bare ``` fence", () => {
    const out = parsePersonaResponse("```\n" + JSON.stringify(VALID) + "\n```");
    expect(out.personTitles).toEqual(["customer experience"]);
  });

  it("ignores a sentence of preamble", () => {
    const out = parsePersonaResponse(
      "Here are the filters for that persona:\n\n" + JSON.stringify(VALID),
    );
    expect(out.interpretation).toBe("CX leaders at Singapore banks");
  });

  it("ignores trailing commentary", () => {
    const out = parsePersonaResponse(
      JSON.stringify(VALID) + "\n\nLet me know if you'd like me to widen it.",
    );
    expect(out.contactTarget).toBe(20);
  });

  it("handles preamble and a fence together", () => {
    const out = parsePersonaResponse(
      "Sure — here you go:\n\n```json\n" + JSON.stringify(VALID) + "\n```\n\nHope that helps.",
    );
    expect(out.departments).toEqual(["customer_experience"]);
  });

  it("tolerates surrounding whitespace", () => {
    const out = parsePersonaResponse("\n\n   " + JSON.stringify(VALID) + "   \n\n");
    expect(out.personSeniorities).toEqual(["director"]);
  });
});

describe("parsePersonaResponse — failures the user must be told about", () => {
  it("rejects an empty paste", () => {
    expect(() => parsePersonaResponse("")).toThrow(/Paste Claude's reply/);
  });

  it("rejects prose with no JSON at all", () => {
    expect(() => parsePersonaResponse("Sorry, I can't help with that.")).toThrow(
      /doesn't look like the JSON object/,
    );
  });

  it("rejects a truncated paste with a useful message", () => {
    const cut = JSON.stringify(VALID).slice(0, 60);
    expect(() => parsePersonaResponse(cut)).toThrow(/truncated paste/);
  });

  it("rejects a JSON array", () => {
    expect(() => parsePersonaResponse("[1,2,3]")).toThrow(PersonaError);
  });

  it("rejects an unrelated JSON object", () => {
    expect(() => parsePersonaResponse('{"foo":"bar"}')).toThrow(/none of the expected keys/);
  });

  it("accepts a partial object that has at least one known key", () => {
    const out = parsePersonaResponse('{"personTitles":["cx lead"]}');
    expect(out.personTitles).toEqual(["cx lead"]);
    expect(out.contactTarget).toBe(20);
    expect(out.departments).toEqual([]);
  });
});

describe("normalise", () => {
  it("lowercases and deduplicates free-text keywords", () => {
    const out = normalise({
      ...VALID,
      personTitles: ["Customer Experience", "customer experience", " CX "],
    } as PersonaFilters);
    expect(out.personTitles).toEqual(["customer experience", "cx"]);
  });

  it("drops values outside the taxonomy", () => {
    const out = normalise({
      ...VALID,
      departments: ["customer_experience", "not_real"],
      personSeniorities: ["director", "supreme_overlord"],
      personLocations: ["Singapore", "Atlantis"],
    } as PersonaFilters);
    expect(out.departments).toEqual(["customer_experience"]);
    expect(out.personSeniorities).toEqual(["director"]);
    expect(out.personLocations).toEqual(["Singapore"]);
  });

  it("preserves country casing — Apollo matches the name as given", () => {
    const out = normalise({ ...VALID, personLocations: ["United Kingdom"] } as PersonaFilters);
    expect(out.personLocations).toEqual(["United Kingdom"]);
  });

  it("defaults a missing or nonsense contact target to 20", () => {
    expect(normalise({ ...VALID, contactTarget: 0 } as PersonaFilters).contactTarget).toBe(20);
    expect(normalise({ ...VALID, contactTarget: -5 } as PersonaFilters).contactTarget).toBe(20);
  });

  it("rounds a fractional target", () => {
    expect(normalise({ ...VALID, contactTarget: 12.6 } as PersonaFilters).contactTarget).toBe(13);
  });

  it("survives arrays arriving as null or non-strings", () => {
    const out = normalise({
      ...VALID,
      departments: null,
      personTitles: ["cx", 42, null],
    } as unknown as PersonaFilters);
    expect(out.departments).toEqual([]);
    expect(out.personTitles).toEqual(["cx"]);
  });
});

describe("findDiscarded", () => {
  it("names values that were dropped, so a wrong guess is visible", () => {
    const raw = {
      ...VALID,
      departments: ["customer_experience", "made_up"],
      personLocations: ["Singapore", "Atlantis"],
    } as PersonaFilters;
    const notes = findDiscarded(raw, normalise(raw));
    expect(notes.join(" ")).toContain("made_up");
    expect(notes.join(" ")).toContain("Atlantis");
  });

  it("says nothing when everything was valid", () => {
    expect(findDiscarded(VALID as PersonaFilters, normalise(VALID as PersonaFilters))).toEqual([]);
  });
});
