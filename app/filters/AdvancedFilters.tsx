"use client";

/**
 * Advanced filters — the full criteria surface. Every field the search and the
 * local relevance rules read, exposed directly.
 */

import { MultiSelect, TagInput } from "../components/Controls";
import { DeptChip } from "../components/DeptChip";
import {
  COUNTRIES,
  DEPARTMENTS,
  REGIONS,
  SENIORITIES,
  countriesForRegion,
} from "@/lib/taxonomy";
import type { Settings } from "@/lib/types";

export function AdvancedFilters({
  settings,
  update,
}: {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const currentRegion =
    REGIONS.find(
      (r) =>
        r.countries.length === settings.personLocations.length &&
        r.countries.every((c) => settings.personLocations.includes(c)),
    )?.label ?? "Custom";

  return (
    <>
      <section className="panel">
        <h2>Run options</h2>

        <div className="checkbox-row">
          <input
            type="checkbox"
            id="waterfall"
            checked={settings.waterfallEnabled}
            onChange={(e) => update("waterfallEnabled", e.target.checked)}
          />
          <label htmlFor="waterfall" style={{ fontWeight: 400 }}>
            <strong>Waterfall enrichment</strong>
            <div className="hint">
              Retries contacts whose standard reveal found no email, using
              Apollo&apos;s third-party sources. Runs only on candidates that already
              passed the filter and failed a standard reveal — never as a first pass.
              Roughly 3 credits per contact when it finds something.
            </div>
          </label>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="cap">Waterfall cap (per company)</label>
            <input
              id="cap"
              type="number"
              min={0}
              value={settings.waterfallCap}
              onChange={(e) => update("waterfallCap", Number(e.target.value))}
              disabled={!settings.waterfallEnabled}
            />
            <div className="hint">context.md default: 10.</div>
          </div>

          <div className="field">
            <label htmlFor="target">Contacts per company</label>
            <input
              id="target"
              type="number"
              min={1}
              value={settings.contactTarget}
              onChange={(e) => update("contactTarget", Number(e.target.value))}
            />
            <div className="hint">context.md default: 20. Pre-ticks this many.</div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="filename">Filename override</label>
          <input
            id="filename"
            type="text"
            placeholder="Leave blank to use the company name"
            value={settings.filenameOverride}
            onChange={(e) => update("filenameOverride", e.target.value)}
          />
          <div className="hint">
            Convention is the company name capitalised naturally, no suffix — e.g.{" "}
            <span className="mono">DBS.csv</span>. The{" "}
            <span className="mono">.csv</span> extension is added for you.
          </div>
        </div>

        <div className="checkbox-row">
          <input
            type="checkbox"
            id="phone"
            checked={settings.includePhone}
            onChange={(e) => update("includePhone", e.target.checked)}
          />
          <label htmlFor="phone" style={{ fontWeight: 400 }}>
            <strong>Add a phone column</strong>
            <div className="hint">
              Off by default — none of the 19 shipped CSVs have one, and phone
              reveals cost roughly 8 extra credits per contact.
            </div>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Who to search for</h2>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="region-select">Region</label>
            <select
              id="region-select"
              value={currentRegion}
              onChange={(e) => {
                const list = countriesForRegion(e.target.value);
                if (list) update("personLocations", list);
              }}
            >
              {REGIONS.map((r) => (
                <option key={r.label} value={r.label}>
                  {r.label}
                </option>
              ))}
              {currentRegion === "Custom" && <option value="Custom">Custom</option>}
            </select>
            <div className="hint">
              Picking a region fills in the countries beside it. Maybank and the
              Malaysian mall groups need more than Singapore.
            </div>
          </div>

          <div className="field">
            <label>Countries</label>
            <MultiSelect
              options={COUNTRIES.map((c) => ({ value: c, label: c }))}
              selected={settings.personLocations}
              onChange={(next) => update("personLocations", next)}
              placeholder="Worldwide (no filter)"
            />
            <div className="hint">
              Empty means no location filter at all. Verified working against Apollo.
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Departments</label>
            <MultiSelect
              options={DEPARTMENTS.map((d) => ({
                value: d.id,
                label: d.label,
                hint: d.recommended ? "recommended" : undefined,
              }))}
              selected={settings.departments ?? []}
              onChange={(next) => update("departments", next)}
              placeholder="All departments"
            />
            {(settings.departments ?? []).length > 0 && (
              <div className="dept-list">
                {(settings.departments ?? []).map((id) => (
                  <DeptChip key={id} id={id} />
                ))}
              </div>
            )}
            <div className="hint">
              Matched against the job title locally — Apollo ignores its own
              department parameter, so this is applied on our side.
            </div>
          </div>

          <div className="field">
            <label>Seniority</label>
            <MultiSelect
              options={SENIORITIES}
              selected={settings.personSeniorities}
              onChange={(next) => update("personSeniorities", next)}
              placeholder="Any seniority"
            />
            <div className="hint">
              Sent to Apollo directly. Junior and frontline roles are excluded per
              context.md.
            </div>
          </div>
        </div>

        <div className="field">
          <label>Job titles sent to Apollo</label>
          <TagInput
            value={settings.personTitles}
            onChange={(next) => update("personTitles", next)}
            placeholder="Add a title keyword and press Enter"
          />
          <div className="hint">
            This is the wide net. Searching is free, so be generous — narrowing
            happens with the rules below at no cost.
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Relevance rules (applied locally, free)</h2>

        <div className="field">
          <label>Include keywords</label>
          <TagInput
            value={settings.includeKeywords}
            onChange={(next) => update("includeKeywords", next)}
          />
          <div className="hint">
            A title matching any of these scores positively. More matches rank higher.
          </div>
        </div>

        <div className="field">
          <label>Exclude keywords — always drop</label>
          <TagInput
            value={settings.excludeKeywords}
            onChange={(next) => update("excludeKeywords", next)}
          />
          <div className="hint">
            Drops the candidate even if a CX keyword also matches. Deliberate:
            &quot;H2H Digital Channels&quot; contains &quot;digital channels&quot; but
            is corporate treasury, not consumer.
          </div>
        </div>

        <div className="field">
          <label>Conditional exclusions — drop unless CX-related</label>
          <TagInput
            value={settings.conditionalExcludeKeywords ?? []}
            onChange={(next) => update("conditionalExcludeKeywords", next)}
          />
          <div className="hint">
            context.md&apos;s &quot;wealth management or private banking, unless the
            role specifically covers customer experience&quot;.
          </div>
        </div>

        <div className="field">
          <label>Negative signals — drop unless CX-related</label>
          <TagInput
            value={settings.negativeSignals}
            onChange={(next) => update("negativeSignals", next)}
          />
          <div className="hint">
            Softer than an exclusion. Drops generic &quot;Business Insights&quot; while
            keeping &quot;Customer Experience Insights&quot;.
          </div>
        </div>

        <div className="field">
          <label>Personal email domains</label>
          <TagInput
            value={settings.personalEmailDomains}
            onChange={(next) => update("personalEmailDomains", next)}
          />
          <div className="hint">
            Contacts whose only revealed email is on one of these are dropped.
          </div>
        </div>
      </section>
    </>
  );
}
