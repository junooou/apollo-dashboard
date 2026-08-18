import { NextRequest, NextResponse } from "next/server";
import {
  postDraftOnlyCampaign,
  type DraftOnlyCampaignSettings,
} from "../../../../lib/gmass-draft-safety";

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
};

type GmassSequenceRequest = {
  emails: CampaignEmail[];
  emailAddresses?: string;
  sheetTarget?: {
    spreadsheetId: string;
    spreadsheetName?: string;
  };
  campaignName?: string;
};

type GmassRecipientSource =
  | { emailAddresses: string; listAddress?: never }
  | { listAddress: string; emailAddresses?: never };

type GmassCampaignResult = {
  campaignDraftId: string;
  campaignId: number;
  data: unknown;
};

/**
 * Escapes text so we can safely turn generated plain-text
 * outreach into a basic HTML/rich-text GMass email.
 */
function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => {
      const withBreaks =
        paragraph.replace(/\n/g, "<br />");

      return `<p>${withBreaks}</p>`;
    })
    .join("\n");
}

/**
 * Safely parse either JSON or plain-text API responses.
 */
async function parseResponse(
  response: Response,
): Promise<unknown> {
  const text =
    await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Extract campaignDraftId from GMass response.
 */
function getCampaignDraftId(
  data: unknown,
): string | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "campaignDraftId" in data
  ) {
    const value =
      (
        data as {
          campaignDraftId?: unknown;
        }
      ).campaignDraftId;

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

/**
 * Extract numeric campaignId from GMass response.
 */
function getCampaignId(
  data: unknown,
): number | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "campaignId" in data
  ) {
    const value =
      (
        data as {
          campaignId?: unknown;
        }
      ).campaignId;

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return value;
    }
  }

  return null;
}

/**
 * Creates one rich-text GMass campaign.
 *
 * We use this for each follow-up so GMass gives us
 * a numeric campaignId which can then be attached
 * to the main campaign as rich-text follow-up content.
 */
async function createRichTextCampaign({
  apiKey,
  fromEmail,
  recipientSource,
  subject,
  message,
  friendlyName,
}: {
  apiKey: string;
  fromEmail: string;
  recipientSource: GmassRecipientSource;
  subject: string;
  message: string;
  friendlyName: string;
}): Promise<GmassCampaignResult> {
  // STEP 1:
  // Create the Gmail / GMass campaign draft.

  const draftResponse =
    await fetch(
      "https://api.gmass.co/api/campaigndrafts",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "X-apikey":
            apiKey,
        },

        body: JSON.stringify({
          fromEmail,

          subject,

          message:
            textToHtml(message),

          messageType:
            "html",

          ...recipientSource,
        }),

        cache:
          "no-store",
      },
    );

  const draftData =
    await parseResponse(
      draftResponse,
    );

  if (!draftResponse.ok) {
    throw new Error(
      `Failed to create rich-text GMass draft: ${
        typeof draftData === "string"
          ? draftData
          : JSON.stringify(
              draftData,
            )
      }`,
    );
  }

  const campaignDraftId =
    getCampaignDraftId(
      draftData,
    );

  if (!campaignDraftId) {
    throw new Error(
      `GMass did not return a campaignDraftId: ${JSON.stringify(
        draftData,
      )}`,
    );
  }

  // STEP 2:
  // Register that rich-text draft as a GMass campaign.
  //
  // createDrafts:true keeps this in review/draft
  // workflow rather than intentionally launching it.

  const { response: campaignResponse, data: campaignData } =
    await postDraftOnlyCampaign({
      apiKey,
      campaignDraftId,
      settings: { friendlyName },
    });

  if (!campaignResponse.ok) {
    throw new Error(
      `Failed to register rich-text GMass campaign: ${
        typeof campaignData ===
        "string"
          ? campaignData
          : JSON.stringify(
              campaignData,
            )
      }`,
    );
  }

  const campaignId =
    getCampaignId(
      campaignData,
    );

  if (!campaignId) {
    throw new Error(
      `GMass did not return a campaignId: ${JSON.stringify(
        campaignData,
      )}`,
    );
  }

  return {
    campaignDraftId,
    campaignId,
    data: campaignData,
  };
}

async function resolveSheetListAddress({
  apiKey,
  spreadsheetId,
}: {
  apiKey: string;
  spreadsheetId: string;
}): Promise<string> {
  const worksheetsResponse = await fetch(
    `https://api.gmass.co/api/sheets/${encodeURIComponent(spreadsheetId)}/worksheets`,
    {
      headers: { "X-apikey": apiKey },
      cache: "no-store",
    },
  );
  const worksheetsData = await parseResponse(worksheetsResponse);

  if (!worksheetsResponse.ok) {
    throw new Error(
      `GMass could not access the Google Sheet: ${
        typeof worksheetsData === "string" ? worksheetsData : JSON.stringify(worksheetsData)
      }`,
    );
  }

  const worksheets = Array.isArray(worksheetsData) ? worksheetsData : [];
  const firstWorksheet = worksheets[0] as
    | { worksheetId?: string | number; worksheetName?: string }
    | undefined;

  if (firstWorksheet?.worksheetId === undefined) {
    throw new Error("GMass did not return a worksheet for the selected Google Sheet.");
  }

  const listResponse = await fetch("https://api.gmass.co/api/lists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-apikey": apiKey,
    },
    body: JSON.stringify({
      listSource: {
        listSourceSheet: {
          spreadsheetId,
          worksheetId: String(firstWorksheet.worksheetId),
          KeepDuplicates: false,
          UpdateSheet: false,
        },
      },
    }),
    cache: "no-store",
  });
  const listData = await parseResponse(listResponse);

  if (!listResponse.ok) {
    throw new Error(
      `GMass could not create a list from the Google Sheet: ${
        typeof listData === "string" ? listData : JSON.stringify(listData)
      }`,
    );
  }

  const listAddress =
    typeof listData === "object" &&
    listData !== null &&
    "listAddress" in listData &&
    typeof listData.listAddress === "string"
      ? listData.listAddress.trim()
      : "";

  if (!listAddress) {
    throw new Error(`GMass did not return a listAddress: ${JSON.stringify(listData)}`);
  }

  return listAddress;
}

export async function POST(
  request: NextRequest,
) {
  try {
    const apiKey =
      process.env.GMASS_API_KEY;

    const fromEmail =
      process.env.GMASS_FROM_EMAIL;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GMASS_API_KEY is not configured.",
        },
        {
          status: 500,
        },
      );
    }

    if (!fromEmail) {
      return NextResponse.json(
        {
          error:
            "GMASS_FROM_EMAIL is not configured.",
        },
        {
          status: 500,
        },
      );
    }

    const body =
      (await request.json()) as GmassSequenceRequest;

    const emails =
      Array.isArray(body.emails)
        ? body.emails
        : [];

    const emailAddresses =
      body.emailAddresses?.trim();

    const hasSheetTarget = body.sheetTarget !== undefined;
    const spreadsheetId = body.sheetTarget?.spreadsheetId?.trim();

    const campaignName =
      body.campaignName?.trim() ||
      "Voncierge Outreach";

    if (emails.length === 0) {
      return NextResponse.json(
        {
          error:
            "This campaign does not contain any emails.",
        },
        {
          status: 400,
        },
      );
    }

    if (Boolean(emailAddresses) === hasSheetTarget) {
      return NextResponse.json(
        {
          error:
            "Provide exactly one recipient source: emailAddresses or sheetTarget.",
        },
        {
          status: 400,
        },
      );
    }

    if (hasSheetTarget && !spreadsheetId) {
      return NextResponse.json(
        { error: "sheetTarget.spreadsheetId is required." },
        { status: 400 },
      );
    }

    const mainEmail =
      emails[0];

    if (!mainEmail) {
      return NextResponse.json(
        {
          error:
            "Main email is missing.",
        },
        {
          status: 400,
        },
      );
    }

    if (!mainEmail.subject?.trim()) {
      return NextResponse.json(
        {
          error:
            "Main email subject is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!mainEmail.body?.trim()) {
      return NextResponse.json(
        {
          error:
            "Main email body is required.",
        },
        {
          status: 400,
        },
      );
    }

    // Resolve and validate the recipient source before creating any GMass
    // drafts. A Sheet lookup or list-creation failure must stop the sequence
    // before even the first rich-text follow-up is created.
    const recipientSource: GmassRecipientSource = spreadsheetId
      ? {
          listAddress: await resolveSheetListAddress({
            apiKey,
            spreadsheetId,
          }),
        }
      : { emailAddresses: emailAddresses! };

    /**
     * ========================================
     * CREATE RICH-TEXT FOLLOW-UP CAMPAIGNS
     * ========================================
     *
     * Each generated follow-up becomes its own
     * rich-text GMass campaign.
     *
     * We then use the numeric campaign IDs in
     * the main campaign's auto-follow-up stages.
     */

    const richFollowUps: {
      campaignId: number;
      label: string;
    }[] = [];

    for (
      let index = 1;
      index < Math.min(
        emails.length,
        5,
      );
      index++
    ) {
      const followUp =
        emails[index];

      if (
        !followUp ||
        !followUp.body?.trim()
      ) {
        continue;
      }

      const friendlyName =
        `${campaignName} — ${
          followUp.label ||
          `Follow-Up ${index}`
        }`;

      const result =
        await createRichTextCampaign({
          apiKey,

          fromEmail,

          recipientSource,

          subject:
            followUp.subject?.trim() ||
            friendlyName,

          message:
            followUp.body.trim(),

          friendlyName,
        });

      richFollowUps.push({
        campaignId:
          result.campaignId,

        label:
          followUp.label ||
          `Follow-Up ${index}`,
      });
    }

    /**
     * ========================================
     * CREATE MAIN EMAIL DRAFT
     * ========================================
     */

    const mainDraftResponse =
      await fetch(
        "https://api.gmass.co/api/campaigndrafts",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-apikey":
              apiKey,
          },

          body: JSON.stringify({
            fromEmail,

            subject:
              mainEmail.subject.trim(),

            message:
              textToHtml(
                mainEmail.body.trim(),
              ),

            messageType:
              "html",

            ...recipientSource,
          }),

          cache:
            "no-store",
        },
      );

    const mainDraftData =
      await parseResponse(
        mainDraftResponse,
      );

    if (!mainDraftResponse.ok) {
      return NextResponse.json(
        {
          error:
            "GMass main campaign draft creation failed.",

          details:
            mainDraftData,
        },
        {
          status:
            mainDraftResponse.status,
        },
      );
    }

    const mainCampaignDraftId =
      getCampaignDraftId(
        mainDraftData,
      );

    if (!mainCampaignDraftId) {
      return NextResponse.json(
        {
          error:
            "GMass created the main draft but did not return a campaignDraftId.",

          details:
            mainDraftData,
        },
        {
          status: 500,
        },
      );
    }

    /**
     * ========================================
     * CONFIGURE FOLLOW-UP SEQUENCE
     * ========================================
     *
     * Stage 1 → Day 10
     * Stage 2 → Day 17
     * Stage 3 → Day 24
     * Stage 4 → Day 36
     *
     * "r" = No Reply
     * "same" = same email thread
     *
     * campaignId = rich-text/custom content
     */

    const campaignSettings: DraftOnlyCampaignSettings = {
      friendlyName: campaignName,
    };

    if (richFollowUps[0]) {
      campaignSettings.stageOneDays =
        10;

      campaignSettings.stageOneCampaignId =
        richFollowUps[0].campaignId;

      campaignSettings.stageOneAction =
        "r";

      campaignSettings.stageOneThread =
        "same";
    }

    if (richFollowUps[1]) {
      campaignSettings.stageTwoDays =
        17;

      campaignSettings.stageTwoCampaignId =
        richFollowUps[1].campaignId;

      campaignSettings.stageTwoAction =
        "r";

      campaignSettings.stageTwoThread =
        "same";
    }

    if (richFollowUps[2]) {
      campaignSettings.stageThreeDays =
        24;

      campaignSettings.stageThreeCampaignId =
        richFollowUps[2].campaignId;

      campaignSettings.stageThreeAction =
        "r";

      campaignSettings.stageThreeThread =
        "same";
    }

    if (richFollowUps[3]) {
      campaignSettings.stageFourDays =
        36;

      campaignSettings.stageFourCampaignId =
        richFollowUps[3].campaignId;

      campaignSettings.stageFourAction =
        "r";

      campaignSettings.stageFourThread =
        "same";
    }

    const { response: mainCampaignResponse, data: mainCampaignData } =
      await postDraftOnlyCampaign({
        apiKey,
        campaignDraftId: mainCampaignDraftId,
        settings: campaignSettings,
      });

    if (!mainCampaignResponse.ok) {
      console.error(
        "GMass main sequence configuration failed:",
        mainCampaignData,
      );

      return NextResponse.json(
        {
          error:
            "The GMass drafts were created, but the main follow-up sequence could not be configured.",

          details:
            mainCampaignData,

          followUps:
            richFollowUps,

          campaignDraftId:
            mainCampaignDraftId,
        },
        {
          status:
            mainCampaignResponse.status,
        },
      );
    }

    /**
     * DONE.
     */

    return NextResponse.json({
      ok: true,

      message:
        "GMass rich-text sequence created successfully.",

      campaignDraftId:
        mainCampaignDraftId,

      followUps:
        richFollowUps,

      campaign:
        mainCampaignData,
    });
  } catch (error) {
    console.error(
      "GMass rich-text sequence creation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "GMass rich-text sequence creation failed.",
      },
      {
        status: 500,
      },
    );
  }
}
