"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { EmailImage } from "@/lib/email-image-constants";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES_PER_EMAIL,
  splitBodyIntoParagraphs,
} from "@/lib/email-image-constants";

type CampaignScope = "company" | "industry";

export type OutreachPrefill = {
  requestId: number;
  company: string;
  industry?: string;
  context: string;
  autoGenerate?: boolean;
};

export type OutreachRecipientPrefill = {
  requestId: number;
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl?: string;
};

/** An image picked from the device but not yet uploaded anywhere — lives
 *  only in this tab until the campaign is saved, at which point it's
 *  uploaded to Drive (staging or library, per `saveToLibrary`), embedded
 *  into the Doc, and (if not library) deleted from Drive again. */
type PendingEmailImage = {
  localId: string;
  file: File;
  previewUrl: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  saveToLibrary: boolean;
  positionAfterParagraph?: number;
};

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
  images?: EmailImage[];
  pendingImages?: PendingEmailImage[];
};

/** Unified view of an email's attachments (already-resolved + pending) for
 *  rendering the chip list and the drag-and-drop placement preview. `key` is
 *  prefixed so a resolved Drive id and a client-only localId can never
 *  collide: "r:<EmailImage.id>" or "p:<PendingEmailImage.localId>". */
type ImageAttachment = {
  key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewSrc?: string;
  positionAfterParagraph?: number;
  isPending: boolean;
  isLibraryImage: boolean;
};

function getEmailAttachments(email: CampaignEmail): ImageAttachment[] {
  const resolved: ImageAttachment[] = (email.images ?? []).map((img) => ({
    key: `r:${img.id}`,
    name: img.name,
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
    previewSrc: img.thumbnailLink,
    positionAfterParagraph: img.positionAfterParagraph,
    isPending: false,
    isLibraryImage: img.isLibraryImage ?? false,
  }));

  const pending: ImageAttachment[] = (email.pendingImages ?? []).map(
    (img) => ({
      key: `p:${img.localId}`,
      name: img.name,
      mimeType: img.mimeType,
      sizeBytes: img.sizeBytes,
      previewSrc: img.previewUrl,
      positionAfterParagraph: img.positionAfterParagraph,
      isPending: true,
      isLibraryImage: img.saveToLibrary,
    }),
  );

  return [...resolved, ...pending];
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type GeneratedCampaign = {
  campaignName: string;
  scope: CampaignScope;
  sequenceRationale: string;
  emails: CampaignEmail[];
};

/**
 * /api/generate-template's schema knows nothing about images (it's a
 * strict AI-generated JSON shape), so a revision response never carries
 * attachments forward on its own. Matched by label first (revisions are
 * instructed to leave unaffected emails' labels unchanged) and falls back
 * to index only when the email count didn't change, since label matching
 * alone can't help if the AI renamed everything.
 */
function mergeImagesIntoRevisedCampaign(
  previous: GeneratedCampaign,
  revised: GeneratedCampaign,
): GeneratedCampaign {
  const sameCount = previous.emails.length === revised.emails.length;

  return {
    ...revised,
    emails: revised.emails.map((email, index) => {
      const matchByLabel = previous.emails.find(
        (e) =>
          e.label.trim().toLowerCase() === email.label.trim().toLowerCase(),
      );

      const matched =
        matchByLabel ?? (sameCount ? previous.emails[index] : undefined);

      return matched?.images ? { ...email, images: matched.images } : email;
    }),
  };
}

/**
 * Renders the email body as paragraph blocks with a drop-zone between each
 * one, so a user can drag an attached image onto the exact spot it should
 * be inserted. Gap `i` means "insert after paragraph i" — matches
 * lib/docs.ts's buildDocumentContent exactly, both split the body with the
 * same splitBodyIntoParagraphs helper. The last gap (after the last
 * paragraph) is "end of body", the only placement that used to exist.
 */
function ImagePlacementPreview({
  body,
  attachments,
  onDropAttachment,
  onRemoveAttachment,
  onToggleSaveToLibrary,
}: {
  body: string;
  attachments: ImageAttachment[];
  onDropAttachment: (key: string, gapIndex: number | undefined) => void;
  onRemoveAttachment: (key: string) => void;
  onToggleSaveToLibrary: (localId: string, value: boolean) => void;
}) {
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);

  const paragraphs = splitBodyIntoParagraphs(body);
  const lastGap = paragraphs.length - 1;

  function attachmentsAtGap(gap: number): ImageAttachment[] {
    return attachments.filter((a) => {
      const pos = a.positionAfterParagraph;
      const resolvedGap =
        pos !== undefined && pos >= 0 && pos <= lastGap ? pos : lastGap;

      return resolvedGap === gap;
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, gap: number) {
    event.preventDefault();
    setDragOverGap(null);

    const key = event.dataTransfer.getData("text/plain");
    if (!key) return;

    onDropAttachment(key, gap === lastGap ? undefined : gap);
  }

  function renderGap(gap: number) {
    const here = attachmentsAtGap(gap);
    const isActive = dragOverGap === gap;

    return (
      <div
        key={`gap-${gap}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverGap(gap);
        }}
        onDragLeave={() =>
          setDragOverGap((current) => (current === gap ? null : current))
        }
        onDrop={(event) => handleDrop(event, gap)}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          minHeight: 26,
          padding: "4px 6px",
          margin: "3px 0",
          border: `1px dashed ${isActive ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 6,
          background: isActive ? "var(--accent-soft)" : "transparent",
        }}
      >
        {here.length === 0 ? (
          <span className="small muted" style={{ opacity: 0.6 }}>
            {gap === lastGap ? "Drop image here (end of email)" : "Drop image here"}
          </span>
        ) : (
          here.map((a) => (
            <div
              key={a.key}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData("text/plain", a.key)
              }
              title={`${a.name} (${formatBytes(a.sizeBytes)})`}
              className="small"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "2px 6px",
                cursor: "grab",
                background: "var(--surface)",
              }}
            >
              {a.previewSrc && (
                <img
                  src={a.previewSrc}
                  alt={a.name}
                  style={{
                    width: 20,
                    height: 20,
                    objectFit: "cover",
                    borderRadius: 3,
                  }}
                />
              )}

              <span>{a.name}</span>

              {a.isPending && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    cursor: "pointer",
                  }}
                  title="Save this image to the reusable library instead of deleting it after this send"
                >
                  <input
                    type="checkbox"
                    checked={a.isLibraryImage}
                    onChange={(event) =>
                      onToggleSaveToLibrary(
                        a.key.slice(2),
                        event.target.checked,
                      )
                    }
                  />
                  library
                </label>
              )}

              <button
                type="button"
                onClick={() => onRemoveAttachment(a.key)}
                aria-label={`Remove ${a.name}`}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--muted)",
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 10,
      }}
    >
      {paragraphs.map((paragraph, i) => (
        <div key={`para-${i}`}>
          <div
            className="small muted"
            style={{ padding: "4px 6px", whiteSpace: "pre-wrap" }}
          >
            {paragraph || <em>(empty paragraph)</em>}
          </div>

          {renderGap(i)}
        </div>
      ))}
    </div>
  );
}

export default function OutreachGenerator({
  initialRequest,
  recipientPrefill,
}: {
  initialRequest?: OutreachPrefill | null;
  recipientPrefill?: OutreachRecipientPrefill | null;
}) {

  const editorStyle = {
    width: "100%",
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "inherit",
  } as const;

  const [scope, setScope] = useState<CampaignScope>("industry");

  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [context, setContext] = useState("");

  const [campaign, setCampaign] = useState<GeneratedCampaign | null>(null);

  const [revisionInstruction, setRevisionInstruction] = useState("");

  const [generating, setGenerating] = useState(false);
  const [revising, setRevising] = useState(false);

  const [savingDoc, setSavingDoc] = useState(false);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [docUpdated, setDocUpdated] = useState(false);

  const [gmassRecipients, setGmassRecipients] = useState("");
  const [gmassSheetSource, setGmassSheetSource] =
    useState<Omit<OutreachRecipientPrefill, "requestId"> | null>(null);
  const [creatingGmassSequence, setCreatingGmassSequence] = useState(false);
  const [gmassSuccess, setGmassSuccess] = useState<string | null>(null);
  const [gmassError, setGmassError] = useState<string | null>(null);

  const [saveTarget, setSaveTarget] = useState<"new" | "existing">("new");
  const [existingDocs, setExistingDocs] = useState<
    { id: string; name: string }[]
  >([]);
  const [existingDocsLoading, setExistingDocsLoading] = useState(false);
  const [existingDocsError, setExistingDocsError] = useState<string | null>(
    null,
  );
  const [selectedDocId, setSelectedDocId] = useState("");

  const [docTabs, setDocTabs] = useState<
    { tabId: string; title: string; nestingLevel: number }[]
  >([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [selectedTabId, setSelectedTabId] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [imagePickerForIndex, setImagePickerForIndex] = useState<
    number | null
  >(null);
  const [driveImages, setDriveImages] = useState<EmailImage[]>([]);
  const [driveImagesLoading, setDriveImagesLoading] = useState(false);
  const [driveImagesError, setDriveImagesError] = useState<string | null>(
    null,
  );
  const [imageError, setImageError] = useState<string | null>(null);

  const processedRequestId = useRef<number | null>(null);
  const processedRecipientRequestId = useRef<number | null>(null);

  useEffect(() => {
    if (!recipientPrefill) return;
    if (processedRecipientRequestId.current === recipientPrefill.requestId) return;

    processedRecipientRequestId.current = recipientPrefill.requestId;

    setGmassSheetSource({
      spreadsheetId: recipientPrefill.spreadsheetId,
      spreadsheetName: recipientPrefill.spreadsheetName,
      spreadsheetUrl: recipientPrefill.spreadsheetUrl,
    });
    setGmassError(null);
    setGmassSuccess(null);
  }, [recipientPrefill]);

  useEffect(() => {
    if (!initialRequest) return;
  
    // Prevent the same news trigger from generating twice.
    if (processedRequestId.current === initialRequest.requestId) {
      return;
    }
  
    processedRequestId.current = initialRequest.requestId;
  
    const nextCompany = initialRequest.company.trim();
    const nextIndustry = initialRequest.industry?.trim() || "";
    const nextContext = initialRequest.context.trim();
  
    setScope("company");
    setCompany(nextCompany);
    setIndustry(nextIndustry);
    setContext(nextContext);
  
    setCampaign(null);
    setRevisionInstruction("");
    setError(null);
  
    setDocId(null);
    setDocUrl(null);
    setDocUpdated(false);
    setDocError(null);
  
    if (!initialRequest.autoGenerate) {
      return;
    }
  
    if (!nextCompany) {
      setError(
        "This news trigger does not have a company name to generate outreach for.",
      );
      return;
    }
  
    async function generateFromNewsTrigger() {
      setGenerating(true);
  
      try {
        const response = await fetch("/api/generate-template", {
          method: "POST",
  
          headers: {
            "Content-Type": "application/json",
          },
  
          body: JSON.stringify({
            scope: "company",
            company: nextCompany,
            industry: nextIndustry || undefined,
            context: nextContext || undefined,
          }),
        });
  
        const data = await response.json();
  
        if (!response.ok) {
          throw new Error(
            data.error || "Template generation failed.",
          );
        }
  
        setCampaign(data);
        setRevisionInstruction("");
  
        setDocId(null);
        setDocUrl(null);
        setDocUpdated(false);
        setDocError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Template generation failed.",
        );
      } finally {
        setGenerating(false);
      }
    }
  
    void generateFromNewsTrigger();
  }, [initialRequest]);

  async function generateCampaign() {
    setError(null);

    if (scope === "company" && !company.trim()) {
      setError("Enter a company name.");
      return;
    }

    if (scope === "industry" && !industry.trim()) {
      setError("Enter an industry.");
      return;
    }

    setGenerating(true);

    try {
      const response = await fetch("/api/generate-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope,
          company: company.trim() || undefined,
          industry: industry.trim() || undefined,
          context: context.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Template generation failed.");
      }

      setCampaign(data);
      setRevisionInstruction("");

      setDocId(null);
      setDocUrl(null);
      setDocUpdated(false);

    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Template generation failed.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function reviseCampaign() {
    if (!campaign) return;

    const instruction = revisionInstruction.trim();

    if (!instruction) {
      setError("Tell the generator what you want to change.");
      return;
    }

    setError(null);
    setRevising(true);

    try {
      const response = await fetch("/api/generate-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: campaign.scope,
          company: company.trim() || undefined,
          industry: industry.trim() || undefined,
          context: context.trim() || undefined,
          currentCampaign: {
            ...campaign,
            emails: campaign.emails.map(
              ({ label, topic, subject, body }) => ({
                label,
                topic,
                subject,
                body,
              }),
            ),
          },
          revisionInstruction: instruction,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Campaign revision failed.");
      }

      setCampaign(mergeImagesIntoRevisedCampaign(campaign, data));
      setRevisionInstruction("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Campaign revision failed.",
      );
    } finally {
      setRevising(false);
    }
  }

  function updateEmail(
    index: number,
    field: keyof CampaignEmail,
    value: string,
  ) {
    if (!campaign) return;

    setCampaign({
      ...campaign,
      emails: campaign.emails.map((email, emailIndex) =>
        emailIndex === index
          ? {
              ...email,
              [field]: value,
            }
          : email,
      ),
    });
  }

  function updateCampaignName(value: string) {
    if (!campaign) return;

    setCampaign({
      ...campaign,
      campaignName: value,
    });
  }

  function updateRationale(value: string) {
    if (!campaign) return;

    setCampaign({
      ...campaign,
      sequenceRationale: value,
    });
  }

  function totalImageBytes(email: CampaignEmail): number {
    const resolved = (email.images ?? []).reduce(
      (sum, img) => sum + img.sizeBytes,
      0,
    );

    const pending = (email.pendingImages ?? []).reduce(
      (sum, img) => sum + img.sizeBytes,
      0,
    );

    return resolved + pending;
  }

  function addImageToEmail(index: number, image: EmailImage) {
    if (!campaign) return;

    setCampaign({
      ...campaign,
      emails: campaign.emails.map((email, emailIndex) =>
        emailIndex === index
          ? { ...email, images: [...(email.images ?? []), image] }
          : email,
      ),
    });
  }

  /** Removes an attachment by its unified ImageAttachment key ("r:<id>" for
   *  an already-resolved image, "p:<localId>" for a pending one). Revokes
   *  the pending image's preview blob URL before dropping it. */
  function removeAttachment(index: number, key: string) {
    if (!campaign) return;

    const kind = key.slice(0, 1);
    const id = key.slice(2);

    if (kind === "p") {
      const pending = campaign.emails[index]?.pendingImages?.find(
        (img) => img.localId === id,
      );

      if (pending) URL.revokeObjectURL(pending.previewUrl);
    }

    setCampaign({
      ...campaign,
      emails: campaign.emails.map((email, emailIndex) => {
        if (emailIndex !== index) return email;

        if (kind === "r") {
          return {
            ...email,
            images: (email.images ?? []).filter((img) => img.id !== id),
          };
        }

        return {
          ...email,
          pendingImages: (email.pendingImages ?? []).filter(
            (img) => img.localId !== id,
          ),
        };
      }),
    });
  }

  /** Sets which paragraph gap an attachment (pending or resolved) should be
   *  inserted after. `gapIndex` of undefined means "end of body". */
  function setImagePosition(
    index: number,
    key: string,
    gapIndex: number | undefined,
  ) {
    if (!campaign) return;

    const kind = key.slice(0, 1);
    const id = key.slice(2);

    setCampaign({
      ...campaign,
      emails: campaign.emails.map((email, emailIndex) => {
        if (emailIndex !== index) return email;

        if (kind === "r") {
          return {
            ...email,
            images: (email.images ?? []).map((img) =>
              img.id === id
                ? { ...img, positionAfterParagraph: gapIndex }
                : img,
            ),
          };
        }

        return {
          ...email,
          pendingImages: (email.pendingImages ?? []).map((img) =>
            img.localId === id
              ? { ...img, positionAfterParagraph: gapIndex }
              : img,
          ),
        };
      }),
    });
  }

  function setPendingImageSaveToLibrary(
    index: number,
    localId: string,
    saveToLibrary: boolean,
  ) {
    if (!campaign) return;

    setCampaign({
      ...campaign,
      emails: campaign.emails.map((email, emailIndex) =>
        emailIndex === index
          ? {
              ...email,
              pendingImages: (email.pendingImages ?? []).map((img) =>
                img.localId === localId ? { ...img, saveToLibrary } : img,
              ),
            }
          : email,
      ),
    });
  }

  async function loadDriveImages() {
    if (driveImages.length > 0 || driveImagesLoading) return;

    setDriveImagesLoading(true);
    setDriveImagesError(null);

    try {
      const response = await fetch("/api/images");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load images.");
      }

      setDriveImages(data.images || []);
    } catch (err) {
      setDriveImagesError(
        err instanceof Error ? err.message : "Failed to load images.",
      );
    } finally {
      setDriveImagesLoading(false);
    }
  }

  function openImagePicker(index: number) {
    setImagePickerForIndex(index);
    setImageError(null);
    loadDriveImages();
  }

  function closeImagePicker() {
    setImagePickerForIndex(null);
    setImageError(null);
  }

  function pickDriveImageForEmail(index: number, image: EmailImage) {
    const email = campaign?.emails[index];
    if (!email) return;

    if ((email.images ?? []).some((img) => img.id === image.id)) {
      setImageError("That image is already attached to this email.");
      return;
    }

    if (totalImageBytes(email) + image.sizeBytes > MAX_TOTAL_IMAGE_BYTES_PER_EMAIL) {
      setImageError(
        `Adding this image would exceed the ${formatBytes(
          MAX_TOTAL_IMAGE_BYTES_PER_EMAIL,
        )} per-email limit.`,
      );
      return;
    }

    addImageToEmail(index, image);
    setImageError(null);
  }

  /** Picking a file from the device is purely client-side now — no upload
   *  happens until the campaign is actually saved (see resolvePendingImages
   *  in saveToGoogleDoc). */
  function addPendingImageToEmail(index: number, file: File) {
    setImageError(null);

    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
      setImageError("Only JPEG, PNG, and GIF images are supported.");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `Image is too large (max ${formatBytes(MAX_IMAGE_BYTES)} per image).`,
      );
      return;
    }

    if (!campaign) return;

    const email = campaign.emails[index];

    if (
      email &&
      totalImageBytes(email) + file.size > MAX_TOTAL_IMAGE_BYTES_PER_EMAIL
    ) {
      setImageError(
        `Adding this image would exceed the ${formatBytes(
          MAX_TOTAL_IMAGE_BYTES_PER_EMAIL,
        )} per-email limit.`,
      );
      return;
    }

    const pendingImage: PendingEmailImage = {
      localId:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      saveToLibrary: false,
    };

    setCampaign({
      ...campaign,
      emails: campaign.emails.map((e, i) =>
        i === index
          ? { ...e, pendingImages: [...(e.pendingImages ?? []), pendingImage] }
          : e,
      ),
    });
  }

  async function copyCampaign() {
    if (!campaign) return;

    const text = campaign.emails
      .map((email) => {
        const imageCount = getEmailAttachments(email).length;
        const imageNote = imageCount
          ? `\n\n[${imageCount} image${
              imageCount > 1 ? "s" : ""
            } attached — see Google Doc]`
          : "";

        return `${email.label}\n${email.topic}\n\nSubject: ${email.subject}\n\n${email.body}${imageNote}`;
      })
      .join("\n\n------------------------------\n\n");

    await navigator.clipboard.writeText(text);
  }

  async function loadExistingDocs() {
    if (existingDocs.length > 0 || existingDocsLoading) return;

    setExistingDocsLoading(true);
    setExistingDocsError(null);

    try {
      const response = await fetch("/api/docs?listFolder=1");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load Google Docs.",
        );
      }

      const docs: { id: string; name: string }[] = data.docs || [];
      setExistingDocs(docs);

      const hub = docs.find((d) =>
        d.name.toLowerCase().includes("voncierge outreach"),
      );

      if (hub) {
        setSelectedDocId(hub.id);
      } else if (docs.length > 0) {
        setSelectedDocId(docs[0].id);
      }
    } catch (err) {
      setExistingDocsError(
        err instanceof Error
          ? err.message
          : "Failed to load Google Docs.",
      );
    } finally {
      setExistingDocsLoading(false);
    }
  }

  useEffect(() => {
    if (saveTarget !== "existing" || !selectedDocId) return;

    let cancelled = false;

    async function loadTabs() {
      setTabsLoading(true);
      setTabsError(null);
      setSelectedTabId("");

      try {
        const response = await fetch(
          `/api/docs?tabs=1&documentId=${encodeURIComponent(selectedDocId)}`,
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Failed to load document tabs.",
          );
        }

        if (!cancelled) {
          setDocTabs(data.tabs || []);
        }
      } catch (err) {
        if (!cancelled) {
          setTabsError(
            err instanceof Error
              ? err.message
              : "Failed to load document tabs.",
          );
        }
      } finally {
        if (!cancelled) {
          setTabsLoading(false);
        }
      }
    }

    loadTabs();

    return () => {
      cancelled = true;
    };
  }, [saveTarget, selectedDocId]);

  async function uploadPendingImage(
    pending: PendingEmailImage,
  ): Promise<EmailImage> {
    const formData = new FormData();
    formData.append("file", pending.file);
    formData.append("saveToLibrary", String(pending.saveToLibrary));

    const response = await fetch("/api/images", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Failed to upload ${pending.name}.`);
    }

    return {
      ...(data as EmailImage),
      positionAfterParagraph: pending.positionAfterParagraph,
    };
  }

  /**
   * Uploads every pending image to Drive (staging or library, per its
   * saveToLibrary flag) and merges the results into each email's `images`
   * array, ready to send to /api/docs. Uses allSettled so one failed upload
   * doesn't strand the others mid-flight, but the whole save still aborts
   * if anything failed — a campaign email silently missing an image it
   * looked attached to is worse than just asking the user to retry.
   */
  async function resolvePendingImages(
    emails: CampaignEmail[],
  ): Promise<{ emails: CampaignEmail[]; resolvedByKey: Map<string, EmailImage> }> {
    const items: { emailIndex: number; localId: string; pending: PendingEmailImage }[] = [];

    emails.forEach((email, emailIndex) => {
      for (const pending of email.pendingImages ?? []) {
        items.push({ emailIndex, localId: pending.localId, pending });
      }
    });

    const resolvedByKey = new Map<string, EmailImage>();

    if (items.length > 0) {
      const settled = await Promise.allSettled(
        items.map((item) => uploadPendingImage(item.pending)),
      );

      const failed: string[] = [];

      settled.forEach((result, i) => {
        const item = items[i];

        if (result.status === "fulfilled") {
          resolvedByKey.set(`${item.emailIndex}:${item.localId}`, result.value);
        } else {
          failed.push(item.pending.name);
        }
      });

      if (failed.length > 0) {
        throw new Error(
          `Failed to upload: ${failed.join(", ")}. Nothing was saved — try again.`,
        );
      }
    }

    const resolvedEmails = emails.map((email, emailIndex) => {
      const newlyResolved = (email.pendingImages ?? [])
        .map((p) => resolvedByKey.get(`${emailIndex}:${p.localId}`))
        .filter((img): img is EmailImage => Boolean(img));

      return {
        ...email,
        images: [...(email.images ?? []), ...newlyResolved],
      };
    });

    return { emails: resolvedEmails, resolvedByKey };
  }

  async function saveToGoogleDoc() {
    if (!campaign) return;

    setSavingDoc(true);
    setDocError(null);
    setDocUpdated(false);
    setDocUrl(null);

    const emailsAtSaveTime = campaign.emails;

    try {
      const { emails: resolvedEmails, resolvedByKey } =
        await resolvePendingImages(emailsAtSaveTime);

      const response = await fetch("/api/docs", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          documentId:
            saveTarget === "existing"
              ? selectedDocId
              : docId || undefined,
          ...(saveTarget === "existing"
            ? { tabId: selectedTabId }
            : {}),
          campaignName: campaign.campaignName,
          scope: campaign.scope,
          sequenceRationale:
            campaign.sequenceRationale,
          emails: resolvedEmails.map(({ pendingImages, ...email }) => email),

          company:
            scope === "company"
              ? company.trim() || undefined
              : undefined,

          industry:
            industry.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to save Google Doc.",
        );
      }

      setDocUrl(data.url);
      setDocUpdated(Boolean(data.updated));

      if (saveTarget === "new") {
        setDocId(data.documentId);
      }

      // Library images now persist in Drive, so fold them into permanent
      // `images` state and drop their pending entry. Ephemeral (non-library)
      // images were deleted from Drive right after being embedded — their
      // pending entry (with the original File) has to stay so the next save
      // re-uploads them fresh instead of referencing a now-dead Drive id.
      setCampaign((current) => {
        if (!current) return current;

        return {
          ...current,
          emails: current.emails.map((email, emailIndex) => {
            const savedPending = emailsAtSaveTime[emailIndex]?.pendingImages ?? [];

            if (savedPending.length === 0) return email;

            const savedPendingIds = new Set(
              savedPending.map((p) => p.localId),
            );

            const newlyLibraryImages: EmailImage[] = [];

            for (const p of savedPending) {
              if (!p.saveToLibrary) continue;

              const resolved = resolvedByKey.get(`${emailIndex}:${p.localId}`);
              if (resolved) newlyLibraryImages.push(resolved);
              URL.revokeObjectURL(p.previewUrl);
            }

            return {
              ...email,
              images: [...(email.images ?? []), ...newlyLibraryImages],
              pendingImages: (email.pendingImages ?? []).filter((p) => {
                const wasPartOfThisSave = savedPendingIds.has(p.localId);
                return !(wasPartOfThisSave && p.saveToLibrary);
              }),
            };
          }),
        };
      });
    } catch (err) {
      setDocError(
        err instanceof Error
          ? err.message
          : "Failed to save Google Doc.",
      );
    } finally {
      setSavingDoc(false);
    }
  }

  async function createGmassSequence() {
    if (!campaign) return;

    if (campaign.emails.length === 0) {
      setGmassError("This campaign does not contain any emails.");
      return;
    }

    const recipients = gmassRecipients.trim();

    if (!gmassSheetSource && !recipients) {
      setGmassError("Enter at least one recipient email address.");
      return;
    }

    setCreatingGmassSequence(true);
    setGmassError(null);
    setGmassSuccess(null);

    try {
      const response = await fetch("/api/gmass/create-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emails: campaign.emails.map(({ label, topic, subject, body }) => ({
            label,
            topic,
            subject,
            body,
          })),
          ...(gmassSheetSource
            ? {
                sheetTarget: {
                  spreadsheetId: gmassSheetSource.spreadsheetId,
                  spreadsheetName: gmassSheetSource.spreadsheetName,
                },
              }
            : { emailAddresses: recipients }),
          campaignName: campaign.campaignName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail =
          typeof data.details === "string"
            ? data.details
            : data.details
              ? JSON.stringify(data.details)
              : "";

        throw new Error(
          detail ||
            data.error ||
            "Failed to create GMass rich-text sequence.",
        );
      }

      setGmassSuccess(
        "GMass rich-text sequence created successfully in Amanda's account.",
      );
    } catch (err) {
      setGmassError(
        err instanceof Error
          ? err.message
          : "Failed to create GMass rich-text sequence.",
      );
    } finally {
      setCreatingGmassSequence(false);
    }
  }

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 6 }}>Outreach Generator</h2>

        <div className="small muted">
          Generate company-specific or reusable industry outreach sequences.
        </div>
      </div>

      <div
        className="row"
        style={{
          alignItems: "flex-end",
          marginBottom: 16,
        }}
      >
        <div className="field">
          <label htmlFor="outreach-scope">Campaign type</label>

          <select
            id="outreach-scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as CampaignScope);
              setCampaign(null);
              setError(null);
            }}
            disabled={generating || revising}
          >
            <option value="industry">Industry-wide</option>
            <option value="company">Company-specific</option>
          </select>
        </div>

        {scope === "company" && (
          <div className="field">
            <label htmlFor="outreach-company">Company</label>

            <input
              id="outreach-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder="e.g. OCBC"
              disabled={generating || revising}
              style={{
                ...editorStyle,
                minWidth: 240,
              }}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="outreach-industry">
            Industry {scope === "company" ? "(optional)" : ""}
          </label>

          <input
            id="outreach-industry"
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            placeholder="e.g. banking"
            disabled={generating || revising}
            style={{
                ...editorStyle,
                minWidth: 240,
            }}
          />
        </div>
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="outreach-context">Additional context</label>

        <textarea
          id="outreach-context"
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder={
            scope === "company"
              ? "Anything useful about the company, their current CX setup, AI initiatives, competitors, pain points, or who you are targeting..."
              : "Anything you want the sequence to emphasise for this industry..."
          }
          rows={5}
          disabled={generating || revising}
          style={{
            width: "100%",
            resize: "vertical",
          }}
        />
      </div>

      <button onClick={generateCampaign} disabled={generating || revising}>
        {generating ? (
            <>
            <span className="spinner" />
            Generating outreach…
            </>
        ) : campaign ? (
            "Generate New Sequence"
        ) : (
            "Generate Sequence"
        )}
      </button>

      {generating && (
        <div
            className="small muted"
            style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            }}
        >
            Reading outreach guidelines and building your sequence. This can take around
            15–30 seconds.
        </div>
      )}

      {error && (
        <div
          className="notice"
          style={{
            marginTop: 16,
            color: "var(--bad)",
          }}
        >
          {error}
        </div>
      )}

      {campaign && (
        <div style={{ marginTop: 28 }}>
          <hr style={{ marginBottom: 24 }} />

          <div className="field" style={{ marginBottom: 18 }}>
            <label>Campaign name</label>

            <input
              value={campaign.campaignName}
              onChange={(event) => updateCampaignName(event.target.value)}
              style={editorStyle}
            />
          </div>

          <div className="field" style={{ marginBottom: 24 }}>
            <label>Sequence rationale</label>

            <textarea
              value={campaign.sequenceRationale}
              onChange={(event) => updateRationale(event.target.value)}
              rows={4}
              style={{
                ...editorStyle,
                resize: "vertical",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {campaign.emails.map((email, index) => (
              <div
                key={`${email.label}-${index}`}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 16,
                }}
              >
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Email label</label>

                  <input
                    value={email.label}
                    onChange={(event) =>
                      updateEmail(index, "label", event.target.value)
                    }
                    style={editorStyle}
                  />
                </div>

                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Topic</label>

                  <input
                    value={email.topic}
                    onChange={(event) =>
                      updateEmail(index, "topic", event.target.value)
                    }
                    style={editorStyle}
                  />
                </div>

                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Subject</label>

                  <input
                    value={email.subject}
                    onChange={(event) =>
                      updateEmail(index, "subject", event.target.value)
                    }
                    style={editorStyle}
                  />
                </div>

                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Body</label>

                  <textarea
                    value={email.body}
                    onChange={(event) =>
                      updateEmail(index, "body", event.target.value)
                    }
                    rows={Math.max(8, email.body.split("\n").length + 2)}
                    style={{
                        ...editorStyle,
                        resize: "vertical",
                        lineHeight: 1.5,
                    }}
                  />
                </div>

                <div className="field">
                  <label>
                    Images
                    {totalImageBytes(email) > 0
                      ? ` (${formatBytes(totalImageBytes(email))} / ${formatBytes(
                          MAX_TOTAL_IMAGE_BYTES_PER_EMAIL,
                        )})`
                      : ""}
                  </label>

                  {getEmailAttachments(email).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="small muted" style={{ marginBottom: 6 }}>
                        Drag an image onto the preview below to choose where
                        it's inserted in the body.
                      </div>

                      <ImagePlacementPreview
                        body={email.body}
                        attachments={getEmailAttachments(email)}
                        onDropAttachment={(key, gapIndex) =>
                          setImagePosition(index, key, gapIndex)
                        }
                        onRemoveAttachment={(key) =>
                          removeAttachment(index, key)
                        }
                        onToggleSaveToLibrary={(localId, value) =>
                          setPendingImageSaveToLibrary(index, localId, value)
                        }
                      />
                    </div>
                  )}

                  <div className="row" style={{ gap: 8 }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        background: "var(--accent)",
                        color: "var(--on-accent)",
                        border: "1px solid transparent",
                        borderRadius: "var(--radius-sm)",
                        padding: "9px 15px",
                        fontWeight: 550,
                        cursor: "pointer",
                      }}
                    >
                      Upload from device
                      <input
                        type="file"
                        accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) addPendingImageToEmail(index, file);
                        }}
                        style={{ display: "none" }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        imagePickerForIndex === index
                          ? closeImagePicker()
                          : openImagePicker(index)
                      }
                    >
                      {imagePickerForIndex === index
                        ? "Close Drive picker"
                        : "Choose from Drive"}
                    </button>
                  </div>

                  {imagePickerForIndex === index && (
                    <div
                      style={{
                        marginTop: 10,
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                      }}
                    >
                      {driveImagesLoading ? (
                        <div className="small muted">
                          Loading images from Drive…
                        </div>
                      ) : driveImagesError ? (
                        <div className="small" style={{ color: "var(--bad)" }}>
                          {driveImagesError}
                        </div>
                      ) : driveImages.length === 0 ? (
                        <div className="small muted">
                          No images in the Email Images Drive folder yet.
                          Upload one from your device to add it here.
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          {driveImages.map((image) => (
                            <button
                              type="button"
                              key={image.id}
                              onClick={() =>
                                pickDriveImageForEmail(index, image)
                              }
                              title={`${image.name} (${formatBytes(image.sizeBytes)})`}
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: 4,
                                cursor: "pointer",
                                background: "var(--surface)",
                                width: 64,
                                height: 64,
                              }}
                            >
                              {image.thumbnailLink ? (
                                <img
                                  src={image.thumbnailLink}
                                  alt={image.name}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    borderRadius: 4,
                                  }}
                                />
                              ) : (
                                <span className="small">{image.name}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {imageError && (
                    <div
                      className="small"
                      style={{ marginTop: 8, color: "var(--bad)" }}
                    >
                      {imageError}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 28,
              padding: 18,
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>
              Ask AI to revise this sequence
            </h3>

            <div
              className="small muted"
              style={{
                marginBottom: 12,
              }}
            >
              Tell it exactly what to change. Everything else should stay as
              close to the current version as possible.
            </div>

            <textarea
              value={revisionInstruction}
              onChange={(event) =>
                setRevisionInstruction(event.target.value)
              }
              placeholder="e.g. Make the main email more competitor-aware. Keep all other emails the same."
              rows={4}
              disabled={revising || generating}
              style={{
                ...editorStyle,
                resize: "vertical",
                marginBottom: 12,
              }}
            />

            <div
              className="row"
              style={{
                alignItems: "flex-end",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div className="field">
                <label htmlFor="doc-save-target">Save destination</label>

                <select
                  id="doc-save-target"
                  value={saveTarget}
                  onChange={(e) => {
                    const value = e.target.value as "new" | "existing";
                    setSaveTarget(value);
                    if (value === "existing") {
                      loadExistingDocs();
                    }
                  }}
                  disabled={savingDoc}
                >
                  <option value="new">Create new Google Doc</option>
                  <option value="existing">
                    Insert into existing Google Doc
                  </option>
                </select>
              </div>

              {saveTarget === "existing" && (
                <>
                  <div className="field">
                    <label htmlFor="doc-existing-doc">Google Doc</label>

                    {existingDocsLoading ? (
                      <div className="small muted">Loading docs…</div>
                    ) : existingDocsError ? (
                      <div className="small" style={{ color: "var(--bad)" }}>
                        {existingDocsError}
                      </div>
                    ) : existingDocs.length === 0 ? (
                      <div className="small muted">
                        No existing Docs found in the configured folder.
                      </div>
                    ) : (
                      <select
                        id="doc-existing-doc"
                        value={selectedDocId}
                        onChange={(e) => setSelectedDocId(e.target.value)}
                        disabled={savingDoc}
                      >
                        {existingDocs.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="doc-existing-tab">Tab</label>

                    {tabsLoading ? (
                      <div className="small muted">Loading tabs…</div>
                    ) : tabsError ? (
                      <div className="small" style={{ color: "var(--bad)" }}>
                        {tabsError}
                      </div>
                    ) : (
                      <select
                        id="doc-existing-tab"
                        value={selectedTabId}
                        onChange={(e) => setSelectedTabId(e.target.value)}
                        disabled={savingDoc || !selectedDocId}
                      >
                        <option value="">Document root / first tab</option>
                        {docTabs.map((tab) => (
                          <option key={tab.tabId} value={tab.tabId}>
                            {"— ".repeat(tab.nestingLevel) + tab.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}
            </div>

            <div
              className="row"
              style={{
                alignItems: "center",
                gap: 10,
              }}
            >
              <button
                onClick={reviseCampaign}
                disabled={
                  revising ||
                  generating ||
                  !revisionInstruction.trim()
                }
              >
                {revising ? "Applying Changes…" : "Apply Changes"}
              </button>

              <button
                type="button"
                onClick={copyCampaign}
                disabled={revising || generating}
              >
                Copy Full Sequence
              </button>

              <button
                type="button"
                onClick={saveToGoogleDoc}
                disabled={
                    revising ||
                    generating ||
                    savingDoc ||
                    (saveTarget === "existing" && !selectedDocId)
                }
                >
                {savingDoc ? (
                    <>
                        <span className="spinner" />
                        {saveTarget === "existing" ? "Inserting…" : docId ? "Updating…" : "Saving…"}
                    </>
                    ) : saveTarget === "existing" ? (
                    "Insert into Google Doc"
                    ) : docId ? (
                    "Update Google Doc"
                    ) : (
                    "Save to Google Doc"
                )}
              </button>

              {docUrl && (
                <div
                    className="notice info"
                    style={{ marginTop: 14 }}
                >
                    <div>
                    {saveTarget === "existing"
                        ? "Inserted into Google Doc successfully."
                        : docUpdated
                        ? "Google Doc updated successfully."
                        : "Google Doc created successfully."}{" "}
                    <a
                        href={docUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Open Google Doc
                    </a>
                    </div>
                </div>
              )}

              {docError && (
                <div
                  className="notice error"
                  style={{ marginTop: 14 }}
                >
                  {docError}
                </div>
              )}

            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              padding: 18,
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>
              Send to GMass
            </h3>

            <div
              className="small muted"
              style={{ marginBottom: 14, lineHeight: 1.5 }}
            >
              Creates the full campaign as a GMass rich-text sequence. Follow-ups
              use the generated emails and stay in the same thread. Nothing should
              be launched automatically; review the campaign in Amanda&apos;s GMass
              account before sending.
            </div>

            {gmassSheetSource ? (
              <div className="notice info" style={{ marginBottom: 12 }}>
                <div>
                  Recipient source: <strong>{gmassSheetSource.spreadsheetName}</strong>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {gmassSheetSource.spreadsheetUrl && (
                    <a
                      href={gmassSheetSource.spreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Google Sheet
                    </a>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setGmassSheetSource(null);
                      setGmassError(null);
                      setGmassSuccess(null);
                    }}
                    disabled={creatingGmassSequence}
                  >
                    Use email addresses instead
                  </button>
                </div>
              </div>
            ) : (
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="gmass-recipients">Recipient email(s)</label>

                <textarea
                  id="gmass-recipients"
                  value={gmassRecipients}
                  onChange={(event) => {
                    setGmassRecipients(event.target.value);
                    setGmassError(null);
                    setGmassSuccess(null);
                  }}
                  placeholder="e.g. john@company.com, jane@company.com"
                  rows={3}
                  disabled={creatingGmassSequence}
                  style={{
                    ...editorStyle,
                    resize: "vertical",
                  }}
                />
              </div>
            )}

            <div className="small muted" style={{ marginBottom: 14 }}>
              Sequence: <strong>{campaign.emails.length} emails</strong>
            </div>

            <button
              type="button"
              onClick={createGmassSequence}
              disabled={
                creatingGmassSequence ||
                (!gmassSheetSource && !gmassRecipients.trim()) ||
                campaign.emails.length === 0
              }
            >
              {creatingGmassSequence ? (
                <>
                  <span className="spinner" />
                  Creating GMass Sequence…
                </>
              ) : (
                "Create GMass Sequence"
              )}
            </button>

            {gmassSuccess && (
              <div className="notice info" style={{ marginTop: 14 }}>
                {gmassSuccess}
              </div>
            )}

            {gmassError && (
              <div className="notice error" style={{ marginTop: 14 }}>
                {gmassError}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
