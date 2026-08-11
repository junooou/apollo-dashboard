import { NextResponse } from "next/server";
import { loadSettings, resetSettings, saveSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: await loadSettings() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body?.reset === true) {
      return NextResponse.json({ settings: await resetSettings() });
    }
    return NextResponse.json({ settings: await saveSettings(body) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
