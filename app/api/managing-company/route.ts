import { NextResponse } from "next/server";
import { findManagingCompany } from "@/lib/managing-company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = { property: string };

/** POST /api/managing-company -> OpenAI's best guess at who manages a property. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const property = body.property?.trim();
    if (!property) {
      return NextResponse.json(
        { error: "Enter a property or building name." },
        { status: 400 },
      );
    }

    const result = await findManagingCompany(property);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to look up the managing company",
      },
      { status: 500 },
    );
  }
}
