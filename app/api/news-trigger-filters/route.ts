import { NextRequest, NextResponse } from "next/server";

import {
  NEWS_TRIGGER_REGIONS,
  loadActiveNewsTriggerRegions,
  saveActiveNewsTriggerRegions,
} from "@/lib/news-trigger-filters";

export async function GET() {
  const active = await loadActiveNewsTriggerRegions();
  return NextResponse.json({ regions: NEWS_TRIGGER_REGIONS, active });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || !Array.isArray(body.active)) {
    return NextResponse.json(
      { error: "Expected a JSON body shaped like { active: string[] }." },
      { status: 400 },
    );
  }

  const active = await saveActiveNewsTriggerRegions(body.active);
  return NextResponse.json({ regions: NEWS_TRIGGER_REGIONS, active });
}
