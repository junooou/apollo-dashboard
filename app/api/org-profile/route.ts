import { NextResponse } from "next/server";
import { enrichOrganization } from "@/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Firmographic detail (industry, size, HQ, funding) for one resolved
 *  organization, shown on the dashboard once a company is picked. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain")?.trim();
    if (!domain) {
      return NextResponse.json({ error: "domain is required" }, { status: 400 });
    }

    const profile = await enrichOrganization(domain);
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
