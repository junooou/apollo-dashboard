"use client";

import { useEffect, useRef, useState } from "react";

type CampaignScope = "company" | "industry";

export type OutreachPrefill = {
  requestId: number;
  company: string;
  industry?: string;
  context: string;
  autoGenerate?: boolean;
};

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
};

type GeneratedCampaign = {
  campaignName: string;
  scope: CampaignScope;
  sequenceRationale: string;
  emails: CampaignEmail[];
};

export default function OutreachGenerator({
  initialRequest,
}: {
  initialRequest?: OutreachPrefill | null;
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

  const processedRequestId = useRef<number | null>(null);

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
          currentCampaign: campaign,
          revisionInstruction: instruction,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Campaign revision failed.");
      }

      setCampaign(data);
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

  async function copyCampaign() {
    if (!campaign) return;

    const text = campaign.emails
      .map(
        (email) =>
          `${email.label}\n${email.topic}\n\nSubject: ${email.subject}\n\n${email.body}`,
      )
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

  async function saveToGoogleDoc() {
    if (!campaign) return;

    setSavingDoc(true);
    setDocError(null);
    setDocUpdated(false);
    setDocUrl(null);

    try {
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
          emails: campaign.emails,

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

                <div className="field">
                  <label>Body</label>

                  <textarea
                    value={email.body}
                    onChange={(event) =>
                      updateEmail(index, "body", event.target.value)
                    }
                    rows={8}
                    style={{
                        ...editorStyle,
                        resize: "vertical",
                        lineHeight: 1.5,
                    }}
                  />
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
        </div>
      )}
    </section>
  );
}