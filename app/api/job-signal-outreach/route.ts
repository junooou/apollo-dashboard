import { NextResponse } from "next/server";
import { searchOrganizations, searchPeople } from "@/lib/apollo";
import { getOutreachPersona } from "@/lib/job-signal-persona";
import { indexExistingContacts, jobSignalContactsToRows } from "@/lib/csv";
import {
  appendRows,
  findContactsForCompany,
  getOrCreateJobSignalOutreachSheet,
  invalidateSheetsIndex,
  markJobSignalContacted,
  normalizeContactName,
  readRange,
} from "@/lib/sheets";
import type { EnrichedContact, ScoredCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Explore Outreach" for one Job Signal listing (see app/page.tsx's
 * handleGenerateOutreachFromJobSignal). Everything here is free:
 * `searchOrganizations` (mixed_companies/search) and `searchPeople`
 * (mixed_people/api_search) never spend Apollo credits, per AGENTS.md's
 * credit-safety rule — enrichment stays a separate, explicit user action
 * via the existing /api/enrich route.
 *
 * GET  ?companyName=...&ssicCode=...&jobTitle=...
 *   -> resolved organization, the persona rule that fired, and candidate
 *      management contacts for that persona.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const companyName = searchParams.get("companyName")?.trim();
    const ssicCode = searchParams.get("ssicCode")?.trim() ?? "";

    if (!companyName) {
      return NextResponse.json({ error: "companyName is required" }, { status: 400 });
    }

    const persona = getOutreachPersona(ssicCode);

    const orgs = await searchOrganizations(companyName);
    const organization = orgs[0] ?? null;

    const { candidates: rawCandidates, totalAvailable } = await searchPeople({
      companyName,
      domains: organization?.domain ? [organization.domain] : undefined,
      organizationIds: !organization?.domain && organization?.id ? [organization.id] : undefined,
      personTitles: persona.personTitles,
      personSeniorities: persona.personSeniorities,
      personLocations: [],
    });

    // No filter/exclusion pass here on purpose — lib/filter.ts's rules (and
    // its department gate in particular) are tuned for the generic banking/
    // retail CX taxonomy, and would wrongly drop hospitality-style titles
    // like "Front Office Manager" that match no lib/taxonomy.ts department.
    // The persona's own title list already did the narrowing; rank by
    // hasEmail only, same "will this resolve" signal lib/filter.ts uses.
    const candidates: ScoredCandidate[] = rawCandidates
      .slice()
      .sort((a, b) => Number(b.hasEmail) - Number(a.hasEmail))
      .map((c) => ({
        ...c,
        decision: {
          keep: true,
          score: c.hasEmail ? 1 : 0,
          reason: `Matched the "${persona.label}" outreach persona`,
          matchedInclude: [],
          matchedExclude: [],
          matchedNegative: [],
          departments: [],
        },
      }));

    const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
    const [sheetContacts, csvIndex] = await Promise.all([
      folderId ? findContactsForCompany(folderId, companyName) : Promise.resolve([]),
      indexExistingContacts(),
    ]);
    const sheetById = new Map(
      sheetContacts.filter((c) => c.apolloPersonId).map((c) => [c.apolloPersonId, c.sheetName]),
    );
    const sheetByName = new Map(
      sheetContacts
        .filter((c) => c.firstname && c.lastname)
        .map((c) => [normalizeContactName(c.firstname, c.lastname), c.sheetName]),
    );
    for (const candidate of candidates) {
      const sheetName =
        sheetById.get(candidate.apolloPersonId) ??
        sheetByName.get(normalizeContactName(candidate.firstname, candidate.lastname));
      if (sheetName) {
        candidate.alreadySourcedIn = sheetName;
        candidate.alreadySourcedInType = "sheet";
        continue;
      }
      const file = csvIndex.get(candidate.apolloPersonId);
      if (file) {
        candidate.alreadySourcedIn = file;
        candidate.alreadySourcedInType = "csv";
      }
    }

    return NextResponse.json({ organization, persona, candidates, totalAvailable });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type SaveRequestBody = {
  action: "save";
  jobTitle: string;
  jobUrl: string;
  outreachPersona: string;
  contacts: EnrichedContact[];
};

type MarkContactedRequestBody = {
  action: "markContacted";
  rowIndex: number;
};

/**
 * POST { action: "save" }          -> append enriched contacts (already run
 *                                      through /api/enrich by the caller) to
 *                                      the single running "Job Signals
 *                                      Outreach" sheet, creating it on first
 *                                      use.
 * POST { action: "markContacted" } -> manual "I contacted this person"
 *                                      confirmation; shades the email cell
 *                                      green, same trust model as LinkedIn
 *                                      Drafts' "Mark as Sent".
 */
export async function POST(req: Request) {
  try {
    const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
    if (!folderId) {
      return NextResponse.json(
        { error: "GOOGLE_PARENT_FOLDER_ID is not set in .env.local" },
        { status: 400 },
      );
    }

    const body = (await req.json()) as SaveRequestBody | MarkContactedRequestBody;

    if (body.action === "save") {
      if (!body.contacts?.length) {
        return NextResponse.json({ error: "contacts are required" }, { status: 400 });
      }

      const spreadsheetId = await getOrCreateJobSignalOutreachSheet(folderId);
      const { columns, rows } = jobSignalContactsToRows(body.contacts, {
        jobTitle: body.jobTitle ?? "",
        jobUrl: body.jobUrl ?? "",
        outreachPersona: body.outreachPersona ?? "",
      });

      const existing = await readRange(spreadsheetId, "A1:A1");
      const needsHeader = existing.length === 0 || !existing[0]?.[0];
      const payload = needsHeader ? [columns, ...rows] : rows;

      const result = await appendRows(spreadsheetId, "A1", payload);
      invalidateSheetsIndex();

      // Row numbers of the just-appended contacts, in order, so the UI can
      // offer "Mark contacted" per row without re-scanning the sheet.
      // updatedRange looks like "'Sheet1'!A5:K8" — the first captured number
      // is the first data row of this batch.
      const match = result.updatedRange?.match(/![A-Z]+(\d+):/);
      const firstRow = match ? Number(match[1]) : null;
      const rowIndexes =
        firstRow !== null ? body.contacts.map((_, i) => firstRow + i) : body.contacts.map(() => null);

      return NextResponse.json({
        spreadsheetId,
        rowsPushed: rows.length,
        headerAdded: needsHeader,
        rowIndexes,
      });
    }

    if (body.action === "markContacted") {
      if (!body.rowIndex) {
        return NextResponse.json({ error: "rowIndex is required" }, { status: 400 });
      }
      const spreadsheetId = await getOrCreateJobSignalOutreachSheet(folderId);
      const result = await markJobSignalContacted(spreadsheetId, body.rowIndex);
      invalidateSheetsIndex();
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
