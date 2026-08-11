/**
 * Filter tests. These run entirely offline — no API calls, no credits.
 *
 * The cases are taken from real decisions recorded in
 * `Apollo Lead Generation/context.md`, especially the 2026-08-04 relevance
 * audit, so a regression here means the app has drifted from the agreed rules.
 */

import { describe, expect, it } from "vitest";
import {
  departmentsForTitle,
  emailDomain,
  emailMatchesEmployer,
  evaluateCandidate,
  filterAndRank,
  inferSeniority,
  isPersonalEmail,
} from "./filter";
import { defaultSettings } from "./settings";
import type { Candidate } from "./types";

const settings = defaultSettings();

function candidate(title: string, seniority = "director", hasEmail = true): Candidate {
  return {
    apolloPersonId: `id-${title}`,
    firstname: "Test",
    lastname: "Person",
    title,
    company: "Test Co",
    seniority,
    linkedinUrl: "",
    location: "Singapore",
    employmentDomains: [],
    hasEmail,
    hasDirectPhone: false,
  };
}

describe("evaluateCandidate — roles that must be dropped", () => {
  // Each of these was explicitly removed during the 2026-08-04 audit.
  const mustReject: Array<[string, string]> = [
    ["Group Head of API and H2H Digital Channels", "H2H is corporate treasury, not consumer"],
    ["Managing Director, Core Engine Technology", "backend infrastructure"],
    ["Chief Information Security Officer", "cybersecurity"],
    ["Head of Data Governance", "compliance function"],
    ["Managing Director, IBG Technology", "institutional banking"],
    ["Head of Global Wholesale Banking", "wholesale, not retail"],
    ["Head of SME Banking", "B2B, not consumer"],
    ["Director, Digital Tenant Solutions", "tenants are B2B retailers"],
    ["Head of Business Insights & Analytics", "generic analytics, no CX qualifier"],
    ["Head of Workforce Management", "internal staffing"],
    ["VP, Internal Audit", "audit"],
    ["Head of Cybersecurity Operations", "cybersecurity"],
    ["Senior Legal Counsel", "legal"],
    ["Head of Talent Acquisition", "HR"],
    ["Data Engineer", "engineering without customer remit"],
    ["Head of Leasing", "B2B landlord function"],
    ["Estate Manager", "frontline property management (HDB pattern)"],
  ];

  for (const [title, why] of mustReject) {
    it(`rejects "${title}" (${why})`, () => {
      const decision = evaluateCandidate(candidate(title), settings);
      expect(decision.keep, `expected drop but kept: ${decision.reason}`).toBe(false);
    });
  }
});

describe("evaluateCandidate — roles that must be kept", () => {
  const mustKeep = [
    "Group Executive & Group Head of Consumer Banking and Wealth Management",
    "Managing Director & Head of Digital Banking, Singapore",
    "Chief Digital Officer",
    "Head of Customer Experience",
    "Director, Customer Journey Design",
    "Head of Contact Centre Operations",
    "VP, Digital Transformation",
    "Head of Service Excellence",
    "Director of Guest Experience",
    "Head of Loyalty and CRM",
    "Principal UX Designer",
    "Deputy Director, AI Transformation",
  ];

  for (const title of mustKeep) {
    it(`keeps "${title}"`, () => {
      const decision = evaluateCandidate(candidate(title), settings);
      expect(decision.keep, `expected keep but dropped: ${decision.reason}`).toBe(true);
    });
  }
});

describe("negative signals are softened by a CX qualifier", () => {
  it("drops generic Business Insights", () => {
    expect(evaluateCandidate(candidate("Head of Business Insights"), settings).keep).toBe(
      false,
    );
  });

  it("keeps Customer Insights, which carries a CX qualifier", () => {
    const decision = evaluateCandidate(
      candidate("Head of Customer Experience Insights"),
      settings,
    );
    expect(decision.keep).toBe(true);
  });

  it("explains itself when it keeps a negative-signal title", () => {
    const decision = evaluateCandidate(
      candidate("Head of Customer Experience, Corporate Strategy"),
      settings,
    );
    expect(decision.keep).toBe(true);
    expect(decision.reason).toContain("kept despite");
  });
});

describe("conditional exclusions", () => {
  // context.md: "Wealth management or private banking — unless the role
  // specifically covers customer experience."
  it("drops a plain wealth management role", () => {
    expect(
      evaluateCandidate(candidate("Head of Wealth Management"), settings).keep,
    ).toBe(false);
  });

  it("keeps DBS's Group Head of Consumer Banking and Wealth Management", () => {
    // A real contact in the shipped DBS.csv — must survive the filter.
    const decision = evaluateCandidate(
      candidate(
        "Group Executive & Group Head of Consumer Banking and Wealth Management",
        "c_suite",
      ),
      settings,
    );
    expect(decision.keep).toBe(true);
  });

  it("drops project management without a CX focus", () => {
    expect(
      evaluateCandidate(candidate("Senior Project Management Lead"), settings).keep,
    ).toBe(false);
  });

  it("keeps project management with a CX focus", () => {
    expect(
      evaluateCandidate(
        candidate("Project Management Lead, Customer Experience"),
        settings,
      ).keep,
    ).toBe(true);
  });
});

describe("hard exclusions beat include keywords", () => {
  // The audit's headline case: matches "digital channels" but is B2B treasury.
  it('drops "Group Head of API and H2H Digital Channels" despite the CX keyword', () => {
    const decision = evaluateCandidate(
      candidate("Group Head of API and H2H Digital Channels", "vp"),
      settings,
    );
    expect(decision.keep).toBe(false);
    expect(decision.matchedInclude.length).toBeGreaterThan(0);
  });

  it("drops a CISO even when the title mentions customer experience", () => {
    expect(
      evaluateCandidate(
        candidate("Chief Information Security Officer & Customer Experience"),
        settings,
      ).keep,
    ).toBe(false);
  });

  it("drops institutional banking digital roles", () => {
    expect(
      evaluateCandidate(candidate("Head of Institutional Digital Channels"), settings)
        .keep,
    ).toBe(false);
  });
});

describe("plural tolerance", () => {
  it('matches "tenant solution" against "Digital Tenant Solutions"', () => {
    expect(
      evaluateCandidate(candidate("Director, Digital Tenant Solutions"), settings).keep,
    ).toBe(false);
  });
});

describe("word-boundary matching", () => {
  // Substring matching would wrongly fire on these.
  it('does not treat "luxury" as a "ux" match', () => {
    const decision = evaluateCandidate(candidate("Head of Luxury Retail"), settings);
    expect(decision.matchedInclude).not.toContain("ux");
  });

  it("still matches UX as a standalone word", () => {
    const decision = evaluateCandidate(candidate("Head of UX"), settings);
    expect(decision.matchedInclude).toContain("ux");
  });
});

describe("ranking", () => {
  it("ranks kept candidates above rejected ones", () => {
    const ranked = filterAndRank(
      [
        candidate("Chief Information Security Officer", "c_suite"),
        candidate("Head of Customer Experience", "director"),
      ],
      settings,
    );
    expect(ranked[0].decision.keep).toBe(true);
    expect(ranked[1].decision.keep).toBe(false);
  });

  it("boosts Head/MD titles, which context.md found reveal more reliably", () => {
    const head = evaluateCandidate(
      candidate("Head of Customer Experience", "vp"),
      settings,
    );
    const plain = evaluateCandidate(
      candidate("Customer Experience Lead", "vp"),
      settings,
    );
    expect(head.score).toBeGreaterThan(plain.score);
  });

  it("ranks c_suite above manager for the same title", () => {
    const exec = evaluateCandidate(candidate("Customer Experience", "c_suite"), settings);
    const mgr = evaluateCandidate(candidate("Customer Experience", "manager"), settings);
    expect(exec.score).toBeGreaterThan(mgr.score);
  });
});

describe("inferSeniority", () => {
  // api_search returns no seniority field, so ranking depends on this.
  const cases: Array<[string, string]> = [
    ["Chief Digital Officer", "c_suite"],
    ["Group Executive & Group Head of Consumer Banking", "c_suite"],
    ["Managing Director, Customer Experience", "head"],
    ["Executive Director, Digital", "head"],
    ["Head of Customer Experience", "head"],
    ["SVP, Digital Channels", "vp"],
    ["AVP, Customer Experience & Innovation", "vp"],
    ["VP, Regional Customer Experience", "vp"],
    ["Director, Customer Journey", "director"],
    ["Customer Experience Manager", "manager"],
    ["Principal UX Designer", "head"],
    ["Senior Customer Experience Specialist", "senior"],
    ["Intern", "intern"],
  ];

  for (const [title, expected] of cases) {
    it(`"${title}" -> ${expected}`, () => {
      expect(inferSeniority(title)).toBe(expected);
    });
  }
});

describe("has_email signal", () => {
  // api_search tells us up front whether Apollo holds an email. Someone it has
  // none for will fail enrichment, so they must rank below equivalent peers.
  it("ranks a candidate with an email above an identical one without", () => {
    const withEmail = evaluateCandidate(
      candidate("Head of Customer Experience", "director", true),
      settings,
    );
    const without = evaluateCandidate(
      candidate("Head of Customer Experience", "director", false),
      settings,
    );
    expect(withEmail.score).toBeGreaterThan(without.score);
  });

  it("still keeps a strong candidate with no email on record", () => {
    // They stay selectable — the user may want to try waterfall on them.
    const decision = evaluateCandidate(
      candidate("Head of Customer Experience", "director", false),
      settings,
    );
    expect(decision.keep).toBe(true);
  });
});

describe("department classification", () => {
  // Apollo silently ignores person_departments, so this is matched locally.
  const cases: Array<[string, string]> = [
    ["Head of Customer Experience", "customer_experience"],
    ["Contact Centre Manager", "customer_service"],
    ["VP, Digital Transformation", "digital_transformation"],
    ["Head of Innovation", "ai_innovation"],
    ["Principal UX Designer", "design_ux"],
    ["Head of Loyalty and CRM", "loyalty_crm"],
    ["Director, Operations Excellence", "operations"],
    ["Group Head of Consumer Banking", "consumer_retail_banking"],
  ];

  for (const [title, expected] of cases) {
    it(`"${title}" -> ${expected}`, () => {
      expect(departmentsForTitle(title)).toContain(expected);
    });
  }

  it("returns nothing for an unrelated title", () => {
    expect(departmentsForTitle("Structural Engineer")).toEqual([]);
  });

  it("can place one title in several departments", () => {
    const d = departmentsForTitle("Head of Digital Customer Experience");
    expect(d).toContain("customer_experience");
    expect(d).toContain("digital_transformation");
  });
});

describe("department filter", () => {
  it("drops candidates outside the selected departments", () => {
    const scoped = { ...settings, departments: ["customer_service"] };
    const decision = evaluateCandidate(
      candidate("Head of Digital Transformation"),
      scoped,
    );
    expect(decision.keep).toBe(false);
    expect(decision.reason).toContain("Outside the selected departments");
  });

  it("keeps candidates inside the selected departments", () => {
    const scoped = { ...settings, departments: ["customer_service"] };
    expect(
      evaluateCandidate(candidate("Head of Contact Centre"), scoped).keep,
    ).toBe(true);
  });

  it("applies no department filter when none are selected", () => {
    const scoped = { ...settings, departments: [] };
    expect(
      evaluateCandidate(candidate("Head of Digital Transformation"), scoped).keep,
    ).toBe(true);
  });

  it("still lets hard exclusions win inside a selected department", () => {
    const scoped = { ...settings, departments: ["digital_transformation"] };
    expect(
      evaluateCandidate(
        candidate("Head of API and H2H Digital Channels"),
        scoped,
      ).keep,
    ).toBe(false);
  });
});

describe("wrong-employer guard", () => {
  // The IOI Properties incident: a "verified" email at a different employer.
  it("rejects the IOI Properties / SkyWorld case", () => {
    const result = emailMatchesEmployer("siew_low@skyworld.my", ["ioiproperties.com.my"]);
    expect(result.matches).toBe(false);
  });

  it("accepts an exact domain match", () => {
    expect(emailMatchesEmployer("tsekoon@dbs.com", ["dbs.com"]).matches).toBe(true);
  });

  it("accepts a country variant of the same root", () => {
    expect(emailMatchesEmployer("someone@dbs.com.sg", ["dbs.com"]).matches).toBe(true);
  });

  it("accepts a subdomain", () => {
    expect(emailMatchesEmployer("a@sg.accor.com", ["accor.com"]).matches).toBe(true);
  });

  it("skips the check rather than blocking when no target domain is known", () => {
    expect(emailMatchesEmployer("a@anything.com", []).matches).toBe(true);
  });
});

describe("personal email detection", () => {
  it("flags gmail", () => {
    expect(isPersonalEmail("someone@gmail.com", settings.personalEmailDomains)).toBe(true);
  });

  it("does not flag a corporate domain", () => {
    expect(isPersonalEmail("someone@dbs.com", settings.personalEmailDomains)).toBe(false);
  });

  it("parses the domain from an address", () => {
    expect(emailDomain("a.b@Sub.Example.COM")).toBe("sub.example.com");
  });
});
