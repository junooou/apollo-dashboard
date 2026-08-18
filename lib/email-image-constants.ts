/**
 * Client-safe constants/types for email image attachments — split out from
 * lib/email-images.ts because that file imports googleapis (Node-only) and
 * this one is also imported by the client component OutreachGenerator.tsx.
 */

/** Gmail-safe, and exactly what the Docs API's insertInlineImage supports. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
];

/** Per-image cap, keeps individual attachments light for inline rendering. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Per-email cap across all attached images. Comfortably under Gmail's
 * ~25MB total message size limit, leaving headroom for text/headers and
 * whatever else ends up in the same message.
 */
export const MAX_TOTAL_IMAGE_BYTES_PER_EMAIL = 10 * 1024 * 1024;

export type EmailImage = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailLink?: string;
  /** 0-based paragraph-gap index within the email body to insert after.
   *  Undefined means "end of body" — the only placement that used to exist. */
  positionAfterParagraph?: number;
  /** True if this file lives in the persistent "Email Images" library
   *  folder (survives after being embedded). False/undefined means it was
   *  uploaded to the ephemeral staging folder and gets deleted right after
   *  the Doc embeds it. */
  isLibraryImage?: boolean;
};

/**
 * Splits an email body into paragraphs on blank-line boundaries. Shared by
 * the client (live drag-and-drop position preview) and lib/docs.ts (actual
 * placeholder placement), so "paragraph gap N" means the same thing on both
 * sides.
 */
export function splitBodyIntoParagraphs(body: string): string[] {
  return body.split(/\n{2,}/);
}

export function validateImageFile(
  mimeType: string,
  sizeBytes: number,
): string | null {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return "Only JPEG, PNG, and GIF images are supported.";
  }

  if (sizeBytes > MAX_IMAGE_BYTES) {
    return `Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB per image).`;
  }

  return null;
}
