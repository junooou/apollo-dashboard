"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunRecord } from "@/lib/history";

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRuns(d.runs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load history"));
  }, []);

  const totals = useMemo(() => {
    if (!runs) return null;
    return runs.reduce(
      (acc, r) => ({
        runs: acc.runs + 1,
        contacts: acc.contacts + r.successful,
        credits: acc.credits + (r.creditsUsed ?? 0),
      }),
      { runs: 0, contacts: 0, credits: 0 },
    );
  }, [runs]);

  return (
    <div className="shell">
      <header className="top">
        <h1>Run History</h1>
        <div className="header-meta">
          <a href="/">Back to sourcing</a>
        </div>
      </header>

      <p className="panel-note">
        Every completed enrichment run on this machine, logged automatically —
        no more copying a summary line into context.md by hand. This is local to
        this install; a colleague running their own copy of the app has their
        own separate history (see AWS_DEPLOYMENT_NOTES.md for what changes once
        this is a shared deployment).
      </p>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      {!runs && !error && <p className="muted">Loading…</p>}

      {runs && runs.length === 0 && (
        <div className="empty">
          <p>
            No runs logged yet. Source a company and enrich a few contacts — it&apos;ll
            show up here.
          </p>
        </div>
      )}

      {runs && runs.length > 0 && totals && (
        <>
          <div className="readout">
            <div className="cell">
              <div className="label">Runs logged</div>
              <div className="value">{totals.runs}</div>
            </div>
            <div className="cell">
              <div className="label">Contacts sourced</div>
              <div className="value pos">{totals.contacts}</div>
            </div>
            <div className="cell">
              <div className="label">Credits used</div>
              <div className="value">{totals.credits}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Company</th>
                  <th>In CSV</th>
                  <th>Dropped</th>
                  <th>Credits used</th>
                  <th>Waterfall recovered</th>
                  <th>Run by</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="small">
                      {new Date(r.ranAt).toLocaleDateString()}{" "}
                      <span className="muted">
                        {new Date(r.ranAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </td>
                    <td>{r.company}</td>
                    <td className="value pos" style={{ fontSize: "inherit", fontWeight: 600 }}>
                      {r.successful}
                    </td>
                    <td className="small muted">{r.failed}</td>
                    <td className="small">{r.creditsUsed ?? "—"}</td>
                    <td className="small muted">
                      {r.waterfallAttempted > 0
                        ? `${r.waterfallRecovered}/${r.waterfallAttempted}`
                        : "—"}
                    </td>
                    <td className="small muted">{r.ranBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
