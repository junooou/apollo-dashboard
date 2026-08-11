import { NextResponse } from "next/server";
import { createCampaignDoc } from "@/lib/docs";

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
};

type SaveCampaignRequest = {
  campaignName: string;
  scope: "company" | "industry";
  sequenceRationale: string;
  emails: CampaignEmail[];

  company?: string;
  industry?: string;
};

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as SaveCampaignRequest;

    if (!body.campaignName?.trim()) {
      return NextResponse.json(
        {
          error: "campaignName is required",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Array.isArray(body.emails) ||
      body.emails.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "At least one campaign email is required",
        },
        {
          status: 400,
        },
      );
    }

    const result = await createCampaignDoc({
      ...body,
      campaignName: body.campaignName.trim(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "Google Doc creation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Google Doc creation failed",
      },
      {
        status: 500,
      },
    );
  }
}