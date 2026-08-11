import { NextResponse } from "next/server";
import { searchOrganizations } from "@/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve a company name or domain to Apollo organizations, so the user can
 *  disambiguate group structures (e.g. sunway.com.my vs sunwaymalls.com). */
export async function POST(req: Request) {
  try {
    const { query } = (await req.json()) as { query?: string };
    if (!query?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    const organizations = await searchOrganizations(query.trim());
    return NextResponse.json({ organizations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
