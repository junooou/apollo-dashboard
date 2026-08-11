import { NextResponse } from "next/server";
import { buildCsv, csvFilename, saveCsvToDisk } from "@/lib/csv";
import { loadSettings } from "@/lib/settings";
import type { EnrichedContact } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build the CSV. `mode: "download"` streams it back; `mode: "save"` writes it
 * into the Apollo Lead Generation folder (only possible because this runs locally).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      companyName?: string;
      contacts?: EnrichedContact[];
      mode?: "download" | "save";
      filenameOverride?: string;
    };

    if (!body.contacts?.length) {
      return NextResponse.json({ error: "No contacts to export" }, { status: 400 });
    }

    const settings = await loadSettings();
    const filename = csvFilename(
      body.companyName ?? "contacts",
      body.filenameOverride || settings.filenameOverride,
    );
    const csv = buildCsv(body.contacts, { includePhone: settings.includePhone });

    if (body.mode === "save") {
      const savedTo = await saveCsvToDisk(filename, csv);
      return NextResponse.json({ savedTo, filename });
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
