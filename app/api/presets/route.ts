import { NextResponse } from "next/server";
import { deletePreset, listPresets, savePreset } from "@/lib/presets";
import type { PersonaFilters } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ presets: await listPresets() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      filters?: PersonaFilters;
      deleteId?: string;
    };

    if (body.deleteId) {
      return NextResponse.json({ presets: await deletePreset(body.deleteId) });
    }
    if (!body.filters) {
      return NextResponse.json({ error: "No filters to save" }, { status: 400 });
    }

    const presets = await savePreset(
      body.name ?? "",
      body.description ?? "",
      body.filters,
    );
    return NextResponse.json({ presets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
