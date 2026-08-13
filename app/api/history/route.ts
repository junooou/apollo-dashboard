import { NextResponse } from "next/server";
import { listRuns } from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Past enrichment runs logged on this machine — see the Run History page. */
export async function GET() {
  try {
    const runs = await listRuns();
    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
