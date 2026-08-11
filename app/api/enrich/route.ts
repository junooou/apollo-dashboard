import { NextResponse } from "next/server";
import { getCreditsRemaining } from "@/lib/apollo";
import { enrichCandidates } from "@/lib/enrich";
import { loadSettings } from "@/lib/settings";
import type { RunSummary, ScoredCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Stage 3: enrichment. THIS SPENDS CREDITS. Only ever called with the exact
 * candidates the user ticked in the review table.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      companyName?: string;
      candidates?: ScoredCandidate[];
      targetDomains?: (string | null)[];
      rawSearchResults?: number;
      passedFilter?: number;
      overrides?: Record<string, unknown>;
    };

    if (!body.companyName?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!body.candidates?.length) {
      return NextResponse.json({ error: "No candidates selected" }, { status: 400 });
    }

    const settings = { ...(await loadSettings()), ...(body.overrides ?? {}) } as Awaited<
      ReturnType<typeof loadSettings>
    >;

    const creditsBefore = await getCreditsRemaining();

    const result = await enrichCandidates(body.candidates, {
      companyName: body.companyName.trim(),
      targetDomains: body.targetDomains ?? [],
      settings,
    });

    const creditsAfter = await getCreditsRemaining();

    const successful = result.contacts.filter((c) => !c.dropped);
    const dropped = result.contacts.filter((c) => c.dropped);

    // Surface the wrong-employer catches prominently — these are the dangerous
    // ones, because Apollo labelled them "verified".
    const wrongEmployer = dropped.filter((c) => c.dropped === "wrong_employer");
    if (wrongEmployer.length > 0) {
      result.issues.push(
        `${wrongEmployer.length} contact(s) returned a verified email belonging to a different employer and were dropped: ${wrongEmployer
          .map((c) => `${c.firstname} ${c.lastname} (${c.email})`)
          .join(", ")}`,
      );
    }

    if (successful.length < settings.contactTarget) {
      result.issues.push(
        `Landed ${successful.length} contacts against a target of ${settings.contactTarget}. Per context.md this is expected when the qualified pool is genuinely thin — not necessarily an error.`,
      );
    }

    const summary: RunSummary = {
      company: body.companyName.trim(),
      domain: body.targetDomains?.[0] ?? null,
      rawSearchResults: body.rawSearchResults ?? body.candidates.length,
      passedFilter: body.passedFilter ?? body.candidates.length,
      submittedForEnrichment: body.candidates.length,
      successful: successful.length,
      failed: dropped.length,
      waterfallAttempted: result.waterfallAttempted,
      waterfallRecovered: result.waterfallRecovered,
      waterfallCredits: result.waterfallCredits,
      creditsBefore,
      creditsAfter,
      creditsUsed:
        creditsBefore != null && creditsAfter != null ? creditsBefore - creditsAfter : null,
      issues: result.issues,
      droppedContacts: dropped,
    };

    return NextResponse.json({ contacts: successful, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
