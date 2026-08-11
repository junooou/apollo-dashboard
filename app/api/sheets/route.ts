import { NextResponse } from "next/server";
import {
  appendRows,
  createSpreadsheet,
  listSpreadsheetsInFolder,
  readRange,
  updateRange,
} from "@/lib/sheets";
import { contactsToRows } from "@/lib/csv";
import { loadSettings } from "@/lib/settings";
import type { EnrichedContact } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this length, a substring match is too likely to be noise ("A" would match everything). */
const MIN_FUZZY_LEN = 3;

/**
 * GET /api/sheets?list=1                        -> spreadsheets in GOOGLE_PARENT_FOLDER_ID
 * GET /api/sheets?checkCompany=OCBC              -> existing-contact counts by company, across the folder
 * GET /api/sheets?spreadsheetId=...&range=A1:Z99 -> raw cell values
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    if (searchParams.has("list")) {
      const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
      if (!folderId) {
        return NextResponse.json(
          { error: "GOOGLE_PARENT_FOLDER_ID is not set in .env.local" },
          { status: 400 },
        );
      }
      const sheets = await listSpreadsheetsInFolder(folderId);
      return NextResponse.json({ sheets });
    }

    if (searchParams.has("checkCompany")) {
      const company = searchParams.get("checkCompany")?.trim();
      const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
      if (!company) {
        return NextResponse.json({ error: "checkCompany must not be empty" }, { status: 400 });
      }
      if (!folderId) {
        return NextResponse.json(
          { error: "GOOGLE_PARENT_FOLDER_ID is not set in .env.local" },
          { status: 400 },
        );
      }

      const target = company.toLowerCase();
      const sheetsList = await listSpreadsheetsInFolder(folderId);

      const results = await Promise.all(
        sheetsList.map(async (s) => {
          try {
            const values = await readRange(s.id, "A1:Z5000");
            if (values.length < 2) return { sheetId: s.id, sheetName: s.name, count: 0 };

            const header = values[0].map((h) => (h ?? "").trim().toLowerCase());
            const companyCol = header.indexOf("company");
            if (companyCol < 0) return { sheetId: s.id, sheetName: s.name, count: 0 };

            let count = 0;
            for (const row of values.slice(1)) {
              const cell = row[companyCol]?.trim().toLowerCase();
              if (!cell) continue;
              // Heuristic: exact match, or either name contains the other, to
              // absorb drift like "OCBC" vs "OCBC Bank" — guarded by
              // MIN_FUZZY_LEN so short names can't substring-match everything.
              const matches =
                cell === target ||
                (cell.length >= MIN_FUZZY_LEN && target.includes(cell)) ||
                (target.length >= MIN_FUZZY_LEN && cell.includes(target));
              if (matches) count++;
            }
            return { sheetId: s.id, sheetName: s.name, count };
          } catch {
            // A single unreadable sheet shouldn't fail the whole check.
            return { sheetId: s.id, sheetName: s.name, count: 0 };
          }
        }),
      );

      const matches = results.filter((r) => r.count > 0);
      const totalContacts = matches.reduce((sum, r) => sum + r.count, 0);
      return NextResponse.json({ matches, totalContacts });
    }

    const spreadsheetId = searchParams.get("spreadsheetId");
    const range = searchParams.get("range");
    if (!spreadsheetId || !range) {
      return NextResponse.json(
        { error: "spreadsheetId and range query params are required" },
        { status: 400 },
      );
    }
    const values = await readRange(spreadsheetId, range);
    return NextResponse.json({ values });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type SheetsRequestBody = {
  mode: "append" | "update" | "create" | "pushContacts";
  spreadsheetId?: string;
  range?: string;
  values?: (string | number)[][];
  title?: string;
  sheetTitles?: string[];
  shareWithEmail?: string;
  parentFolderId?: string;
  contacts?: EnrichedContact[];
};

/**
 * mode: "append"       -> add rows after the last row with data in `range`
 * mode: "update"       -> overwrite exactly the cells in `range`
 * mode: "create"       -> new spreadsheet; optionally shared with `shareWithEmail`
 * mode: "pushContacts" -> append enriched contacts to an EXISTING sheet
 *                         (never overwrites); adds a header row only if the
 *                         sheet is currently empty.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SheetsRequestBody;

    if (body.mode === "create") {
      if (!body.title) {
        return NextResponse.json({ error: "title is required" }, { status: 400 });
      }
      const result = await createSpreadsheet(body.title, body.sheetTitles, {
        shareWithEmail: body.shareWithEmail,
        parentFolderId: body.parentFolderId,
      });
      return NextResponse.json(result);
    }

    if (body.mode === "pushContacts") {
      if (!body.spreadsheetId || !body.contacts?.length) {
        return NextResponse.json(
          { error: "spreadsheetId and contacts are required" },
          { status: 400 },
        );
      }
      const settings = await loadSettings();
      const { columns, rows } = contactsToRows(body.contacts, {
        includePhone: settings.includePhone,
      });

      // Unqualified "A1" targets the first sheet tab regardless of its name.
      const existing = await readRange(body.spreadsheetId, "A1:A1");
      const needsHeader = existing.length === 0 || !existing[0]?.[0];
      const payload = needsHeader ? [columns, ...rows] : rows;

      const result = await appendRows(body.spreadsheetId, "A1", payload);
      return NextResponse.json({ ...result, headerAdded: needsHeader, rowsPushed: rows.length });
    }

    if (!body.spreadsheetId || !body.range || !body.values) {
      return NextResponse.json(
        { error: "spreadsheetId, range and values are required" },
        { status: 400 },
      );
    }

    if (body.mode === "append") {
      const result = await appendRows(body.spreadsheetId, body.range, body.values);
      return NextResponse.json(result);
    }

    if (body.mode === "update") {
      const result = await updateRange(body.spreadsheetId, body.range, body.values);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unknown mode: ${body.mode}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
