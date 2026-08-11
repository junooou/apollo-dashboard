import { NextResponse } from "next/server";
import {
    createCampaignDoc,
    updateCampaignDoc,
  } from "@/lib/docs";

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
};

type SaveCampaignRequest = {
  documentId?: string;
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

    const campaign = {
        campaignName: body.campaignName.trim(),
        scope: body.scope,
        sequenceRationale: body.sequenceRationale,
        emails: body.emails,
        company: body.company,
        industry: body.industry,
      };
      
      const result = body.documentId
        ? await updateCampaignDoc(
            body.documentId,
            campaign,
          )
        : await createCampaignDoc(campaign);
      
      return NextResponse.json({
        ...result,
        updated: Boolean(body.documentId),
      });
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