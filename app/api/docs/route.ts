import { NextResponse } from "next/server";
import {
    createCampaignDoc,
    updateCampaignDoc,
    insertIntoDocTab,
    listCampaignDocsInFolder,
    listDocumentTabs,
  } from "@/lib/docs";
import type { EmailImage } from "@/lib/email-images";

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
  images?: EmailImage[];
};

type SaveCampaignRequest = {
  documentId?: string;
  tabId?: string;
  campaignName: string;
  scope: "company" | "industry";
  sequenceRationale: string;
  emails: CampaignEmail[];

  company?: string;
  industry?: string;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.has("tabs")) {
      const documentId = searchParams.get("documentId");

      if (!documentId) {
        return NextResponse.json(
          { error: "documentId is required" },
          { status: 400 },
        );
      }

      const tabs = await listDocumentTabs(documentId);
      return NextResponse.json({ tabs });
    }

    if (searchParams.has("listFolder")) {
      const folderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();

      if (!folderId) {
        return NextResponse.json(
          { error: "GOOGLE_PARENT_FOLDER_ID is not configured." },
          { status: 500 },
        );
      }

      const docs = await listCampaignDocsInFolder(folderId);
      return NextResponse.json({ docs });
    }

    return NextResponse.json(
      { error: "Unsupported query" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Google Doc listing failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Google Doc listing failed",
      },
      { status: 500 },
    );
  }
}

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
      
      if (body.tabId !== undefined) {
        if (!body.documentId) {
          return NextResponse.json(
            { error: "documentId is required when tabId is set" },
            { status: 400 },
          );
        }

        const result = await insertIntoDocTab(
          body.documentId,
          body.tabId || undefined,
          campaign,
        );

        return NextResponse.json({
          ...result,
          updated: true,
        });
      }

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