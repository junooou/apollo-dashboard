"use client";

/**
 * Simple filters — describe the persona, run the prompt in Claude yourself,
 * paste the answer back.
 *
 * No API call: a Claude subscription doesn't include API access, and using
 * subscription credentials to authenticate an app is prohibited. A human
 * running the prompt is both legitimate and free on any plan.
 */

import { useEffect, useState } from "react";
import { DeptChip } from "../components/DeptChip";
import {
  AlertCircle,
  Check,
  Info,
  Save,
  Sparkle,
  Trash,
} from "../components/Icons";
import { SENIORITIES } from "@/lib/taxonomy";
import {
  PersonaError,
  buildPersonaPrompt,
  parsePersonaResponse,
  type PersonaFilters,
} from "@/lib/persona";
import type { Preset } from "@/lib/presets";

const EXAMPLES = [
  "Heads of customer experience and contact centre at banks in Singapore and Malaysia",
  "Innovation and digital transformation leaders at hotel groups across Southeast Asia",
  "Anyone running loyalty or CRM programmes at shopping mall operators",
];

export function SimpleFilters({
  onApply,
  onStatus,
}: {
  onApply: (filters: PersonaFilters) => void;
  onStatus: (message: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<PersonaFilters | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((d) => setPresets(d.presets ?? []))
      .catch(() => undefined);
  }, []);

  function makePrompt() {
    setError(null);
    setProposal(null);
    setReply("");
    try {
      setPrompt(buildPersonaPrompt(description));
    } catch (err) {
      setError(err instanceof PersonaError ? err.message : "Could not build the prompt.");
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't reach the clipboard — select the prompt text and copy it manually.");
    }
  }

  function readReply() {
    setError(null);
    try {
      const filters = parsePersonaResponse(reply);
      setProposal(filters);
      setPresetName(filters.interpretation.slice(0, 60));
    } catch (err) {
      setError(err instanceof PersonaError ? err.message : "Could not read that reply.");
    }
  }

  async function save() {
    if (!proposal) return;
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: presetName, description, filters: proposal }),
      });
      const data = await res.json();
      setPresets(data.presets ?? []);
      onStatus("Preset saved.");
    } catch {
      setError("Could not save the preset.");
    }
  }

  async function remove(id: string) {
    const res = await fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteId: id }),
    });
    const data = await res.json();
    setPresets(data.presets ?? []);
  }

  function reset() {
    setDescription("");
    setPrompt("");
    setReply("");
    setProposal(null);
    setError(null);
  }

  const seniorityLabel = (v: string) =>
    SENIORITIES.find((s) => s.value === v)?.label ?? v;

  return (
    <>
      {/* Step 1 — describe */}
      <section className="panel" data-stage="search">
        <h2>
          <span className="step-num">1</span>
          Describe who you want to reach
        </h2>
        <p className="panel-note">
          Write it the way you&apos;d explain it to a colleague. This never leaves
          your machine — the next step gives you a prompt to run in Claude
          yourself, so it works on any plan and costs nothing.
        </p>

        <div className="persona-field">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Heads of customer experience at banks in Singapore and Malaysia — people who own the contact centre or digital channels, not IT infrastructure."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) makePrompt();
            }}
          />
        </div>

        <div className="analysing-note">
          Press <span className="mono">⌘↵</span> to build the prompt. Try:{" "}
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              className="ghost"
              style={{ padding: "2px 6px", fontSize: "inherit" }}
              onClick={() => setDescription(ex)}
            >
              example {i + 1}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={makePrompt} disabled={!description.trim()}>
            <Sparkle size={15} />
            Build the prompt
          </button>
          {description && (
            <button className="secondary" onClick={reset}>
              Start over
            </button>
          )}
        </div>
      </section>

      {/* Step 2 — run it in Claude */}
      {prompt && (
        <section className="panel" data-stage="review">
          <h2>
            <span className="step-num">2</span>
            Run it in Claude
          </h2>
          <p className="panel-note">
            Copy this, paste it into Claude — claude.ai, the desktop app, or this
            Claude Code session — and copy the JSON it replies with.
          </p>

          <div className="row" style={{ marginBottom: 12 }}>
            <button onClick={copyPrompt}>
              {copied ? (
                <>
                  <Check size={15} />
                  Copied
                </>
              ) : (
                <>
                  <Sparkle size={15} />
                  Copy prompt
                </>
              )}
            </button>
            <a
              href="https://claude.ai/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-check"
            >
              Open claude.ai ↗
            </a>
          </div>

          <details>
            <summary>Show the prompt ({prompt.length.toLocaleString()} characters)</summary>
            <textarea
              readOnly
              value={prompt}
              rows={12}
              style={{ marginTop: 8, fontFamily: "ui-monospace, monospace" }}
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
        </section>
      )}

      {/* Step 3 — paste the reply */}
      {prompt && (
        <section className="panel" data-stage="result">
          <h2>
            <span className="step-num">3</span>
            Paste Claude&apos;s reply
          </h2>
          <p className="panel-note">
            The whole reply is fine — a code fence or a sentence of preamble gets
            stripped automatically.
          </p>

          {/* The field glows while it's waiting for an answer that isn't here yet. */}
          <div className="persona-field" data-analysing={reply.trim() === ""}>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder='Paste here — starts with { "interpretation": ...'
              style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8125rem" }}
            />
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={readReply} disabled={!reply.trim()}>
              <Check size={15} />
              Read the filters
            </button>
          </div>

          {error && (
            <div className="notice error" style={{ marginTop: 14 }}>
              <AlertCircle size={16} />
              <div>{error}</div>
            </div>
          )}

          {proposal && (
            <div className="proposal">
              <h3>Proposed filters</h3>
              <p className="interpretation">{proposal.interpretation}</p>
              <p className="rationale">{proposal.rationale}</p>

              <div className="criteria-grid">
                <div>
                  <div className="label">Departments</div>
                  {proposal.departments.length ? (
                    <div className="dept-list">
                      {proposal.departments.map((id) => (
                        <DeptChip key={id} id={id} />
                      ))}
                    </div>
                  ) : (
                    <span className="small muted">No department filter</span>
                  )}
                </div>

                <div>
                  <div className="label">Seniority</div>
                  <span className="small">
                    {proposal.personSeniorities.length
                      ? proposal.personSeniorities.map(seniorityLabel).join(", ")
                      : "Any"}
                  </span>
                </div>

                <div>
                  <div className="label">Locations</div>
                  <span className="small">
                    {proposal.personLocations.length
                      ? proposal.personLocations.join(", ")
                      : "Worldwide"}
                  </span>
                </div>

                <div>
                  <div className="label">Contacts per company</div>
                  <span className="small">{proposal.contactTarget}</span>
                </div>
              </div>

              <div className="field">
                <div className="label small muted" style={{ marginBottom: 5 }}>
                  Job titles sent to Apollo ({proposal.personTitles.length})
                </div>
                <div className="taginput">
                  <div className="tags">
                    {proposal.personTitles.map((t) => (
                      <span key={t} className="tag" style={{ paddingRight: 10 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {proposal.excludeKeywords.length > 0 && (
                <div className="field">
                  <div className="label small muted" style={{ marginBottom: 5 }}>
                    Excluded ({proposal.excludeKeywords.length})
                  </div>
                  <div className="taginput">
                    <div className="tags">
                      {proposal.excludeKeywords.map((t) => (
                        <span key={t} className="tag" style={{ paddingRight: 10 }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="row">
                <button onClick={() => onApply(proposal)}>
                  <Check size={15} />
                  Apply these filters
                </button>
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Name this persona"
                  style={{ width: "auto", flex: 1, minWidth: 180 }}
                />
                <button
                  className="secondary"
                  onClick={save}
                  disabled={!presetName.trim()}
                >
                  <Save size={15} />
                  Save preset
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Saved personas</h2>
        <p className="panel-note">
          Reuse a persona you&apos;ve already worked out — no prompt to run again.
          Applying one overwrites the criteria on the Advanced tab.
        </p>

        {presets.length === 0 ? (
          <div className="notice info">
            <Info size={16} />
            <div>
              Nothing saved yet. Work a persona through the steps above, then save
              it to reuse later.
            </div>
          </div>
        ) : (
          presets.map((p) => (
            <div key={p.id} className="preset-row">
              <div className="meta">
                <div className="name">{p.name}</div>
                <div className="desc">{p.description}</div>
              </div>
              <button className="secondary" onClick={() => onApply(p.filters)}>
                Apply
              </button>
              <button
                className="ghost"
                onClick={() => remove(p.id)}
                aria-label={`Delete ${p.name}`}
                title="Delete preset"
              >
                <Trash size={15} />
              </button>
            </div>
          ))
        )}
      </section>
    </>
  );
}
