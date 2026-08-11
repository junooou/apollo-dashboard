import { NextResponse } from "next/server";
import { getCreditsRemaining, searchPeople } from "@/lib/apollo";
import { filterAndRank } from "@/lib/filter";
import { indexExistingContacts } from "@/lib/csv";
import { loadSettings } from "@/lib/settings";
import { keywordsForDepartments } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Stage 1: search + filter. Consumes NO Apollo credits — mixed_people/search is
 * free and returns no emails. Safe to run as widely as you like.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      companyName?: string;
      organizationIds?: string[];
      domains?: string[];
      overrides?: Record<string, unknown>;
    };

    if (!body.companyName?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    const settings = { ...(await loadSettings()), ...(body.overrides ?? {}) } as Awaited<
      ReturnType<typeof loadSettings>
    >;

    const creditsBefore = await getCreditsRemaining();

    // When departments are selected, send their keywords to Apollo as titles so
    // the search itself is narrowed. Apollo ignores person_departments, so this
    // is the only way to push the department filter server-side; the same
    // selection is then re-applied locally in lib/filter.ts.
    const departmentTitles = keywordsForDepartments(settings.departments ?? []);
    const personTitles =
      departmentTitles.length > 0
        ? [...new Set([...departmentTitles, ...settings.personTitles])]
        : settings.personTitles;

    const { candidates, totalAvailable } = await searchPeople({
      companyName: body.companyName.trim(),
      organizationIds: body.organizationIds,
      domains: body.domains,
      personTitles,
      personSeniorities: settings.personSeniorities,
      personLocations: settings.personLocations,
    });

    const ranked = filterAndRank(candidates, settings);

    // When a search comes back thin, work out whether the location filter is
    // the cause and say so. Re-searching is free, so this costs nothing but
    // turns a blank screen into an actionable explanation.
    const diagnostics: string[] = [];
    if (candidates.length < 5 && settings.personLocations.length > 0) {
      try {
        const unfiltered = await searchPeople({
          companyName: body.companyName.trim(),
          organizationIds: body.organizationIds,
          domains: body.domains,
          personTitles,
          personSeniorities: settings.personSeniorities,
          personLocations: [],
          maxResults: 100,
        });
        if (unfiltered.totalAvailable > candidates.length) {
          diagnostics.push(
            `Only ${candidates.length} match in ${settings.personLocations.join("/")}, but ${unfiltered.totalAvailable} exist worldwide. If this company is headquartered elsewhere, clear the location filter in Settings.`,
          );
        }
      } catch {
        /* diagnostics are best-effort */
      }
    }

    if (candidates.length === 0 && diagnostics.length === 0) {
      diagnostics.push(
        body.domains?.length
          ? `No people found at ${body.domains.join(", ")} matching the configured titles. Try widening the job-title list in Settings, or check the domain is right.`
          : "No people found. Try searching by the company's domain instead of its name.",
      );
    }

    // Flag anyone already present in a shipped CSV so we never pay twice.
    const existing = await indexExistingContacts();
    for (const candidate of ranked) {
      const file = existing.get(candidate.apolloPersonId);
      if (file) candidate.alreadySourcedIn = file;
    }

    return NextResponse.json({
      candidates: ranked,
      rawSearchResults: candidates.length,
      totalAvailable,
      passedFilter: ranked.filter((c) => c.decision.keep).length,
      diagnostics,
      creditsBefore,
      settings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
