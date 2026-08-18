/**
 * Image library for the Outreach Generator's per-email image attachments.
 * Storage is the same shared Drive / service-account pattern already used by
 * lib/sheets.ts and lib/docs.ts — no per-user OAuth, so "pick from Google
 * Drive" means "pick from this app's own image folder", not a user's
 * personal Drive.
 */

import { google } from "googleapis";
import { Readable } from "stream";
import sharp from "sharp";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  validateImageFile,
  type EmailImage,
} from "@/lib/email-image-constants";

export {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES_PER_EMAIL,
  validateImageFile,
  type EmailImage,
} from "@/lib/email-image-constants";

function loadCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "Google service account credentials are not configured.",
    );
  }

  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;

  return { email, privateKey };
}

function getDriveClient() {
  const { email, privateKey } = loadCredentials();
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/** Name of the subfolder inside GOOGLE_PARENT_FOLDER_ID that holds images
 *  explicitly saved for reuse across campaigns — persists indefinitely.
 *  Mirrors OUTREACH_SHEETS_SUBFOLDER_NAME in lib/sheets.ts. */
export const EMAIL_IMAGES_LIBRARY_SUBFOLDER_NAME = "Email Images";

/** Name of the subfolder that holds per-send uploads not saved to the
 *  library — deleted again right after they're embedded into a Doc, since
 *  Docs copies the image bytes in and no longer needs the Drive source. */
export const EMAIL_IMAGES_STAGING_SUBFOLDER_NAME = "Email Images Staging";

/** Cached per-process once resolved, same lifetime rule as lib/sheets.ts's
 *  cachedOutreachSheetsFolderId. */
let cachedEmailImagesLibraryFolderId: string | null = null;
let cachedEmailImagesStagingFolderId: string | null = null;

async function getOrCreateSubfolderId(
  name: string,
  cached: string | null,
  setCache: (id: string) => void,
): Promise<string> {
  if (cached) return cached;

  const parentFolderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();

  if (!parentFolderId) {
    throw new Error("GOOGLE_PARENT_FOLDER_ID is not configured.");
  }

  const drive = getDriveClient();

  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  const existing = res.data.files?.[0]?.id;

  if (existing) {
    setCache(existing);
    return existing;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const id = created.data.id!;
  setCache(id);
  return id;
}

/** Resolves the persistent "Email Images" library subfolder ID, creating it
 *  if it doesn't exist yet. */
export async function getOrCreateEmailImagesLibraryFolderId(): Promise<string> {
  return getOrCreateSubfolderId(
    EMAIL_IMAGES_LIBRARY_SUBFOLDER_NAME,
    cachedEmailImagesLibraryFolderId,
    (id) => (cachedEmailImagesLibraryFolderId = id),
  );
}

/** Resolves the ephemeral "Email Images Staging" subfolder ID, creating it
 *  if it doesn't exist yet. */
export async function getOrCreateEmailImagesStagingFolderId(): Promise<string> {
  return getOrCreateSubfolderId(
    EMAIL_IMAGES_STAGING_SUBFOLDER_NAME,
    cachedEmailImagesStagingFolderId,
    (id) => (cachedEmailImagesStagingFolderId = id),
  );
}

/**
 * Downscales/re-compresses an image for Gmail-friendly inline display:
 * capped to a single-column email width and re-encoded at a size-conscious
 * quality. Animated GIFs are passed through untouched — sharp's animated-GIF
 * re-encode is lossy/unreliable enough to risk breaking the animation, which
 * isn't worth it for this use case.
 */
const EMAIL_IMAGE_MAX_WIDTH = 650;

async function resizeForEmail(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType === "image/gif") {
    return { buffer, mimeType };
  }

  let image = sharp(buffer);
  const metadata = await image.metadata();

  if (metadata.width && metadata.width > EMAIL_IMAGE_MAX_WIDTH) {
    image = image.resize({
      width: EMAIL_IMAGE_MAX_WIDTH,
      withoutEnlargement: true,
    });
  }

  const resized =
    mimeType === "image/png"
      ? await image.png({ quality: 80, compressionLevel: 9 }).toBuffer()
      : await image.jpeg({ quality: 80 }).toBuffer();

  return { buffer: resized, mimeType };
}

export async function uploadEmailImage(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  opts: { toLibrary: boolean },
): Promise<EmailImage> {
  const validationError = validateImageFile(mimeType, buffer.length);

  if (validationError) {
    throw new Error(validationError);
  }

  const resized = await resizeForEmail(buffer, mimeType);

  const resizedValidationError = validateImageFile(
    resized.mimeType,
    resized.buffer.length,
  );

  if (resizedValidationError) {
    throw new Error(resizedValidationError);
  }

  const folderId = opts.toLibrary
    ? await getOrCreateEmailImagesLibraryFolderId()
    : await getOrCreateEmailImagesStagingFolderId();

  const drive = getDriveClient();

  const created = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: resized.mimeType,
      body: Readable.from(resized.buffer),
    },
    fields: "id, name, mimeType, size, thumbnailLink",
    supportsAllDrives: true,
  });

  return {
    id: created.data.id!,
    name: created.data.name ?? filename,
    mimeType: created.data.mimeType ?? resized.mimeType,
    sizeBytes: created.data.size
      ? Number(created.data.size)
      : resized.buffer.length,
    thumbnailLink: created.data.thumbnailLink ?? undefined,
    isLibraryImage: opts.toLibrary,
  };
}

/** Best-effort delete — swallows "already gone" so cleanup stays idempotent
 *  if a save is retried. */
export async function deleteEmailImage(fileId: string): Promise<void> {
  const drive = getDriveClient();

  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (error) {
    const status = (error as { code?: number; response?: { status?: number } })
      ?.response?.status;

    if (status === 404) return;

    throw error;
  }
}

/** Deletes ephemeral staging images after they've been embedded into a Doc.
 *  Never throws — one failed delete must not block cleanup of the rest, and
 *  the Doc save this runs after has already succeeded by this point. */
export async function deleteStagingImages(fileIds: string[]): Promise<void> {
  const results = await Promise.allSettled(
    fileIds.map((id) => deleteEmailImage(id)),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Staging image cleanup failed (non-fatal):", result.reason);
    }
  }
}

export async function listEmailImages(): Promise<EmailImage[]> {
  const folderId = await getOrCreateEmailImagesLibraryFolderId();
  const drive = getDriveClient();

  const mimeClause = ALLOWED_IMAGE_MIME_TYPES.map(
    (m) => `mimeType = '${m}'`,
  ).join(" or ");

  const res = await drive.files.list({
    q: `'${folderId}' in parents and (${mimeClause}) and trashed = false`,
    fields: "files(id, name, mimeType, size, thumbnailLink)",
    orderBy: "createdTime desc",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name ?? "Untitled image",
    mimeType: f.mimeType ?? "image/jpeg",
    sizeBytes: f.size ? Number(f.size) : 0,
    thumbnailLink: f.thumbnailLink ?? undefined,
    isLibraryImage: true,
  }));
}

/**
 * insertInlineImage (Docs API) fetches the image from a public URI at
 * request time — a private Shared Drive file won't work. Permission is
 * granted lazily, only for images actually being inserted into a Doc, since
 * that's the only point at which public exposure is unavoidable (the image
 * is about to be mailed to an external prospect anyway).
 */
export async function ensurePublicReadableImageUrl(
  fileId: string,
): Promise<string> {
  const drive = getDriveClient();

  const existing = await drive.permissions.list({
    fileId,
    fields: "permissions(type, role)",
    supportsAllDrives: true,
  });

  const alreadyPublic = (existing.data.permissions ?? []).some(
    (p) => p.type === "anyone" && (p.role === "reader" || p.role === "writer"),
  );

  if (!alreadyPublic) {
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
      supportsAllDrives: true,
    });
  }

  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}
