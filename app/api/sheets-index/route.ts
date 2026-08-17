import { NextResponse } from "next/server";
import { warmSheetsIndex } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status of the Voncierge Outreach sheets index — how many sheets/contacts
 * are cached, so the header can show a loading state while the first scan
 * runs and a confirmation once it's done.
 *
 * The scan is triggered here, by the browser's first call to this route on
 * page load (app/page.tsx calls it on mount) — NOT at server-process boot.
 * A `register()` hook in instrumentation.ts was tried first, to start the
 * scan the moment `npm run dev`/`next start` launches rather than waiting
 * for a browser tab; it was reverted because Next.js also compiles
 * instrumentation.ts for the Edge runtime, and `googleapis` (pulled in via
 * lib/sheets.ts) imports Node-only builtins (`http`, `https`) that don't
 * exist there — it broke the Edge bundle and took the whole app down with
 * 500s, even though the Node-only code path was correctly guarded at
 * runtime. If this is revisited, route the startup trigger through a plain
 * `fetch()` to this endpoint instead of importing lib/sheets directly from
 * instrumentation.ts, so that file stays free of Node-only imports.
 *
 * GET /api/sheets-index          -> warm (if needed) and return status
 * GET /api/sheets-index?force=1  -> re-scan even if already warm
 */
export async function GET(req: Request) {
  const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
  if (!folderId) {
    // Sheets export is an optional add-on (see README) — no folder configured
    // just means this feature is off, not an error.
    return NextResponse.json({ configured: false });
  }

  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.has("force");
    const index = await warmSheetsIndex(folderId, force);
    return NextResponse.json({
      configured: true,
      sheetCount: index.sheets.length,
      contactCount: index.contacts.length,
      loadedAt: index.loadedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ configured: true, error: message }, { status: 500 });
  }
}
