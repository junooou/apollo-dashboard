import { NextResponse } from "next/server";
import { getCreditUsage } from "@/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Credit snapshot for the header. Returns null rather than erroring when the
 *  plan's usage endpoint has a shape we don't recognise. */
export async function GET() {
  const hasKey = Boolean(process.env.APOLLO_API_KEY?.trim());
  if (!hasKey) {
    return NextResponse.json({ credits: null, hasKey: false });
  }
  const usage = await getCreditUsage();
  return NextResponse.json({
    credits: usage?.leadCreditsLeft ?? null,
    usage,
    hasKey: true,
  });
}
