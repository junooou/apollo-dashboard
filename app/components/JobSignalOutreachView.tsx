"use client";

import { useEffect, useState } from "react";
import { Building, Check, Users } from "./Icons";

/** The subset of app/page.tsx's JobSignal this view actually needs — kept
 *  narrow so this component doesn't depend on the full dashboard type. */
export type JobSignalOutreachTarget = {
  title: string;
  jobUrl: string;
  postedDate: string;
  company: { uen: string; name: string; employeeCount: number | null; ssicCode: string | null };
  department: string;
  isFrontlineSignal: boolean;
  whyRelevant: string;
};

type FilterDecision = {
  keep: boolean;
  score: number;
  reason: string;
  matchedInclude: string[];
  matchedExclude: string[];
  matchedNegative: string[];
  departments: string[];
};

/** Mirrors lib/types.ts's ScoredCandidate — /api/job-signal-outreach returns
 *  this shape directly so it can be passed straight into /api/enrich. */
type ScoredCandidate = {
  apolloPersonId: string;
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  seniority: string;
  linkedinUrl: string;
  location: string;
  employmentDomains: string[];
  hasEmail: boolean;
  hasDirectPhone: boolean;
  decision: FilterDecision;
  alreadySourcedIn?: string;
  alreadySourcedInType?: "sheet" | "csv";
};

type Organization = {
  id: string;
  name: string;
  domain: string | null;
  employeeCount: number | null;
  linkedinUrl: string | null;
};

type OrganizationProfile = {
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  shortDescription: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

type Persona = {
  id: string;
  label: string;
  personTitles: string[];
  rationale: string;
};

type EnrichedContact = {
  apolloPersonId: string;
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  seniority: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  location: string;
  dropped?: string;
  droppedDetail?: string;
};

type SavedRow = {
  contact: EnrichedContact;
  rowIndex: number | null;
  contactedAt?: string;
  marking?: boolean;
};

export default function JobSignalOutreachView({
  signal,
  onBack,
}: {
  signal: JobSignalOutreachTarget;
  onBack: () => void;
}) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichedContacts, setEnrichedContacts] = useState<EnrichedContact[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      companyName: signal.company.name,
      ssicCode: signal.company.ssicCode ?? "",
    });

    fetch(`/api/job-signal-outreach?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setOrganization(d.organization ?? null);
        setPersona(d.persona ?? null);
        const list: ScoredCandidate[] = d.candidates ?? [];
        setCandidates(list);
        setSelectedIds(
          new Set(list.filter((c) => c.hasEmail && !c.alreadySourcedIn).map((c) => c.apolloPersonId)),
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load contacts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signal.company.name, signal.company.ssicCode]);

  function loadProfile() {
    if (!organization?.domain) return;
    setProfileLoading(true);
    setProfileError(null);
    fetch(`/api/org-profile?domain=${encodeURIComponent(organization.domain)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setProfile(d.profile);
      })
      .catch((err) => {
        setProfileError(err instanceof Error ? err.message : "Failed to load company profile.");
      })
      .finally(() => setProfileLoading(false));
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function enrichSelected() {
    const targets = candidates.filter((c) => selectedIds.has(c.apolloPersonId));
    if (targets.length === 0) {
      setEnrichError("Select at least one contact.");
      return;
    }

    setEnriching(true);
    setEnrichError(null);
    try {
      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: signal.company.name,
          candidates: targets,
          targetDomains: organization?.domain ? [organization.domain] : [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Enrichment failed.");
      setEnrichedContacts((data.contacts ?? []).filter((c: EnrichedContact) => !c.dropped));
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Enrichment failed.");
    } finally {
      setEnriching(false);
    }
  }

  async function saveToSheet() {
    if (enrichedContacts.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/job-signal-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          jobTitle: signal.title,
          jobUrl: signal.jobUrl,
          outreachPersona: persona?.label ?? "",
          contacts: enrichedContacts,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save to the sheet.");

      setSpreadsheetId(data.spreadsheetId ?? null);
      const rowIndexes: (number | null)[] = data.rowIndexes ?? [];
      setSavedRows(enrichedContacts.map((contact, i) => ({ contact, rowIndex: rowIndexes[i] ?? null })));
      setEnrichedContacts([]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save to the sheet.");
    } finally {
      setSaving(false);
    }
  }

  async function markContacted(row: SavedRow) {
    if (!spreadsheetId || !row.rowIndex) return;
    setSavedRows((prev) =>
      prev.map((r) => (r.rowIndex === row.rowIndex ? { ...r, marking: true } : r)),
    );
    try {
      const response = await fetch("/api/job-signal-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markContacted", rowIndex: row.rowIndex }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to record the contact.");
      setSavedRows((prev) =>
        prev.map((r) =>
          r.rowIndex === row.rowIndex ? { ...r, marking: false, contactedAt: data.contactedAt } : r,
        ),
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to record the contact.");
      setSavedRows((prev) =>
        prev.map((r) => (r.rowIndex === row.rowIndex ? { ...r, marking: false } : r)),
      );
    }
  }

  return (
    <section
      data-stage="search"
      style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}
    >
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Explore Outreach</h2>
          <div className="small muted">
            {signal.title} at {signal.company.name} · posted {signal.postedDate}
          </div>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          ← Back to Job Signals
        </button>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          marginBottom: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <Building size={16} />
          <strong>{signal.company.name}</strong>
          {signal.company.uen && <span className="small muted">UEN {signal.company.uen}</span>}
        </div>
        <div className="small muted">
          {signal.company.employeeCount ? `${signal.company.employeeCount} employees · ` : ""}
          {signal.department}
          {signal.isFrontlineSignal ? " · frontline hiring signal" : ""}
        </div>
        <p className="small" style={{ margin: 0 }}>
          {signal.whyRelevant}
        </p>
        <a href={signal.jobUrl} target="_blank" rel="noopener noreferrer" className="small">
          View listing ↗
        </a>

        {organization?.domain && !profile && (
          <button
            type="button"
            className="secondary"
            onClick={loadProfile}
            disabled={profileLoading}
            style={{ alignSelf: "flex-start", marginTop: 4 }}
          >
            {profileLoading ? "Loading…" : "Load full company profile · 1 credit"}
          </button>
        )}
        {profileError && <div className="notice error">{profileError}</div>}
        {profile && (
          <div className="small muted">
            {[profile.industry, [profile.city, profile.country].filter(Boolean).join(", "), profile.foundedYear ? `founded ${profile.foundedYear}` : null]
              .filter(Boolean)
              .join(" · ")}
            {profile.shortDescription && <p style={{ margin: "6px 0 0" }}>{profile.shortDescription}</p>}
          </div>
        )}
      </div>

      {persona && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <Users size={16} />
          <div>
            <strong>{persona.label}</strong> — {persona.rationale}
          </div>
        </div>
      )}

      {loading && <div className="small muted">Searching for management contacts…</div>}
      {error && <div className="notice error">{error}</div>}

      {!loading && !error && candidates.length === 0 && (
        <div className="small muted">
          No contacts found for the "{persona?.label}" persona at {signal.company.name}. Try Outreach
          Studio directly, or adjust PERSONA_RULES in lib/job-signal-persona.ts if this vertical needs
          different titles.
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <>
          <div
            className="row"
            style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}
          >
            <div className="small muted">
              {selectedIds.size} of {candidates.length} selected
            </div>
            <button type="button" onClick={enrichSelected} disabled={enriching || selectedIds.size === 0}>
              {enriching ? (
                <>
                  <span className="spinner" />
                  Enriching…
                </>
              ) : (
                `Enrich selected · ${selectedIds.size} credit${selectedIds.size === 1 ? "" : "s"}`
              )}
            </button>
          </div>

          {enrichError && <div className="notice error" style={{ marginBottom: 16 }}>{enrichError}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {candidates.map((c) => (
              <label
                key={c.apolloPersonId}
                className="row"
                style={{
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 12px",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.apolloPersonId)}
                  onChange={() => toggleSelected(c.apolloPersonId)}
                  disabled={Boolean(c.alreadySourcedIn)}
                />
                <span>
                  {c.firstname} {c.lastname}
                </span>
                <span className="small muted">{c.title}</span>
                {!c.hasEmail && <span className="small muted">no email on file</span>}
                {c.alreadySourcedIn && (
                  <span className="small muted">already in {c.alreadySourcedIn}</span>
                )}
              </label>
            ))}
          </div>
        </>
      )}

      {enrichedContacts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 10 }}>Ready to save</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {enrichedContacts.map((c) => (
              <div key={c.apolloPersonId} className="small">
                {c.firstname} {c.lastname} — {c.email}
              </div>
            ))}
          </div>
          <button type="button" onClick={saveToSheet} disabled={saving}>
            {saving ? (
              <>
                <span className="spinner" />
                Saving…
              </>
            ) : (
              `Save ${enrichedContacts.length} to Job Signals Outreach`
            )}
          </button>
          {saveError && <div className="notice error" style={{ marginTop: 10 }}>{saveError}</div>}
        </div>
      )}

      {savedRows.length > 0 && (
        <div>
          <hr style={{ marginBottom: 16 }} />
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Saved to Job Signals Outreach</h3>
            {spreadsheetId && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="small"
              >
                Open sheet ↗
              </a>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {savedRows.map((row) => (
              <div
                key={row.contact.apolloPersonId}
                className="row"
                style={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 12px",
                }}
              >
                <span>
                  {row.contact.firstname} {row.contact.lastname} — {row.contact.email}
                </span>
                {row.contactedAt ? (
                  <span className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Check size={14} />
                    Contacted {row.contactedAt}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void markContacted(row)}
                    disabled={row.marking || !row.rowIndex}
                  >
                    {row.marking ? "Recording…" : "Mark contacted"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
