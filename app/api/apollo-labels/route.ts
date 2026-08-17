import { NextResponse } from "next/server";
import { ApolloError, listLabels, tagContactsInApollo } from "@/lib/apollo";
import type { EnrichedContact } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/apollo-labels -> existing Apollo lists, for the picker. */
export async function GET() {
  try {
    const labels = await listLabels();
    return NextResponse.json({ labels });
  } catch (err) {
    const status = err instanceof ApolloError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load Apollo lists" },
      { status },
    );
  }
}

type TagRequestBody = {
  contacts: EnrichedContact[];
  labelName: string;
};

/** POST /api/apollo-labels -> tag contacts with a list, creating it if needed. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TagRequestBody;
    const labelName = body.labelName?.trim();

    if (!labelName) {
      return NextResponse.json({ error: "Enter a list name." }, { status: 400 });
    }
    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      return NextResponse.json({ error: "No contacts to tag." }, { status: 400 });
    }

    const result = await tagContactsInApollo(
      body.contacts.map((c) => ({
        firstName: c.firstname,
        lastName: c.lastname,
        email: c.email,
        title: c.title,
        organizationName: c.company,
        linkedinUrl: c.linkedin_url,
      })),
      [labelName],
    );

    const labels = await listLabels();
    const label = labels.find((l) => l.name === labelName && l.modality === "contacts");

    return NextResponse.json({
      created: result.created,
      existing: result.existing,
      appUrl: label?.appUrl ?? null,
    });
  } catch (err) {
    const status = err instanceof ApolloError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to tag contacts in Apollo" },
      { status },
    );
  }
}
