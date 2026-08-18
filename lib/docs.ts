import { google, docs_v1 } from "googleapis";
import {
  ensurePublicReadableImageUrl,
  deleteStagingImages,
  type EmailImage,
} from "@/lib/email-images";
import { splitBodyIntoParagraphs } from "@/lib/email-image-constants";

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
  images?: EmailImage[];
};

type CampaignDocument = {
  campaignName: string;
  scope: "company" | "industry";
  sequenceRationale: string;
  emails: CampaignEmail[];
  company?: string;
  industry?: string;
};

/** A unique text token standing in for an image, plus which image it maps
 *  to — resolved to a real document index later via locatePlaceholders,
 *  once the text has actually been inserted and Google has assigned real
 *  indices to it. */
type ImagePlaceholder = {
  token: string;
  image: EmailImage;
};

function buildDocumentContent(
  campaign: CampaignDocument,
): { text: string; imagePlaceholders: ImagePlaceholder[] } {
  const sections: string[] = [];
  const imagePlaceholders: ImagePlaceholder[] = [];

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

  let placeholderCounter = 0;

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

    const paragraphs = splitBodyIntoParagraphs(email.body);
    const images = email.images ?? [];
    const lastGap = paragraphs.length - 1;

    const pushImagesAtGap = (gap: number) => {
      for (const image of images) {
        if (image.positionAfterParagraph !== gap) continue;

        // Unique per placeholder so it can never collide with real body text.
        const token = `IMG_PLACEHOLDER_${placeholderCounter++}`;
        sections.push(token);
        imagePlaceholders.push({ token, image });
        sections.push("");
      }
    };

    paragraphs.forEach((paragraph, index) => {
      sections.push(paragraph);
      sections.push("");
      pushImagesAtGap(index);
    });

    // Anything with no explicit position, or a position pointing at a
    // paragraph gap that no longer exists (e.g. the user repositioned an
    // image, then edited the body and removed that paragraph before
    // saving), lands at the end of the body — today's only behavior.
    for (const image of images) {
      const gap = image.positionAfterParagraph;
      const hasValidGap = gap !== undefined && gap >= 0 && gap <= lastGap;

      if (hasValidGap) continue;

      const token = `IMG_PLACEHOLDER_${placeholderCounter++}`;
      sections.push(token);
      imagePlaceholders.push({ token, image });
      sections.push("");
    }
  }

  const text = sections.join("\n");

  return { text, imagePlaceholders };
}

/**
 * Walks a Docs structural-content tree looking for each placeholder token's
 * literal text and returns its real, Google-assigned document index. Doing
 * this against the live document (rather than computing offsets by hand
 * from the string we sent) sidesteps having to replicate the Docs API's own
 * index accounting, which does not map 1:1 onto plain JS string length —
 * paragraph/segment boundaries carry their own rules for what a
 * deleteContentRange may span.
 */
function locatePlaceholders(
  content: docs_v1.Schema$StructuralElement[] | undefined,
  imagePlaceholders: ImagePlaceholder[],
): { startIndex: number; length: number; image: EmailImage }[] {
  const remaining = new Map(imagePlaceholders.map((p) => [p.token, p]));
  const located: { startIndex: number; length: number; image: EmailImage }[] =
    [];

  for (const element of content ?? []) {
    for (const paragraphElement of element.paragraph?.elements ?? []) {
      const run = paragraphElement.textRun;
      const runText = run?.content;
      const runStart = paragraphElement.startIndex;

      if (!runText || runStart === undefined || runStart === null) continue;

      for (const [token, placeholder] of remaining) {
        const tokenOffset = runText.indexOf(token);
        if (tokenOffset === -1) continue;

        located.push({
          startIndex: runStart + tokenOffset,
          length: token.length,
          image: placeholder.image,
        });
        remaining.delete(token);
      }
    }
  }

  return located;
}

/**
 * Deletes any embedded image's ephemeral staging Drive copy now that Docs
 * has copied its bytes into the document itself. Never throws — the Doc
 * save has already succeeded by the time this runs, so a cleanup failure
 * must not fail the overall save.
 */
async function cleanupStagingImages(
  imagePlaceholders: ImagePlaceholder[],
): Promise<void> {
  const stagingImageIds = imagePlaceholders
    .filter((p) => !p.image.isLibraryImage)
    .map((p) => p.image.id);

  if (stagingImageIds.length === 0) return;

  try {
    await deleteStagingImages(stagingImageIds);
  } catch (error) {
    console.error("Staging image cleanup failed (non-fatal):", error);
  }
}

/**
 * Resolves each placeholder to a batchUpdate request pair (delete the
 * placeholder text, insert the image in its place). Processed in descending
 * index order so that earlier, not-yet-processed positions are never
 * shifted by an edit made later in the same batchUpdate — batchUpdate does
 * not auto-adjust indices across requests for you.
 */
async function buildImageRequests(
  located: { startIndex: number; length: number; image: EmailImage }[],
  tabId: string | undefined,
): Promise<docs_v1.Schema$Request[]> {
  const sorted = [...located].sort((a, b) => b.startIndex - a.startIndex);
  const requests: docs_v1.Schema$Request[] = [];

  for (const placeholder of sorted) {
    const uri = await ensurePublicReadableImageUrl(placeholder.image.id);
    const startIndex = placeholder.startIndex;
    const endIndex = startIndex + placeholder.length;

    requests.push({
      deleteContentRange: {
        range: { tabId, startIndex, endIndex },
      },
    });

    requests.push({
      insertInlineImage: {
        location: { tabId, index: startIndex },
        uri,
      },
    });
  }

  return requests;
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

  const { text: documentText, imagePlaceholders } =
    buildDocumentContent(campaign);

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

  if (imagePlaceholders.length > 0) {
    const currentDocument = await docs.documents.get({ documentId });
    const located = locatePlaceholders(
      currentDocument.data.body?.content,
      imagePlaceholders,
    );

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: await buildImageRequests(located, undefined),
      },
    });

    await cleanupStagingImages(imagePlaceholders);
  }

  return {
    documentId,

    url:
      createdFile.data.webViewLink ||
      `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

export async function updateCampaignDoc(
  documentId: string,
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

  const currentDocument =
    await docs.documents.get({
      documentId,
    });

  const bodyContent =
    currentDocument.data.body?.content ?? [];

  const lastElement =
    bodyContent[bodyContent.length - 1];

  const endIndex =
    lastElement?.endIndex ?? 1;

  const { text: documentText, imagePlaceholders } =
    buildDocumentContent(campaign);

  const requests: docs_v1.Schema$Request[] = [];

  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: endIndex - 1,
        },
      },
    });
  }

  requests.push({
    insertText: {
      location: {
        index: 1,
      },
      text: documentText,
    },
  });

  await docs.documents.batchUpdate({
    documentId,

    requestBody: {
      requests,
    },
  });

  if (imagePlaceholders.length > 0) {
    const updatedDocument = await docs.documents.get({ documentId });
    const located = locatePlaceholders(
      updatedDocument.data.body?.content,
      imagePlaceholders,
    );

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: await buildImageRequests(located, undefined),
      },
    });

    await cleanupStagingImages(imagePlaceholders);
  }

  await drive.files.update({
    fileId: documentId,
    supportsAllDrives: true,

    requestBody: {
      name: campaign.campaignName,
    },
  });

  return {
    documentId,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

/** Matches the folder depth used for the equivalent Sheets picker (lib/sheets.ts) — the real Shared Drive nests real files one level below the configured parent folder. */
const MAX_FOLDER_DEPTH = 4;

async function listSubfolders(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
): Promise<string[]> {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return (res.data.files ?? []).map((f) => f.id!).filter(Boolean);
}

async function collectFolderIds(
  drive: ReturnType<typeof google.drive>,
  rootId: string,
): Promise<string[]> {
  const all = [rootId];
  let frontier = [rootId];

  for (let depth = 0; depth < MAX_FOLDER_DEPTH && frontier.length > 0; depth++) {
    const children = await Promise.all(frontier.map((id) => listSubfolders(drive, id)));
    frontier = children.flat();
    all.push(...frontier);
  }

  return all;
}

export async function listCampaignDocsInFolder(
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const auth = getGoogleAuth();
  const drive = google.drive({ version: "v3", auth });
  const folderIds = await collectFolderIds(drive, folderId);

  const parentClause = folderIds.map((id) => `'${id}' in parents`).join(" or ");
  const res = await drive.files.list({
    q: `(${parentClause}) and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: "files(id, name)",
    orderBy: "name",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}

export type DocTab = {
  tabId: string;
  title: string;
  nestingLevel: number;
};

function flattenTabs(
  tabs: docs_v1.Schema$Tab[] | undefined,
  out: DocTab[] = [],
): DocTab[] {
  for (const tab of tabs ?? []) {
    const props = tab.tabProperties;
    if (props?.tabId) {
      out.push({
        tabId: props.tabId,
        title: props.title || "Untitled tab",
        nestingLevel: props.nestingLevel ?? 0,
      });
    }
    flattenTabs(tab.childTabs, out);
  }
  return out;
}

export async function listDocumentTabs(
  documentId: string,
): Promise<DocTab[]> {
  const auth = getGoogleAuth();
  const docs = google.docs({ version: "v1", auth });

  const document = await docs.documents.get({
    documentId,
    fields: "tabs(tabProperties,childTabs)",
  });

  return flattenTabs(document.data.tabs);
}

function findTabBody(
  tabs: docs_v1.Schema$Tab[] | undefined,
  tabId: string,
): docs_v1.Schema$Body | undefined {
  for (const tab of tabs ?? []) {
    if (tab.tabProperties?.tabId === tabId) {
      return tab.documentTab?.body;
    }
    const found = findTabBody(tab.childTabs, tabId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Inserts a campaign into an existing Doc, optionally scoped to one of its
 * sub-tabs. Unlike updateCampaignDoc, this never renames the Drive file —
 * the target is a shared multi-tab hub doc, not a doc this app owns.
 *
 * The Docs API has no way to create a new tab (no CreateTabRequest exists in
 * the schema), so when `tabId` is omitted the request targets the document's
 * root/first tab, matching the API's own documented fallback behavior for an
 * unspecified tab ID.
 */
export async function insertIntoDocTab(
  documentId: string,
  tabId: string | undefined,
  campaign: CampaignDocument,
) {
  const auth = getGoogleAuth();
  const docs = google.docs({ version: "v1", auth });

  let endIndex = 1;

  if (tabId) {
    const currentDocument = await docs.documents.get({
      documentId,
      includeTabsContent: true,
    });

    const tabBody = findTabBody(currentDocument.data.tabs, tabId);
    const bodyContent = tabBody?.content ?? [];
    const lastElement = bodyContent[bodyContent.length - 1];
    endIndex = lastElement?.endIndex ?? 1;
  } else {
    const currentDocument = await docs.documents.get({
      documentId,
    });

    const bodyContent = currentDocument.data.body?.content ?? [];
    const lastElement = bodyContent[bodyContent.length - 1];
    endIndex = lastElement?.endIndex ?? 1;
  }

  const { text: documentText, imagePlaceholders } =
    buildDocumentContent(campaign);

  const requests: docs_v1.Schema$Request[] = [];

  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: {
          tabId,
          startIndex: 1,
          endIndex: endIndex - 1,
        },
      },
    });
  }

  requests.push({
    insertText: {
      location: {
        tabId,
        index: 1,
      },
      text: documentText,
    },
  });

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });

  if (imagePlaceholders.length > 0) {
    const refreshedDocument = tabId
      ? await docs.documents.get({ documentId, includeTabsContent: true })
      : await docs.documents.get({ documentId });

    const refreshedContent = tabId
      ? findTabBody(refreshedDocument.data.tabs, tabId)?.content
      : refreshedDocument.data.body?.content;

    const located = locatePlaceholders(refreshedContent, imagePlaceholders);

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: await buildImageRequests(located, tabId),
      },
    });

    await cleanupStagingImages(imagePlaceholders);
  }

  return {
    documentId,
    url: tabId
      ? `https://docs.google.com/document/d/${documentId}/edit?tab=t.${tabId}`
      : `https://docs.google.com/document/d/${documentId}/edit`,
  };
}
