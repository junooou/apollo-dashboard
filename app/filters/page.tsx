"use client";

import { useEffect, useState } from "react";
import { AdvancedFilters } from "./AdvancedFilters";
import { SimpleFilters } from "./SimpleFilters";
import { Check, Reset, Save, Sliders, Sparkle } from "../components/Icons";
import type { PersonaFilters } from "@/lib/persona";
import type { Settings } from "@/lib/types";

type Tab = "simple" | "advanced";

export default function FiltersPage() {
  const [tab, setTab] = useState<Tab>("simple");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(() => setStatus("Could not load filters"));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setStatus(null);
    setDirty(true);
  }

  /** Fold an AI proposal (or a saved preset) into the working criteria. */
  function applyPersona(filters: PersonaFilters) {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            departments: filters.departments,
            personSeniorities: filters.personSeniorities,
            personLocations: filters.personLocations,
            personTitles: filters.personTitles,
            // Merge keyword lists rather than replacing: the defaults encode
            // context.md's standing rules, which the persona refines.
            includeKeywords: [
              ...new Set([...prev.includeKeywords, ...filters.includeKeywords]),
            ],
            excludeKeywords: [
              ...new Set([...prev.excludeKeywords, ...filters.excludeKeywords]),
            ],
            contactTarget: filters.contactTarget,
          }
        : prev,
    );
    setDirty(true);
    setStatus("Filters applied — review them on the Advanced tab, then save.");
    setTab("advanced");
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      setSettings(data.settings);
      setStatus("Saved. These are now the defaults for every new search.");
      setDirty(false);
    } catch {
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      setSettings(data.settings);
      setStatus("Reset to the context.md defaults.");
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="top">
        <h1>Filters</h1>
        <div className="header-meta">
          <a href="/">Back to sourcing</a>
        </div>
      </header>

      {status && (
        <div className="notice info" role="status">
          <Check size={16} />
          <div>{status}</div>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "simple"}
          onClick={() => setTab("simple")}
        >
          <Sparkle size={15} />
          Simple
        </button>
        <button
          role="tab"
          aria-selected={tab === "advanced"}
          onClick={() => setTab("advanced")}
        >
          <Sliders size={15} />
          Advanced
        </button>
      </div>

      {tab === "simple" ? (
        <>
          <p className="tab-note">
            Describe the kind of person you want to reach and Claude works out the
            criteria. Best when you know the persona but not Apollo&apos;s filters.
          </p>
          <SimpleFilters onApply={applyPersona} onStatus={setStatus} />
        </>
      ) : (
        <>
          <p className="tab-note">
            Every criterion, set directly. Region, countries, departments and
            seniority can also be changed on the search page for a one-off run —
            what you save here becomes the default.
          </p>
          <AdvancedFilters settings={settings} update={update} />

          <div className="row">
            <button onClick={save} disabled={saving}>
              {saving ? (
                <>
                  <span className="spinner" />
                  Saving…
                </>
              ) : (
                <>
                  <Save size={15} />
                  {dirty ? "Save changes" : "Save filters"}
                </>
              )}
            </button>
            <button className="secondary" onClick={reset} disabled={saving}>
              <Reset size={15} />
              Reset to context.md defaults
            </button>
          </div>
        </>
      )}
    </div>
  );
}
