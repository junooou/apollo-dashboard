/**
 * Maps a Job Signal listing to the outreach persona worth pitching —
 * i.e. who at the employer actually owns the "manpower-dependent, doesn't
 * scale" service gap Voncierge closes, which is very rarely the person in
 * the job posting itself (see lib/job-signal-scoring.ts's isFrontlineSignal:
 * a concierge/guest-relations hire is the SIGNAL, not the pitch contact).
 *
 * Keyed off the employer's SSIC code (MyCareersFuture's `company.ssicCode`,
 * see lib/mycareersfuture.ts) rather than the job-signal `department` label,
 * because `department` comes from lib/taxonomy.ts's banking/retail-oriented
 * CX categories (see DEPARTMENTS) and says nothing about which industry the
 * employer is actually in — a "Customer Service / Contact Centre" match
 * covers everything from a bank call centre to a hotel front desk, and the
 * right pitch contact differs completely between those two.
 *
 * SSIC prefixes below are Singapore's SSIC 2020 top-level divisions
 * (https://www.singstat.gov.sg — Singapore Standard Industrial Classification).
 * This is a best-effort mapping for Voncierge's actual target verticals, NOT
 * verified against live Apollo/MyCareersFuture data the way the rest of this
 * app's SSIC usage is (contrast RECRUITMENT_AGENCY_SSIC_CODES in
 * lib/mycareersfuture.ts, which was confirmed against five real staffing
 * firms). Extend PERSONA_RULES as new verticals show up in Job Signals.
 */

export type OutreachPersona = {
  /** Which rule matched, or "generic_cx" for the fallback. */
  id: string;
  /** Human label for the matched vertical, shown in the UI. */
  label: string;
  personTitles: string[];
  personSeniorities: string[];
  /** One sentence explaining the match, shown next to the contact list. */
  rationale: string;
};

type PersonaRule = {
  id: string;
  label: string;
  ssicPrefixes: string[];
  personTitles: string[];
};

/** Seniority band used by every rule below — the buyer for a Voncierge deal
 *  is always someone who owns budget for front-of-house service, whichever
 *  industry they're in, so this doesn't vary per vertical the way titles do. */
const DECISION_MAKER_SENIORITIES = ["owner", "c_suite", "vp", "director", "head", "manager"];

const PERSONA_RULES: PersonaRule[] = [
  {
    id: "hospitality",
    label: "Hotels & Accommodation",
    ssicPrefixes: ["55"],
    personTitles: [
      "General Manager",
      "Director of Rooms",
      "Front Office Manager",
      "Director of Guest Experience",
      "Guest Experience Manager",
      "Director of Guest Services",
      "Hotel Manager",
    ],
  },
  {
    id: "food_beverage",
    label: "Food & Beverage",
    ssicPrefixes: ["56"],
    personTitles: [
      "General Manager",
      "Operations Manager",
      "Area Manager",
      "Head of Customer Experience",
      "Guest Experience Manager",
      "Director of Operations",
    ],
  },
  {
    id: "retail_property",
    label: "Retail, Malls & Property Management",
    ssicPrefixes: ["68", "47"],
    personTitles: [
      "Centre Manager",
      "Mall Manager",
      "General Manager",
      "Head of Customer Experience",
      "Operations Manager",
      "Director of Marketing",
    ],
  },
  {
    id: "aviation_transport",
    label: "Aviation & Transport",
    ssicPrefixes: ["51", "52"],
    personTitles: [
      "Head of Passenger Experience",
      "Airport Operations Manager",
      "Head of Customer Experience",
      "Director of Customer Service",
    ],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    ssicPrefixes: ["86"],
    personTitles: [
      "Patient Experience Manager",
      "Director of Patient Services",
      "Head of Guest Relations",
      "Chief Operating Officer",
    ],
  },
];

/** Generic fallback for employers whose SSIC code isn't in PERSONA_RULES yet —
 *  the same broad CX/digital-transformation titles the rest of the app
 *  already targets (lib/taxonomy.ts's recommended departments), rather than
 *  refusing to suggest anyone. */
const GENERIC_TITLES = [
  "Head of Customer Experience",
  "Director of Customer Experience",
  "Chief Customer Officer",
  "Head of Digital Transformation",
  "VP Customer Experience",
  "Director of Operations",
];

export function getOutreachPersona(ssicCode: string | null | undefined): OutreachPersona {
  const code = (ssicCode ?? "").trim();
  const rule = PERSONA_RULES.find((r) => r.ssicPrefixes.some((prefix) => code.startsWith(prefix)));

  if (rule) {
    return {
      id: rule.id,
      label: rule.label,
      personTitles: rule.personTitles,
      personSeniorities: DECISION_MAKER_SENIORITIES,
      rationale: `Matched "${rule.label}" via SSIC ${code} — targeting the decision-maker who owns front-of-house service quality, not the frontline role in the listing itself.`,
    };
  }

  return {
    id: "generic_cx",
    label: "Generic Customer Experience",
    personTitles: GENERIC_TITLES,
    personSeniorities: DECISION_MAKER_SENIORITIES,
    rationale: code
      ? `SSIC ${code} isn't in the persona list yet — falling back to generic Customer Experience leadership titles. Extend PERSONA_RULES in lib/job-signal-persona.ts if this vertical comes up often.`
      : "No SSIC code on this listing — falling back to generic Customer Experience leadership titles.",
  };
}
