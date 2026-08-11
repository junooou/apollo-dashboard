import { google } from "googleapis";

function getGoogleAuth() {
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();

  const privateKey =
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google service account credentials are not configured.",
    );
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
    ],
  });
}

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
};

type CampaignDocument = {
  campaignName: string;
  scope: "company" | "industry";
  sequenceRationale: string;
  emails: CampaignEmail[];

  company?: string;
  industry?: string;
};

function buildDocumentText(
  campaign: CampaignDocument,
) {
  const sections: string[] = [];

  sections.push(campaign.campaignName);
  sections.push("");

  sections.push(
    `Campaign type: ${
      campaign.scope === "company"
        ? "Company-specific"
        : "Industry-wide"
    }`,
  );

  if (campaign.company) {
    sections.push(`Company: ${campaign.company}`);
  }

  if (campaign.industry) {
    sections.push(`Industry: ${campaign.industry}`);
  }

  sections.push("");
  sections.push("SEQUENCE RATIONALE");
  sections.push("");
  sections.push(campaign.sequenceRationale);
  sections.push("");

  for (const email of campaign.emails) {
    sections.push(
      "────────────────────────────────────────",
    );
    sections.push("");
    sections.push(email.label.toUpperCase());

    if (email.topic) {
      sections.push(`Topic: ${email.topic}`);
    }

    sections.push(`Subject: ${email.subject}`);
    sections.push("");
    sections.push(email.body);
    sections.push("");
  }

  return sections.join("\n");
}

export async function createCampaignDoc(
  campaign: CampaignDocument,
) {
  const auth = getGoogleAuth();

  const drive = google.drive({
    version: "v3",
    auth,
  });

  const docs = google.docs({
    version: "v1",
    auth,
  });

  const parentFolderId =
    process.env.GOOGLE_PARENT_FOLDER_ID?.trim();

  if (!parentFolderId) {
    throw new Error(
      "GOOGLE_PARENT_FOLDER_ID is not configured.",
    );
  }

  /*
   * Create the Google Doc as a Drive file inside the
   * configured Shared Drive folder.
   */
  const createdFile = await drive.files.create({
    supportsAllDrives: true,

    requestBody: {
      name: campaign.campaignName,
      mimeType:
        "application/vnd.google-apps.document",
      parents: [parentFolderId],
    },

    fields: "id, webViewLink",
  });

  const documentId = createdFile.data.id;

  if (!documentId) {
    throw new Error(
      "Google Drive did not return a document ID.",
    );
  }

  const documentText =
    buildDocumentText(campaign);

  /*
   * A blank Google Doc starts with an empty body.
   * Insert the entire campaign beginning at index 1.
   */
  await docs.documents.batchUpdate({
    documentId,

    requestBody: {
      requests: [
        {
          insertText: {
            location: {
              index: 1,
            },
            text: documentText,
          },
        },
      ],
    },
  });

  return {
    documentId,

    url:
      createdFile.data.webViewLink ||
      `https://docs.google.com/document/d/${documentId}/edit`,
  };
}