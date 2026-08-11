import { NextResponse } from "next/server";
import { fetchCompanyNews } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news?company=OCBC */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const company = searchParams.get("company")?.trim();
    if (!company) {
      return NextResponse.json({ error: "company query param is required" }, { status: 400 });
    }
    const items = await fetchCompanyNews(company);
    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
