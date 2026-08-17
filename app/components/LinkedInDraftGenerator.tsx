"use client";

import { useEffect, useState } from "react";
import { Check } from "./Icons";

const CONNECTION_NOTE_LIMIT = 300;

type Contact = {
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  linkedinUrl: string;
  apolloPersonId: string;
  sheetId: string;
  sheetName: string;
  rowIndex: number;
  linkedinStatus?: string;
  linkedinSentAt?: string;
  seniority?: string;
  location?: string;
};

type DraftState = {
  message: string;
  generating: boolean;
  sending: boolean;
  sentAt?: string;
  error?: string;
};

/** Stable per-contact key — apolloPersonId can be blank on older rows, so the
 *  sheet + row is what's actually guaranteed unique. */
function contactKey(c: Contact): string {
  return `${c.sheetId}:${c.rowIndex}`;
}

export default function LinkedInDraftGenerator() {
  const editorStyle = {
    width: "100%",
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "inherit",
  } as const;

  const [companies, setCompanies] = useState<string[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);

  const [selectedCompany, setSelectedCompany] = useState("");
  const [context, setContext] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    async function loadCompanies() {
      setCompaniesLoading(true);
      setCompaniesError(null);
      try {
        const response = await fetch("/api/sheets?listCompanies=1");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load companies.");
        setCompanies(data.companies ?? []);
      } catch (err) {
        setCompaniesError(err instanceof Error ? err.message : "Failed to load companies.");
      } finally {
        setCompaniesLoading(false);
      }
    }
    void loadCompanies();
  }, []);

  async function selectCompany(company: string) {
    setSelectedCompany(company);
    setContacts([]);
    setSelectedKeys(new Set());
    setDrafts({});
    setError(null);
    setContactsError(null);

    if (!company) return;

    setContactsLoading(true);
    try {
      const response = await fetch(`/api/sheets?checkCompany=${encodeURIComponent(company)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load contacts.");

      const withLinkedin: Contact[] = (data.contacts ?? []).filter(
        (c: Contact) => c.linkedinUrl?.trim(),
      );
      setContacts(withLinkedin);
      setSelectedKeys(new Set(withLinkedin.filter((c) => !c.linkedinStatus).map(contactKey)));

      const initialDrafts: Record<string, DraftState> = {};
      for (const c of withLinkedin) {
        if (c.linkedinStatus) {
          initialDrafts[contactKey(c)] = {
            message: "",
            generating: false,
            sending: false,
            sentAt: c.linkedinSentAt,
          };
        }
      }
      setDrafts(initialDrafts);
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : "Failed to load contacts.");
    } finally {
      setContactsLoading(false);
    }
  }

  function toggleSelected(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function requestDrafts(targets: Contact[]) {
    const response = await fetch("/api/generate-linkedin-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: selectedCompany,
        context: context.trim() || undefined,
        contacts: targets.map((c) => ({
          key: contactKey(c),
          firstname: c.firstname,
          lastname: c.lastname,
          title: c.title,
          company: c.company,
          seniority: c.seniority,
          location: c.location,
        })),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Draft generation failed.");
    return data.drafts as { key: string; message: string }[];
  }

  async function generateAll() {
    const targets = contacts.filter((c) => selectedKeys.has(contactKey(c)));
    if (targets.length === 0) {
      setError("Select at least one contact.");
      return;
    }

    setError(null);
    setGeneratingAll(true);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const c of targets) {
        const key = contactKey(c);
        next[key] = { ...(next[key] ?? { message: "", sending: false }), generating: true, error: undefined };
      }
      return next;
    });

    try {
      const results = await requestDrafts(targets);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of results) {
          next[r.key] = { ...(next[r.key] ?? { sending: false }), message: r.message, generating: false };
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Draft generation failed.";
      setError(message);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of targets) {
          const key = contactKey(c);
          next[key] = { ...(next[key] ?? { message: "", sending: false }), generating: false };
        }
        return next;
      });
    } finally {
      setGeneratingAll(false);
    }
  }

  async function regenerateOne(contact: Contact) {
    const key = contactKey(contact);
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { message: "", sending: false }), generating: true, error: undefined },
    }));

    try {
      const results = await requestDrafts([contact]);
      const result = results.find((r) => r.key === key);
      setDrafts((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { sending: false }), message: result?.message ?? "", generating: false },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Draft generation failed.";
      setDrafts((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { message: "", sending: false }), generating: false, error: message },
      }));
    }
  }

  function updateDraftMessage(key: string, message: string) {
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { generating: false, sending: false }), message },
    }));
  }

  async function copyDraft(key: string, message: string) {
    await navigator.clipboard.writeText(message);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  async function markSent(contact: Contact) {
    const key = contactKey(contact);
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { message: "", generating: false }), sending: true, error: undefined },
    }));

    try {
      const response = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "markLinkedinSent",
          spreadsheetId: contact.sheetId,
          rowIndex: contact.rowIndex,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to record the send.");

      setDrafts((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { message: "", generating: false }), sending: false, sentAt: data.sentAt },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to record the send.";
      setDrafts((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { message: "", generating: false }), sending: false, error: message },
      }));
    }
  }

  const pendingContacts = contacts.filter((c) => !drafts[contactKey(c)]?.sentAt);
  const sentContacts = contacts.filter((c) => drafts[contactKey(c)]?.sentAt);

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
        <h2 style={{ marginBottom: 6 }}>LinkedIn Drafts</h2>
        <div className="small muted">
          Generate personalized connection notes for contacts you've already sourced —
          drawing on each contact's title, seniority and location, plus any matching
          News Trigger or Job Signal already surfaced for the company. Sending stays
          manual in LinkedIn — there is no compliant API to automate it, so this only
          drafts the message and lets you record that you sent it.
        </div>
      </div>

      <div className="row" style={{ alignItems: "flex-end", marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="linkedin-company">Company</label>
          <select
            id="linkedin-company"
            value={selectedCompany}
            onChange={(event) => void selectCompany(event.target.value)}
            disabled={companiesLoading}
            style={{ ...editorStyle, minWidth: 260 }}
          >
            <option value="">
              {companiesLoading ? "Loading companies…" : "Select a company…"}
            </option>
            {companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </div>
      </div>

      {companiesError && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          {companiesError}
        </div>
      )}

      {selectedCompany && (
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="linkedin-context">Additional context (optional)</label>
          <textarea
            id="linkedin-context"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Anything worth mentioning about this batch of contacts or the company right now..."
            rows={3}
            style={{ ...editorStyle, resize: "vertical" }}
          />
        </div>
      )}

      {contactsLoading && <div className="small muted">Loading contacts…</div>}

      {contactsError && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          {contactsError}
        </div>
      )}

      {!contactsLoading && selectedCompany && contacts.length === 0 && !contactsError && (
        <div className="small muted">
          No saved contacts with a LinkedIn URL found for {selectedCompany}.
        </div>
      )}

      {!contactsLoading && selectedCompany && contacts.length > 0 && pendingContacts.length === 0 && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <Check size={16} />
          <div>
            All {contacts.length} available contact{contacts.length === 1 ? "" : "s"} for{" "}
            {selectedCompany} {contacts.length === 1 ? "has" : "have"} already been contacted on
            LinkedIn.
          </div>
        </div>
      )}

      {pendingContacts.length > 0 && (
        <>
          <div
            className="row"
            style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}
          >
            <div className="small muted">
              {selectedKeys.size} of {pendingContacts.length} selected
            </div>
            <button onClick={generateAll} disabled={generatingAll || selectedKeys.size === 0}>
              {generatingAll ? (
                <>
                  <span className="spinner" />
                  Generating drafts…
                </>
              ) : (
                "Generate LinkedIn Drafts"
              )}
            </button>
          </div>

          {error && (
            <div className="notice error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {pendingContacts.map((contact) => {
              const key = contactKey(contact);
              const draft = drafts[key];
              const message = draft?.message ?? "";
              const overLimit = message.length > CONNECTION_NOTE_LIMIT;

              return (
                <div
                  key={key}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <div
                    className="row"
                    style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(key)}
                        onChange={() => toggleSelected(key)}
                      />
                      <strong>
                        {contact.firstname} {contact.lastname}
                      </strong>
                      <span className="small muted">
                        {contact.title || "No title on file"}
                      </span>
                    </label>

                    <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="small">
                      Open profile ↗
                    </a>
                  </div>

                  {draft?.generating ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "16px 18px",
                        background: "var(--sunken)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                      }}
                    >
                      <span className="spinner" style={{ width: 16, height: 16 }} />
                      <span className="small muted">Generating…</span>
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={message}
                        onChange={(event) => updateDraftMessage(key, event.target.value)}
                        rows={3}
                        placeholder="Not generated yet."
                        style={{ ...editorStyle, resize: "vertical", marginBottom: 6 }}
                      />

                      <div
                        className="row"
                        style={{ alignItems: "center", justifyContent: "space-between" }}
                      >
                        <span
                          className="small"
                          style={{ color: overLimit ? "var(--bad)" : "var(--muted)" }}
                        >
                          {message.length}/{CONNECTION_NOTE_LIMIT} characters
                          {overLimit ? " — over LinkedIn's limit" : ""}
                        </span>

                        <div className="row" style={{ gap: 8 }}>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void regenerateOne(contact)}
                            disabled={draft?.generating}
                          >
                            Regenerate
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void copyDraft(key, message)}
                            disabled={!message}
                          >
                            {copiedKey === key ? "Copied" : "Copy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void markSent(contact)}
                            disabled={!message || draft?.sending}
                          >
                            {draft?.sending ? (
                              <>
                                <span className="spinner" />
                                Recording…
                              </>
                            ) : (
                              "Mark as Sent"
                            )}
                          </button>
                        </div>
                      </div>

                      {draft?.error && (
                        <div className="notice error" style={{ marginTop: 10 }}>
                          {draft.error}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {sentContacts.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <hr style={{ marginBottom: 16 }} />
          <h3 style={{ marginBottom: 10 }}>Already sent</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sentContacts.map((contact) => {
              const key = contactKey(contact);
              const draft = drafts[key];
              return (
                <div
                  key={key}
                  className="row"
                  style={{
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 12px",
                  }}
                >
                  <Check size={14} />
                  <span>
                    {contact.firstname} {contact.lastname}
                  </span>
                  <span className="small muted">Sent {draft?.sentAt ?? contact.linkedinSentAt}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
