"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Close } from "./Icons";

/**
 * Shared form controls. Kept dependency-free and deliberately plain — the whole
 * app avoids UI libraries so colleagues can run it with a bare `npm install`.
 */

/* ------------------------------------------------------------------ */
/* MultiSelect — dropdown with checkboxes and a chip summary           */
/* ------------------------------------------------------------------ */

export type Option = { value: string; label: string; hint?: string };

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Any",
  compact = false,
}: {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — standard dropdown expectations.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected
            .map((v) => options.find((o) => o.value === v)?.label ?? v)
            .join(", ")
        : `${selected.length} selected`;

  return (
    <div className="multiselect" ref={ref}>
      <button
        type="button"
        className={`ms-trigger${compact ? " compact" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={`ms-label${selected.length === 0 ? " muted" : ""}`}>
          {summary}
        </span>
        <ChevronDown size={15} />
      </button>

      {open && (
        <div className="ms-menu" role="listbox" aria-multiselectable="true">
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(options.map((o) => o.value))}>
              Select all
            </button>
            <button type="button" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          {options.length === 0 ? (
            <p className="ms-empty">Nothing to choose from.</p>
          ) : (
            options.map((o) => (
              <label key={o.value} className="ms-option">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span>
                  {o.label}
                  {o.hint && <span className="ms-hint">{o.hint}</span>}
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TagInput — chip editor for free-text keyword lists                  */
/* ------------------------------------------------------------------ */

export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    // Accept comma-separated pastes as well as single entries.
    const parts = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  }

  return (
    <div className="taginput">
      <div className="tags">
        {value.map((tag) => (
          <span key={tag} className="tag">
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              title={`Remove ${tag}`}
            >
              <Close size={13} />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
      <div className="hint">
        {value.length} term{value.length === 1 ? "" : "s"} · Enter to add,
        Backspace to remove the last
      </div>
    </div>
  );
}
