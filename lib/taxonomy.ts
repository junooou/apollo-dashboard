/**
 * Pick-lists for the UI: regions, departments, seniorities.
 *
 * Verified against the live API (2026-08-05):
 *   person_titles       — works
 *   person_seniorities  — works
 *   person_locations    — works, and accepts REGION names ("Asia"), not just countries
 *   person_departments  — SILENTLY IGNORED. Sending it returns exactly the same
 *                         count as sending a nonsense parameter, so departments
 *                         are matched locally against the job title instead.
 */

/* ------------------------------------------------------------------ */
/* Locations                                                           */
/* ------------------------------------------------------------------ */

export type Region = { label: string; countries: string[] };

/**
 * Regions expand to explicit country lists rather than relying on Apollo's own
 * region handling, which is inconsistent — an explicit list is predictable.
 * Ordered with Voncierge's actual markets first.
 */
export const REGIONS: Region[] = [
  {
    label: "Singapore only",
    countries: ["Singapore"],
  },
  {
    label: "Southeast Asia",
    countries: [
      "Singapore",
      "Malaysia",
      "Thailand",
      "Indonesia",
      "Vietnam",
      "Philippines",
    ],
  },
  {
    label: "APAC",
    countries: [
      "Singapore",
      "Malaysia",
      "Thailand",
      "Indonesia",
      "Vietnam",
      "Philippines",
      "Hong Kong",
      "China",
      "Taiwan",
      "Japan",
      "South Korea",
      "India",
      "Australia",
      "New Zealand",
    ],
  },
  {
    label: "Greater China",
    countries: ["China", "Hong Kong", "Taiwan"],
  },
  {
    label: "Middle East",
    countries: ["United Arab Emirates", "Saudi Arabia", "Qatar", "Bahrain"],
  },
  {
    label: "Europe",
    countries: [
      "United Kingdom",
      "France",
      "Germany",
      "Spain",
      "Italy",
      "Netherlands",
      "Switzerland",
    ],
  },
  {
    label: "North America",
    countries: ["United States", "Canada"],
  },
  {
    label: "Worldwide (no filter)",
    countries: [],
  },
];

/** Individual countries offered in the picker, for finer control than a region. */
export const COUNTRIES: string[] = [
  "Singapore",
  "Malaysia",
  "Thailand",
  "Indonesia",
  "Vietnam",
  "Philippines",
  "Hong Kong",
  "China",
  "Taiwan",
  "Japan",
  "South Korea",
  "India",
  "Australia",
  "New Zealand",
  "United Arab Emirates",
  "Saudi Arabia",
  "United Kingdom",
  "France",
  "Germany",
  "Spain",
  "Italy",
  "Netherlands",
  "Switzerland",
  "United States",
  "Canada",
];

/* ------------------------------------------------------------------ */
/* Departments                                                         */
/* ------------------------------------------------------------------ */

export type Department = {
  id: string;
  label: string;
  /** Title keywords that place someone in this department. */
  keywords: string[];
  /** Recommended for Voncierge's target audience — pre-selected by default. */
  recommended: boolean;
};

/**
 * Department groupings derived from the priority-role list in
 * `Apollo Lead Generation/context.md`.
 *
 * These serve double duty: the selected departments' keywords are sent to
 * Apollo as `person_titles` (narrowing the search), and are also matched
 * locally against returned titles (since person_departments doesn't work).
 */
export const DEPARTMENTS: Department[] = [
  {
    id: "customer_experience",
    label: "Customer Experience",
    recommended: true,
    keywords: [
      "customer experience",
      "customer journey",
      "guest experience",
      "customer engagement",
      "client experience",
      "cx",
    ],
  },
  {
    id: "customer_service",
    label: "Customer Service / Contact Centre",
    recommended: true,
    keywords: [
      "customer service",
      "contact centre",
      "contact center",
      "call centre",
      "call center",
      "customer relations",
      "service excellence",
      "customer care",
    ],
  },
  {
    id: "digital_transformation",
    label: "Digital Transformation",
    recommended: true,
    keywords: [
      "digital transformation",
      "digital channel",
      "digital banking",
      "service transformation",
      "chief digital",
      "head of digital",
      "digital experience",
    ],
  },
  {
    id: "ai_innovation",
    label: "AI & Innovation",
    recommended: true,
    keywords: [
      "ai transformation",
      "ai platform",
      "artificial intelligence",
      "innovation",
      "emerging technology",
    ],
  },
  {
    id: "design_ux",
    label: "Design / UX",
    recommended: true,
    keywords: [
      "experience design",
      "user experience",
      "ux",
      "service design",
      "design lead",
      "product design",
    ],
  },
  {
    id: "loyalty_crm",
    label: "Loyalty & CRM",
    recommended: true,
    keywords: ["loyalty", "crm", "membership", "rewards", "customer data"],
  },
  {
    id: "operations",
    label: "Operations Excellence",
    recommended: true,
    keywords: [
      "operations excellence",
      "operational excellence",
      "process improvement",
      "business transformation",
    ],
  },
  {
    id: "consumer_retail_banking",
    label: "Consumer / Retail Banking",
    recommended: true,
    keywords: [
      "consumer banking",
      "retail banking",
      "personal banking",
      "consumer bank",
    ],
  },
  {
    id: "technology_leadership",
    label: "Technology Leadership",
    recommended: false,
    keywords: [
      "chief technology",
      "chief information",
      "head of technology",
      "cto",
      "technology officer",
    ],
  },
  {
    id: "product",
    label: "Product Management",
    recommended: false,
    keywords: ["product manager", "product management", "head of product", "product owner"],
  },
  {
    id: "marketing",
    label: "Marketing",
    recommended: false,
    keywords: ["marketing", "brand", "campaign"],
  },
  {
    id: "data_analytics",
    label: "Data & Analytics",
    recommended: false,
    keywords: ["data science", "analytics", "business intelligence", "insights"],
  },
];

export function departmentById(id: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}

/** All title keywords for a set of department ids — fed to Apollo as person_titles. */
export function keywordsForDepartments(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    for (const kw of departmentById(id)?.keywords ?? []) out.add(kw);
  }
  return [...out];
}

/** Region lookup by label. */
export function countriesForRegion(label: string): string[] | null {
  return REGIONS.find((r) => r.label === label)?.countries ?? null;
}

/* ------------------------------------------------------------------ */
/* Seniority                                                           */
/* ------------------------------------------------------------------ */

/** Values Apollo's person_seniorities filter accepts. */
export const SENIORITIES: Array<{ value: string; label: string }> = [
  { value: "c_suite", label: "C-Suite" },
  { value: "owner", label: "Owner" },
  { value: "partner", label: "Partner" },
  { value: "vp", label: "VP" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "senior", label: "Senior" },
  { value: "entry", label: "Entry" },
  { value: "intern", label: "Intern" },
];
