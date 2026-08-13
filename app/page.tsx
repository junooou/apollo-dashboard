"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MultiSelect } from "./components/Controls";
import { DeptChip } from "./components/DeptChip";
import OutreachGenerator, {
  type OutreachPrefill,
} from "./components/OutreachGenerator";
import {
  AlertCircle,
  AlertTriangle,
  BarChart,
  Building,
  Check,
  Download,
  Info,
  Mail,
  MailOff,
  Plus,
  Save,
  Search,
  Sliders,
  Upload,
  Users,
} from "./components/Icons";
import { buildRunLog } from "@/lib/runlog";
import {
  COUNTRIES,
  DEPARTMENTS,
  REGIONS,
  SENIORITIES,
  countriesForRegion,
} from "@/lib/taxonomy";
import type {
  EnrichedContact,
  Organization,
  OrganizationProfile,
  RunSummary,
  ScoredCandidate,
  Settings,
} from "@/lib/types";
import type { NewsItem } from "@/lib/news";

type ExistingContactMatch = { sheetId: string; sheetName: string; count: number };
type ExistingContact = {
  firstname: string;
  lastname: string;
  title: string;
  email: string;
  linkedinUrl: string;
  apolloPersonId: string;
  sheetId: string;
  sheetName: string;
};


type NewsTriggerScore = {
  articleId: string;
  relevant: boolean;
  relevanceScore: number;
  company: string | null;
  industry: string | null;
  triggerType: string;
  whyRelevant: string;
  vonciergeCapabilities: string[];
  suggestedOutreachAngle: string;
  recommendedAction: "generate_outreach" | "watch" | "ignore";
};

type NewsTrigger = {
  id: string;
  title: string;
  description: string;
  url: string;
  author: string | null;
  image: string | null;
  language: string;
  category: string[];
  published: string;
  domain: string;

  score: NewsTriggerScore;

  firstSeenAt: string;
  lastSeenAt: string;
  isNew: boolean;
};

type NewsTriggerResponse = {
  opportunities: NewsTrigger[];
  ignored: NewsTrigger[];
  counts: {
    fetched: number;
    scored: number;
    opportunities: number;
    ignored: number;

    newArticles?: number;
    newOpportunities?: number;
    scoredThisRefresh?: number;
  };
  cache?: {
    fetchedAt?: string;
    scoredAt?: string;
    source?: string;
  };
  error?: string;
};

function formatNewsTriggerDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Stage = "idle" | "searching" | "review" | "enriching" | "done";

export default function Dashboard() {
  const [workspace, setWorkspace] = useState<"leads" | "outreach" | "news">("leads");
  const [outreachPrefill, setOutreachPrefill] = useState<OutreachPrefill | null>(null);
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  /**
   * Step 1 collapses once a company resolves, so the review table isn't pushed
   * below a form that has already done its job. Reopening it is one click.
   */
  const [searchOpen, setSearchOpen] = useState(true);

  const [candidates, setCandidates] = useState<ScoredCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [searchMeta, setSearchMeta] = useState<{
    rawSearchResults: number;
    passedFilter: number;
    totalAvailable: number;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  // Quick filters on the landing page — override saved settings for this search.
  const [region, setRegion] = useState<string>("Singapore only");
  const [countries, setCountries] = useState<string[]>(["Singapore"]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [seniorities, setSeniorities] = useState<string[]>([]);

  // Post-result filters — applied client-side, no re-search needed.
  const [query, setQuery] = useState("");
  const [filterDepartments, setFilterDepartments] = useState<string[]>([]);
  const [emailOnly, setEmailOnly] = useState(false);

  const [contacts, setContacts] = useState<EnrichedContact[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  // Google Sheets export.
  // Users can either append the current contacts to an existing spreadsheet
  // or create a brand-new spreadsheet and push the contacts into it immediately.
  const [pushOpen, setPushOpen] = useState(false);
  const [sheets, setSheets] = useState<{ id: string; name: string }[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsError, setSheetsError] = useState<string | null>(null);

  const [sheetMode, setSheetMode] = useState<"existing" | "create">("existing");
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [newSheetName, setNewSheetName] = useState("");

  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(null);

  // Create New Sheet — creates a spreadsheet inside GOOGLE_PARENT_FOLDER_ID
  // and adds it to the Push to Sheet picker, selected and ready to push to.
  const [createOpen, setCreateOpen] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState("");
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Company overview — latest news (Google News RSS) and a check for
  // contacts already logged for this company across the Sheets folder.
  // Both fire as soon as a company resolves, independent of the people search.
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  const [existingContacts, setExistingContacts] = useState<{
    matches: ExistingContactMatch[];
    totalContacts: number;
    contacts: ExistingContact[];
  } | null>(null);
  const [existingContactsOpen, setExistingContactsOpen] = useState(false);
  const [existingLoading, setExistingLoading] = useState(false);
  const [existingError, setExistingError] = useState<string | null>(null);

  // Company profile — industry, size, HQ, funding — from Apollo's org-enrich
  // endpoint. Fires alongside news/existing-contacts, but only when a domain
  // is known (mixed_companies/search results without one can't be enriched).
  const [orgProfile, setOrgProfile] = useState<OrganizationProfile | null>(null);
  const [orgProfileLoading, setOrgProfileLoading] = useState(false);
  const [orgProfileError, setOrgProfileError] = useState<string | null>(null);

  // News Triggers — reads the cached, AI-scored trigger feed by default.
  // Browser refreshes do not spend Currents or OpenAI requests.
  const [newsTriggers, setNewsTriggers] = useState<NewsTrigger[]>([]);
  const [ignoredNewsTriggers, setIgnoredNewsTriggers] = useState<NewsTrigger[]>([]);
  const [newsTriggerCounts, setNewsTriggerCounts] =
    useState<NewsTriggerResponse["counts"] | null>(null);
  const [newsTriggerCache, setNewsTriggerCache] =
    useState<NewsTriggerResponse["cache"] | null>(null);
  const [newsTriggersLoading, setNewsTriggersLoading] = useState(false);
  const [newsTriggersRefreshing, setNewsTriggersRefreshing] = useState(false);
  const [newsTriggersLoaded, setNewsTriggersLoaded] = useState(false);
  const [newsTriggersError, setNewsTriggersError] = useState<string | null>(null);
  const [showIgnoredNews, setShowIgnoredNews] = useState(false);

  useEffect(() => {
    setExistingContactsOpen(false);

    if (!selectedOrg) {
      setNews(null);
      setNewsError(null);
      setExistingContacts(null);
      setExistingError(null);
      setOrgProfile(null);
      setOrgProfileError(null);
      return;
    }

    let cancelled = false;

    setNewsLoading(true);
    setNewsError(null);
    fetch(`/api/news?company=${encodeURIComponent(selectedOrg.name)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setNews(d.items);
      })
      .catch((err) => {
        if (!cancelled) setNewsError(err instanceof Error ? err.message : "Failed to load news");
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });

    setExistingLoading(true);
    setExistingError(null);
    fetch(`/api/sheets?checkCompany=${encodeURIComponent(selectedOrg.name)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setExistingContacts(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setExistingError(err instanceof Error ? err.message : "Failed to check existing sheets");
        }
      })
      .finally(() => {
        if (!cancelled) setExistingLoading(false);
      });

    // Company profile is NOT fetched here. Unlike news/existing-contacts
    // (both free — Google News RSS and a Google Sheets read), organizations/enrich
    // costs 1 Apollo credit per call, verified live (2026-08-13). Firing it
    // automatically on every company selection would spend shared team credits
    // without asking, which is exactly what AGENTS.md's credit-gate rule
    // forbids — so it only runs when the user clicks "Load company profile".
    setOrgProfile(null);
    setOrgProfileError(null);

    return () => {
      cancelled = true;
    };
  }, [selectedOrg]);

  const loadOrgProfile = useCallback(() => {
    if (!selectedOrg?.domain) return;
    setOrgProfileLoading(true);
    setOrgProfileError(null);
    fetch(`/api/org-profile?domain=${encodeURIComponent(selectedOrg.domain)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setOrgProfile(d.profile);
      })
      .catch((err) => {
        setOrgProfileError(err instanceof Error ? err.message : "Failed to load company profile");
      })
      .finally(() => setOrgProfileLoading(false));
  }, [selectedOrg]);

  const loadNewsTriggers = useCallback(async (refresh = false) => {
    if (refresh) {
      const confirmed = window.confirm(
        "Refresh News will fetch fresh articles from Currents and rescore them with OpenAI. This uses API requests. Continue?",
      );

      if (!confirmed) return;
    }

    setNewsTriggersError(null);
    setNewsTriggersLoading(!refresh);
    setNewsTriggersRefreshing(refresh);

    try {
      const res = await fetch(
        refresh ? "/api/news-triggers?refresh=1" : "/api/news-triggers",
        { cache: "no-store" },
      );

      const data = (await res.json()) as NewsTriggerResponse;

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `News trigger request failed (${res.status})`);
      }

      setNewsTriggers(data.opportunities ?? []);
      setIgnoredNewsTriggers(data.ignored ?? []);
      setNewsTriggerCounts(data.counts ?? null);
      setNewsTriggerCache(data.cache ?? null);
      setNewsTriggersLoaded(true);
    } catch (err) {
      setNewsTriggersError(
        err instanceof Error ? err.message : "Failed to load news triggers",
      );
    } finally {
      setNewsTriggersLoading(false);
      setNewsTriggersRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (workspace === "news" && !newsTriggersLoaded && !newsTriggersLoading) {
      loadNewsTriggers(false);
    }
  }, [workspace, newsTriggersLoaded, newsTriggersLoading, loadNewsTriggers]);

  const refreshCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/credits");
      const data = await res.json();
      setCredits(data.credits);
      setHasKey(data.hasKey);
    } catch {
      /* header detail only — never block the workflow on this */
    }
  }, []);

  // Voncierge Outreach sheets index — this mount-time fetch is what actually
  // triggers the scan (see /api/sheets-index): every spreadsheet in the
  // shared Drive folder, read once and cached in-memory server-side so every
  // "already sourced" check afterwards is instant instead of re-scanning.
  const [sheetsIndexLoading, setSheetsIndexLoading] = useState(true);
  const [sheetsIndexStatus, setSheetsIndexStatus] = useState<{
    configured: boolean;
    sheetCount?: number;
    contactCount?: number;
    loadedAt?: string;
    error?: string;
  } | null>(null);

  const refreshSheetsIndex = useCallback(async (force = false) => {
    setSheetsIndexLoading(true);
    try {
      const res = await fetch(`/api/sheets-index${force ? "?force=1" : ""}`);
      const data = await res.json();
      setSheetsIndexStatus(data);
    } catch (err) {
      setSheetsIndexStatus({
        configured: true,
        error: err instanceof Error ? err.message : "Failed to load",
      });
    } finally {
      setSheetsIndexLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCredits();
    refreshSheetsIndex();
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings);
        // Seed the quick filters from saved settings so the two stay in sync.
        if (d.settings?.personLocations) {
          setCountries(d.settings.personLocations);
          const match = REGIONS.find(
            (r) =>
              r.countries.length === d.settings.personLocations.length &&
              r.countries.every((c: string) =>
                d.settings.personLocations.includes(c),
              ),
          );
          setRegion(match?.label ?? "Custom");
        }
        if (d.settings?.departments) setDepartments(d.settings.departments);
        if (d.settings?.personSeniorities) setSeniorities(d.settings.personSeniorities);
      })
      .catch(() => undefined);
  }, [refreshCredits]);

  const kept = useMemo(() => candidates.filter((c) => c.decision.keep), [candidates]);
  const rejected = useMemo(() => candidates.filter((c) => !c.decision.keep), [candidates]);

  /** Post-result filtering — narrows what's shown without another API call. */
  const visible = useMemo(() => {
    const base = showRejected ? candidates : kept;
    const q = query.trim().toLowerCase();
    return base.filter((c) => {
      if (emailOnly && !c.hasEmail) return false;
      if (
        filterDepartments.length > 0 &&
        !c.decision.departments?.some((d) => filterDepartments.includes(d))
      ) {
        return false;
      }
      if (q) {
        const haystack =
          `${c.firstname} ${c.lastname} ${c.title}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, kept, showRejected, query, filterDepartments, emailOnly]);

  /** Filename shown on the download button, matching the saved-file convention. */
  const csvName = `${(selectedOrg?.name || company || "contacts").replace(/[/\\:*?"<>|]/g, "")}.csv`;

  const departmentOptions = DEPARTMENTS.map((d) => ({
    value: d.id,
    label: d.label,
    hint: d.recommended ? "recommended" : undefined,
  }));

  const selectedCount = selectedIds.size;
  // Apollo charges 1-9 credits per person and 0 when it finds nothing, so the
  // honest estimate is a range rather than a single number.
  const creditEstimate = `${selectedCount}–${selectedCount * 9}`;

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data as T;
  }

  async function handleSearch(org?: Organization) {
    if (!company.trim()) return;
    setError(null);
    setSavedTo(null);
    setStage("searching");
    setContacts([]);
    setSummary(null);

    try {
      // Resolve the company first unless the user already picked an org.
      let target = org ?? selectedOrg;
      if (!target) {
        const { organizations } = await post<{ organizations: Organization[] }>(
          "/api/company",
          { query: company },
        );
        setOrgs(organizations);
        if (organizations.length === 0) {
          setError(
            `No Apollo organization found for "${company}". Try the company's domain instead (e.g. dbs.com).`,
          );
          setStage("idle");
          return;
        }
        if (organizations.length > 1) {
          // Let the user disambiguate — group structures often span domains.
          setStage("idle");
          return;
        }
        target = organizations[0];
        setSelectedOrg(target);
      }

      const data = await post<{
        candidates: ScoredCandidate[];
        rawSearchResults: number;
        passedFilter: number;
        totalAvailable: number;
        diagnostics?: string[];
        settings: Settings;
      }>("/api/search", {
        companyName: target.name || company,
        organizationIds: target.id ? [target.id] : undefined,
        domains: target.domain ? [target.domain, ...target.altDomains] : undefined,
        // Quick filters override saved settings for this search only.
        overrides: {
          personLocations: countries,
          departments,
          ...(seniorities.length > 0 ? { personSeniorities: seniorities } : {}),
        },
      });

      // Show Apollo's canonical name rather than what was typed — searching
      // "maybank" resolves to "Maybank", and the field should say which record
      // is actually being searched.
      if (target.name) setCompany(target.name);

      // Collapse only on a search that found people. A zero-result run leaves
      // step 1 open, because adjusting the company or the filters is the next
      // thing you'll do and hiding those controls would just cost a click.
      setSearchOpen(data.candidates.length === 0);

      setCandidates(data.candidates);
      setSettings(data.settings);
      setDiagnostics(data.diagnostics ?? []);
      setSearchMeta({
        rawSearchResults: data.rawSearchResults,
        passedFilter: data.passedFilter,
        totalAvailable: data.totalAvailable,
      });

      // Pre-tick the top N that passed, skipping anyone already in a CSV and
      // anyone Apollo holds no email for — those would almost certainly fail
      // enrichment and eat a slot in the shortlist.
      const target_n = data.settings.contactTarget;
      const preselected = data.candidates
        .filter((c) => c.decision.keep && !c.alreadySourcedIn && c.hasEmail)
        .slice(0, target_n)
        .map((c) => c.apolloPersonId);
      setSelectedIds(new Set(preselected));
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setStage("idle");
    }
  }

  async function handleEnrich() {
    if (selectedCount === 0) return;
    setError(null);
    setStage("enriching");

    try {
      const chosen = candidates.filter((c) => selectedIds.has(c.apolloPersonId));
      const data = await post<{ contacts: EnrichedContact[]; summary: RunSummary }>(
        "/api/enrich",
        {
          companyName: selectedOrg?.name || company,
          candidates: chosen,
          targetDomains: selectedOrg
            ? [selectedOrg.domain, ...selectedOrg.altDomains]
            : [],
          rawSearchResults: searchMeta?.rawSearchResults,
          passedFilter: searchMeta?.passedFilter,
        },
      );
      setContacts(data.contacts);
      setSummary(data.summary);
      setStage("done");
      refreshCredits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
      setStage("review");
    }
  }

  async function handleDownload() {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: selectedOrg?.name || company,
        contacts,
        mode: "download",
      }),
    });
    if (!res.ok) {
      setError("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedOrg?.name || company}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveToFolder() {
    try {
      const data = await post<{ savedTo: string }>("/api/export", {
        companyName: selectedOrg?.name || company,
        contacts,
        mode: "save",
      });
      setSavedTo(data.savedTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function togglePush() {
    const next = !pushOpen;
    setPushOpen(next);
    setPushResult(null);
    setCreatedSheetUrl(null);
    if (next && sheets.length === 0 && !sheetsLoading) {
      setSheetsLoading(true);
      setSheetsError(null);
      try {
        const res = await fetch("/api/sheets?list=1");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to list sheets");
        setSheets(data.sheets);
        if (data.sheets.length > 0) setSelectedSheetId(data.sheets[0].id);
      } catch (err) {
        setSheetsError(err instanceof Error ? err.message : "Failed to list sheets");
      } finally {
        setSheetsLoading(false);
      }
    }
  }

  async function handlePushToSheet() {
    setPushing(true);
    setPushResult(null);
    setCreatedSheetUrl(null);
  
    try {
      let spreadsheetId = selectedSheetId;
      let sheetName =
        sheets.find((sheet) => sheet.id === selectedSheetId)?.name ?? "Google Sheet";
  
      // Create a brand-new spreadsheet first if the user selected create mode.
      if (sheetMode === "create") {
        const title = newSheetName.trim();
  
        if (!title) {
          throw new Error("Enter a name for the new Google Sheet.");
        }
  
        const created = await post<{
          spreadsheetId: string;
          url: string;
        }>("/api/sheets", {
          mode: "create",
          title,
          sheetTitles: ["Contacts"],
        });
  
        spreadsheetId = created.spreadsheetId;
        sheetName = title;
        setCreatedSheetUrl(created.url);
  
        // Add the newly created sheet to the existing-sheet picker as well.
        setSheets((current) => [
          { id: created.spreadsheetId, name: title },
          ...current.filter((sheet) => sheet.id !== created.spreadsheetId),
        ]);
  
        setSelectedSheetId(created.spreadsheetId);
      }
  
      if (!spreadsheetId) {
        throw new Error("Choose a Google Sheet first.");
      }
  
      const data = await post<{
        rowsPushed: number;
        headerAdded: boolean;
      }>("/api/sheets", {
        mode: "pushContacts",
        spreadsheetId,
        contacts,
      });
  
      setPushResult(
        `${sheetMode === "create" ? "Created" : "Updated"} "${sheetName}" and added ${
          data.rowsPushed
        } row${data.rowsPushed === 1 ? "" : "s"}.`,
      );

      if (sheetMode === "create") {
        setNewSheetName("");
      }

      // These rows just changed what's already-sourced — re-warm so the next
      // company check (this session or the header count) reflects them.
      refreshSheetsIndex(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Sheets export failed");
    } finally {
      setPushing(false);
    }
  }

  function toggleCreate() {
    setCreateOpen((prev) => !prev);
    setCreateError(null);
  }

  async function handleCreateSheet() {
    const title = newSheetTitle.trim() || selectedOrg?.name || company;
    if (!title) return;
    setCreatingSheet(true);
    setCreateError(null);
    try {
      const data = await post<{ spreadsheetId: string; url: string }>("/api/sheets", {
        mode: "create",
        title,
      });
      setSheets((prev) => [...prev, { id: data.spreadsheetId, name: title }]);
      setSelectedSheetId(data.spreadsheetId);
      setNewSheetTitle("");
      setCreateOpen(false);
      setPushOpen(true);
      setPushResult(`Created "${title}" — pick it above and push.`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create sheet failed");
    } finally {
      setCreatingSheet(false);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setStage("idle");
    setCandidates([]);
    setSelectedIds(new Set());
    setContacts([]);
    setSummary(null);
    setOrgs([]);
    setSelectedOrg(null);
    setSearchMeta(null);
    setSavedTo(null);
    setError(null);
    setDiagnostics([]);
    setSearchOpen(true);
    setPushOpen(false);
    setPushResult(null);
    setSheetsError(null);
    setCreateOpen(false);
    setNewSheetTitle("");
    setCreateError(null);
  }

  const busy = stage === "searching" || stage === "enriching";

  function handleGenerateOutreachFromNews(trigger: NewsTrigger) {
    const companyName = trigger.score.company?.trim();

    if (!companyName) {
      setNewsTriggersError(
        "This article does not have a clear company to generate outreach for.",
      );
      return;
    }

    const capabilities = trigger.score.vonciergeCapabilities.length
      ? trigger.score.vonciergeCapabilities.join(", ")
      : "None specifically identified";

    const newsContext = [
      "This campaign was triggered by a recent news article.",
      "",
      `News headline: ${trigger.title}`,
      `Source: ${trigger.domain}`,
      `Published: ${formatNewsTriggerDate(trigger.published)}`,
      `Article URL: ${trigger.url}`,
      "",
      `Why this matters for Voncierge: ${trigger.score.whyRelevant}`,
      "",
      `Suggested outreach angle: ${trigger.score.suggestedOutreachAngle}`,
      "",
      `Relevant Voncierge capabilities: ${capabilities}`,
      "",
      "Use this news event as the timely reason for reaching out. Do not invent facts beyond the supplied article context. Keep the outreach grounded in the event and Voncierge's approved playbook.",
    ].join("\n");

    setOutreachPrefill({
      requestId: Date.now(),
      company: companyName,
      industry: trigger.score.industry || "",
      context: newsContext,
      autoGenerate: true,
    });

    setWorkspace("outreach");
  }

  return (
    <div className="shell">
      <header className="product-hero">
        <div className="product-hero-top">
          <img
            src="/voncierge-logo.svg"
            alt="Voncierge"
            className="brand-logo"
          />

          <div className="header-meta">
            <a href="/history" className="filter-settings-link">
              <BarChart size={15} />
              Run history
            </a>

            {sheetsIndexStatus?.configured !== false && (
              <span
                className="credit-pill"
                title={
                  sheetsIndexLoading
                    ? "Scanning every spreadsheet in the Voncierge Outreach shared drive"
                    : sheetsIndexStatus?.error
                      ? sheetsIndexStatus.error
                      : sheetsIndexStatus?.loadedAt
                        ? `Loaded ${new Date(sheetsIndexStatus.loadedAt).toLocaleTimeString()} — click to re-scan`
                        : undefined
                }
              >
                {sheetsIndexLoading ? (
                  <>
                    <span className="spinner" />
                    <span>Loading Voncierge Outreach…</span>
                  </>
                ) : sheetsIndexStatus?.error ? (
                  <>
                    <AlertTriangle size={13} />
                    <span>Voncierge Outreach unavailable</span>
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    <span>
                      Voncierge Outreach loaded — {sheetsIndexStatus?.sheetCount ?? 0} sheet
                      {sheetsIndexStatus?.sheetCount === 1 ? "" : "s"} acquired
                    </span>
                  </>
                )}
                <button
                  type="button"
                  className="pill-refresh"
                  onClick={() => refreshSheetsIndex(true)}
                  disabled={sheetsIndexLoading}
                  aria-label="Re-scan the Voncierge Outreach shared drive"
                  title="Re-scan the Voncierge Outreach shared drive"
                >
                  ↻
                </button>
              </span>
            )}

            <span
              className="credit-pill"
              title="Lead credits remaining on this Apollo account"
            >
              <span>APOLLO CREDITS</span>
              <strong>
                {credits != null ? credits.toLocaleString() : "—"}
              </strong>
            </span>

          </div>
        </div>

        <div className="product-hero-copy">
          <div className="product-eyebrow">
            VONCIERGE INTERNAL
            <span className="ai-pill">✦ AI powered</span>
          </div>

          <h1>Outbound Intelligence</h1>

          <p>
            Source the right decision-makers, generate personalised outreach,
            and build campaigns from one workspace.
          </p>
        </div>

        <nav className="workspace-tabs" aria-label="Workspace">
          <button
            type="button"
            className={workspace === "leads" ? "active" : ""}
            onClick={() => setWorkspace("leads")}
          >
            <span className="workspace-tab-number">01</span>
            Lead Sourcing
          </button>

          <button
            type="button"
            className={workspace === "outreach" ? "active" : ""}
            onClick={() => setWorkspace("outreach")}
          >
            <span className="workspace-tab-number">02</span>
            ✦ Outreach Studio
          </button>

          <button
            type="button"
            className={workspace === "news" ? "active" : ""}
            onClick={() => setWorkspace("news")}
          >
            <span className="workspace-tab-number">03</span>
            ✦ News Triggers
          </button>
        </nav>
      </header>

      {workspace === "outreach" && (
        <div className="workspace-view workspace-view-outreach">
          <div className="workspace-intro">
            <span className="workspace-kicker">OUTREACH STUDIO</span>

            <h2>Turn research into outreach.</h2>

            <p>
              Generate company-specific or reusable industry campaigns using
              Voncierge&apos;s approved outreach playbook.
            </p>
          </div>

          <OutreachGenerator initialRequest={outreachPrefill} />
        </div>
      )}

      {workspace === "news" && (
        <div className="workspace-view news-triggers-workspace">
          <div className="workspace-intro news-triggers-intro">
            <div>
              <span className="workspace-kicker">NEWS TRIGGERS</span>
              <h2>Find the reason to reach out now.</h2>
              <p>
                English-language business news from approved sources, ranked by
                how actionable each story is for Voncierge.
              </p>
            </div>

            <div className="news-trigger-toolbar">
              {newsTriggerCache?.scoredAt && (
                <span className="small muted">
                  Scored {formatNewsTriggerDate(newsTriggerCache.scoredAt)}
                </span>
              )}

              <button
                type="button"
                className="secondary"
                onClick={() => loadNewsTriggers(true)}
                disabled={newsTriggersRefreshing || newsTriggersLoading}
                title="Fetches fresh Currents articles and reruns OpenAI scoring"
              >
                {newsTriggersRefreshing ? (
                  <>
                    <span className="spinner" />
                    Refreshing…
                  </>
                ) : (
                  "Refresh news"
                )}
              </button>
            </div>
          </div>

          {newsTriggersError && (
            <div className="notice error">
              <AlertCircle size={16} />
              <div>{newsTriggersError}</div>
            </div>
          )}

          {newsTriggersLoading && (
            <section className="panel news-trigger-loading" aria-live="polite">
              <div className="news-trigger-loading-copy">
                <span className="spinner" />
                Loading saved news intelligence…
              </div>
            </section>
          )}

          {!newsTriggersLoading && newsTriggersLoaded && newsTriggerCounts && (
            <>
              <div className="news-trigger-summary">
                <div className="news-trigger-stat">
                  <span>Opportunities</span>
                  <strong>{newsTriggerCounts.opportunities}</strong>
                </div>
                <div className="news-trigger-stat">
                  <span>Articles scored</span>
                  <strong>{newsTriggerCounts.scored}</strong>
                </div>
                <div className="news-trigger-stat">
                  <span>Filtered out</span>
                  <strong>{newsTriggerCounts.ignored}</strong>
                </div>
                <div className="news-trigger-stat">
                  <span>Data source</span>
                  <strong>Cached</strong>
                </div>
              </div>

              {newsTriggers.length === 0 ? (
                <section className="panel">
                  <div className="empty">
                    <Info size={28} />
                    <h3>No strong triggers right now</h3>
                    <p>
                      The saved articles were scored, but none crossed the
                      70-point review threshold.
                    </p>
                  </div>
                </section>
              ) : (
                <div className="news-trigger-grid">
                  {newsTriggers.map((trigger) => {
                    const score = trigger.score.relevanceScore;
                    const scoreBand =
                      score >= 85 ? "high" : score >= 70 ? "medium" : "low";

                    return (
                      <article
                        className="news-trigger-card"
                        data-score-band={scoreBand}
                        key={trigger.id}
                      >
                        <div className="news-trigger-card-top">
                          <div className="news-trigger-identity">
                            <div className="news-trigger-company-row">
                              <span className={`news-score-badge ${scoreBand}`}>
                                {score}
                              </span>

                              <div>
                                <h3>{trigger.score.company || "Potential opportunity"}</h3>
                                <div className="news-trigger-meta">
                                  {trigger.score.industry && (
                                    <span>{trigger.score.industry}</span>
                                  )}
                                  <span>{trigger.domain}</span>
                                  <span>{formatNewsTriggerDate(trigger.published)}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                            }}
                          >
                            {trigger.isNew && (
                              <span className="news-new-pill">
                                ✦ New
                              </span>
                            )}

                            <span
                              className={`trigger-action-pill ${scoreBand}`}
                            >
                              {trigger.score.recommendedAction ===
                              "generate_outreach"
                                ? "High relevance"
                                : "Review"}
                            </span>
                          </div>
                        </div>

                        <a
                          className="news-trigger-headline"
                          href={trigger.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {trigger.title}
                        </a>

                        <p className="news-trigger-description">
                          {trigger.description}
                        </p>

                        <div className="news-trigger-analysis">
                          <div className="news-trigger-analysis-block">
                            <span className="news-trigger-label">WHY THIS MATTERS</span>
                            <p>{trigger.score.whyRelevant}</p>
                          </div>

                          <div className="news-trigger-analysis-block">
                            <span className="news-trigger-label">SUGGESTED ANGLE</span>
                            <p>{trigger.score.suggestedOutreachAngle}</p>
                          </div>
                        </div>

                        {trigger.score.vonciergeCapabilities.length > 0 && (
                          <div className="news-capability-list">
                            {trigger.score.vonciergeCapabilities.map((capability) => (
                              <span className="news-capability-chip" key={capability}>
                                {capability}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="news-trigger-actions">
                          <a
                            className="news-read-link"
                            href={trigger.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Read article ↗
                          </a>

                          <button
                            type="button"
                            onClick={() => handleGenerateOutreachFromNews(trigger)}
                            disabled={!trigger.score.company}
                            title={
                              trigger.score.company
                                ? "Generate a company-specific sequence from this news trigger"
                                : "No clear company was identified for this article"
                            }
                          >
                            <Mail size={15} />
                            Generate outreach
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {ignoredNewsTriggers.length > 0 && (
                <div className="ignored-news-section">
                  <button
                    type="button"
                    className="ghost ignored-news-toggle"
                    onClick={() => setShowIgnoredNews((current) => !current)}
                  >
                    {showIgnoredNews ? "Hide" : "Show"} {ignoredNewsTriggers.length} filtered
                    article{ignoredNewsTriggers.length === 1 ? "" : "s"}
                  </button>

                  {showIgnoredNews && (
                    <div className="ignored-news-list">
                      {ignoredNewsTriggers.map((trigger) => (
                        <div className="ignored-news-row" key={trigger.id}>
                          <span className="ignored-news-score">
                            {trigger.score.relevanceScore}
                          </span>

                          <div className="ignored-news-copy">
                            <a
                              href={trigger.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {trigger.title}
                            </a>
                            <p>{trigger.score.whyRelevant}</p>
                          </div>

                          <span className="small muted">{trigger.domain}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {workspace === "leads" && (
        <div className="workspace-view">
      {!hasKey && (
        <div className="notice error">
          <AlertTriangle size={16} />
          <div>
            <strong>No Apollo API key configured.</strong> Copy{" "}
            <span className="mono">.env.local.example</span> to{" "}
            <span className="mono">.env.local</span>, add your key from Apollo →
            Settings → Integrations → API, then restart the dev server.
          </div>
        </div>
      )}

      {error && (
        <div className="notice error">
          <AlertCircle size={16} />
          <div>{error}</div>
        </div>
      )}

      {/* ---------------- Stage 1: search ---------------- */}
      <section className="panel" data-stage="search">
      <div className="panel-heading-row">
        <h2>
          <span
            className="step-num"
            data-state={stage !== "idle" ? "done" : undefined}
          >
            1
          </span>

          {!searchOpen && selectedOrg
            ? selectedOrg.name
            : "Find a company"}
        </h2>

        <div className="panel-heading-actions">
          <a href="/filters" className="filter-settings-link">
            <Sliders size={15} />
            Targeting filters
          </a>

          {!searchOpen && (
            <button
              className="ghost"
              onClick={() => setSearchOpen(true)}
              disabled={busy}
            >
              <Search size={14} />
              Change
            </button>
          )}
        </div>
      </div>

        {/* Collapsed: the company name already moved into the heading above,
            so this bar carries only what's left — domain and active filters. */}
        {!searchOpen && selectedOrg && (
          <div className="chosen">
            <Building size={16} />
            <div className="chosen-meta">
              <span className="mono">{selectedOrg.domain ?? "no domain on record"}</span>
            </div>
            <span className="chosen-filters small muted">
              {countries.length ? countries.join(", ") : "Worldwide"}
              {departments.length > 0 &&
                ` · ${departments.length} department${departments.length === 1 ? "" : "s"}`}
            </span>
          </div>
        )}

        {/* Company overview — news and existing-contact check land as soon as
            the company resolves, flowing directly under the summary bar
            rather than in a separate boxed-off panel. */}
        {!searchOpen && selectedOrg && (
          <div className="overview">
            {selectedOrg.domain && (
              <div className="overview-block">
                <div className="overview-label small muted">Company profile</div>
                {orgProfileLoading ? (
                  <p className="small muted">Loading company profile…</p>
                ) : orgProfileError ? (
                  <p className="small muted">
                    Couldn&apos;t load company profile ({orgProfileError}).
                  </p>
                ) : !orgProfile ? (
                  <button type="button" className="ghost" onClick={loadOrgProfile}>
                    <Building size={14} />
                    Load company profile · 1 credit
                  </button>
                ) : (
                  <>
                    <p className="small">
                      {[
                        orgProfile.industry,
                        orgProfile.employeeCount
                          ? `${orgProfile.employeeCount.toLocaleString()} employees`
                          : null,
                        [orgProfile.city, orgProfile.country].filter(Boolean).join(", ") ||
                          null,
                        orgProfile.foundedYear ? `founded ${orgProfile.foundedYear}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No firmographic detail on record for this domain."}
                    </p>
                    {orgProfile.shortDescription && (
                      <p className="small muted">{orgProfile.shortDescription}</p>
                    )}
                    {orgProfile.publiclyTraded ? (
                      <p className="small muted">
                        Publicly traded
                        {orgProfile.stockSymbol ? ` (${orgProfile.stockSymbol})` : ""}
                      </p>
                    ) : orgProfile.latestFundingStage ? (
                      <p className="small muted">
                        Latest funding: {orgProfile.latestFundingStage}
                        {orgProfile.latestFundingDate
                          ? ` (${new Date(orgProfile.latestFundingDate).toLocaleDateString()})`
                          : ""}
                        {orgProfile.totalFundingPrinted
                          ? ` · ${orgProfile.totalFundingPrinted} raised to date`
                          : ""}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            )}

            {(existingLoading || existingContacts || existingError) && (
              <div className="overview-block">
                {existingLoading ? (
                  <p className="small muted">Checking your sheets for existing contacts…</p>
                ) : existingError ? (
                  <p className="small muted">Couldn&apos;t check existing sheets ({existingError}).</p>
                ) : existingContacts && existingContacts.totalContacts > 0 ? (
                  <div className="notice warn wide">
                    <AlertTriangle size={16} />
                    <div style={{ width: "100%" }}>
                      <strong>
                        {existingContacts.totalContacts} contact
                        {existingContacts.totalContacts === 1 ? "" : "s"} already logged
                      </strong>{" "}
                      for {selectedOrg.name}:{" "}
                      {existingContacts.matches
                        .map((m) => `${m.sheetName} (${m.count})`)
                        .join(", ")}
                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          className="small"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            textDecoration: "underline",
                            cursor: "pointer",
                            color: "inherit",
                          }}
                          onClick={() => setExistingContactsOpen((v) => !v)}
                        >
                          {existingContactsOpen
                            ? "Hide contacts"
                            : `Show all ${existingContacts.totalContacts} contacts`}
                        </button>
                      </div>
                      {existingContactsOpen && (
                        <div className="table-wrap" style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Title</th>
                                <th>Email</th>
                                <th>Sheet</th>
                              </tr>
                            </thead>
                            <tbody>
                              {existingContacts.contacts.map((c, i) => (
                                <tr key={`${c.sheetId}-${c.apolloPersonId || c.email || i}`}>
                                  <td>
                                    {c.firstname} {c.lastname}
                                  </td>
                                  <td className="small">{c.title}</td>
                                  <td className="small">{c.email}</td>
                                  <td className="small muted">{c.sheetName}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : existingContacts ? (
                  <p className="small muted">
                    No existing contacts found for {selectedOrg.name} in your sheets.
                  </p>
                ) : null}
              </div>
            )}

            {(newsLoading || news || newsError) && (
              <div className="overview-block">
                <div className="overview-label small muted">Latest news</div>
                {newsLoading ? (
                  <p className="small muted">Loading…</p>
                ) : newsError ? (
                  <p className="small muted">Couldn&apos;t load news ({newsError}).</p>
                ) : news && news.length === 0 ? (
                  <p className="small muted">No recent coverage found.</p>
                ) : (
                  <ul className="news-list">
                    {news?.map((n, i) => (
                      <li key={i}>
                        <a href={n.link} target="_blank" rel="noopener noreferrer">
                          {n.title}
                        </a>
                        <span className="small muted">
                          {" "}
                          — {n.source || "Google News"}
                          {n.publishedAt
                            ? ` · ${new Date(n.publishedAt).toLocaleDateString()}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {searchOpen && (
        <>
        <p className="panel-note">
          Searching costs no credits and returns no email addresses. Credits are only
          spent in step&nbsp;3, on the people you tick.
        </p>
        <div className="row">
          <div className="grow">
            <input
              type="text"
              placeholder="Company name or domain — e.g. DBS Bank, or dbs.com"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setSelectedOrg(null);
                setOrgs([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) handleSearch();
              }}
              disabled={busy}
            />
          </div>
          <button onClick={() => handleSearch()} disabled={busy || !company.trim()}>
            {stage === "searching" ? (
              <>
                <span className="spinner" />
                Searching…
              </>
            ) : (
              <>
                <Search size={15} />
                Search
              </>
            )}
          </button>
          {stage !== "idle" && (
            <button className="secondary" onClick={reset} disabled={busy}>
              Reset
            </button>
          )}
        </div>
        {/* Quick filters — the settings people change run-to-run. */}
        <div className="quickbar">
          <div className="field">
            <label htmlFor="region">Region</label>
            <select
              id="region"
              value={region}
              onChange={(e) => {
                const label = e.target.value;
                setRegion(label);
                const list = countriesForRegion(label);
                if (list) setCountries(list);
              }}
              disabled={busy}
            >
              {REGIONS.map((r) => (
                <option key={r.label} value={r.label}>
                  {r.label}
                </option>
              ))}
              {region === "Custom" && <option value="Custom">Custom</option>}
            </select>
          </div>

          <div className="field">
            <label>Countries</label>
            <MultiSelect
              options={COUNTRIES.map((c) => ({ value: c, label: c }))}
              selected={countries}
              onChange={(next) => {
                setCountries(next);
                const match = REGIONS.find(
                  (r) =>
                    r.countries.length === next.length &&
                    r.countries.every((c) => next.includes(c)),
                );
                setRegion(match?.label ?? "Custom");
              }}
              placeholder="Worldwide"
            />
          </div>

          <div className="field">
            <label>Departments</label>
            <MultiSelect
              options={departmentOptions}
              selected={departments}
              onChange={setDepartments}
              placeholder="All departments"
            />
          </div>

          <div className="field">
            <label>Seniority</label>
            <MultiSelect
              options={SENIORITIES}
              selected={seniorities}
              onChange={setSeniorities}
              placeholder="Default"
            />
          </div>
        </div>

        {orgs.length > 1 && !selectedOrg && (
          <div style={{ marginTop: 18 }}>
            <div className="notice info">
              <Info size={16} />
              <div>
                Apollo holds several organizations under this name. Pick the right
                one — group structures often split across domains, and the wrong
                record can return nobody.
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Domain</th>
                    <th>Employees</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className="mono">{o.domain ?? "—"}</td>
                      <td>{o.employeeCount?.toLocaleString() ?? "—"}</td>
                      <td>
                        <button
                          onClick={() => {
                            setSelectedOrg(o);
                            handleSearch(o);
                          }}
                        >
                          Use this
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedOrg && (
          <p className="small muted inline-check" style={{ marginTop: 14 }}>
            <Building size={15} />
            Searching <strong style={{ color: "var(--text)" }}>
              {selectedOrg.name}
            </strong>
            <span className="mono">{selectedOrg.domain ?? "no domain on record"}</span>
          </p>
        )}
        </>
        )}
      </section>

      {/* Loading gets shape, rather than a spinner floating in empty space. */}
      {stage === "searching" && (
        <section className="panel" data-stage="review" aria-live="polite">
          <h2>
            <span className="step-num">2</span>Searching Apollo…
          </h2>
          <div className="table-wrap" style={{ padding: 14 }}>
            {[92, 78, 85, 70, 88, 64].map((w, i) => (
              <div
                key={i}
                className="skeleton-row"
                style={{ width: `${w}%`, marginBottom: i === 5 ? 0 : 14 }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state teaches the interface rather than saying "nothing here". */}
      {stage === "review" && candidates.length === 0 && (
        <section className="panel" data-stage="review">
          <h2>
            <span className="step-num">2</span>No one matched
          </h2>
          <div className="empty">
            <Users size={30} />
            <h3>Apollo has nobody at {selectedOrg?.name || company} for these filters</h3>
            <p>
              No credits were spent — searching is always free. The usual causes are a
              location filter that excludes the company&apos;s home market, or a
              job-title list that is too narrow.
            </p>
            {diagnostics.length > 0 && (
              <ul
                className="issues muted"
                style={{ textAlign: "left", margin: "0 auto 20px", maxWidth: "60ch" }}
              >
                {diagnostics.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            <div className="row" style={{ justifyContent: "center" }}>
              <button
                onClick={() => {
                  setCountries([]);
                  setRegion("Worldwide (no filter)");
                  handleSearch(selectedOrg ?? undefined);
                }}
              >
                Retry without a location filter
              </button>
              <button className="secondary" onClick={reset}>
                Try another company
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- Stage 2: review ---------------- */}
      {(stage === "review" || stage === "enriching" || stage === "done") &&
        candidates.length > 0 && (
          <section className="panel" data-stage="review">
            <h2>
              <span className="step-num" data-state={stage === "done" ? "done" : undefined}>
                2
              </span>
              Review before spending credits
            </h2>
            <p className="panel-note">
              Nothing has cost anything yet. Tick the people worth enriching — the
              score and the rule that matched are shown for each.
            </p>

            {diagnostics.length > 0 && (
              <div className="notice warn">
                <AlertTriangle size={16} />
                <div>
                  {diagnostics.map((d, i) => (
                    <p key={i} style={{ margin: i === 0 ? 0 : "6px 0 0" }}>
                      {d}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="readout">
              <div className="cell">
                <div className="label">Found</div>
                <div className="value">{searchMeta?.rawSearchResults ?? 0}</div>
              </div>
              <div className="cell">
                <div className="label">Passed filter</div>
                <div className="value">{kept.length}</div>
              </div>
              <div
                className="cell"
                title="People in this result who are already in a saved CSV or Google Sheet — excluded from the pre-tick above"
              >
                <div className="label">Already saved</div>
                <div className="value">
                  {candidates.filter((c) => c.alreadySourcedIn).length}
                </div>
              </div>
              <div className="cell">
                <div className="label">Selected</div>
                <div className="value">{selectedCount}</div>
              </div>
              <div className="cell">
                <div className="label">Estimated credits</div>
                <div className="value">{creditEstimate}</div>
              </div>
            </div>

            {/* Filter what's already been returned — no re-search, no credits. */}
            <div className="filterbar">
              <div className="search-wrap">
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Filter by name or title…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Filter candidates by name or title"
                />
              </div>
              <div style={{ minWidth: 180 }}>
                <MultiSelect
                  options={departmentOptions}
                  selected={filterDepartments}
                  onChange={setFilterDepartments}
                  placeholder="All departments"
                  compact
                />
              </div>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={emailOnly}
                  onChange={(e) => setEmailOnly(e.target.checked)}
                />
                Has email
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={showRejected}
                  onChange={(e) => setShowRejected(e.target.checked)}
                />
                Show {rejected.length} filtered out
              </label>
              {(query || filterDepartments.length > 0 || emailOnly || showRejected) && (
                <button
                  className="ghost"
                  onClick={() => {
                    setQuery("");
                    setFilterDepartments([]);
                    setEmailOnly(false);
                    setShowRejected(false);
                  }}
                >
                  Clear filters
                </button>
              )}
              <span className="count">
                {visible.length} shown
              </span>
            </div>

            <div className="row" style={{ marginBottom: 12 }}>
              <button onClick={handleEnrich} disabled={busy || selectedCount === 0}>
                {stage === "enriching" ? (
                  <>
                    <span className="spinner" />
                    Enriching {selectedCount}…
                  </>
                ) : (
                  <>
                    <Mail size={15} />
                    Enrich {selectedCount} selected
                  </>
                )}
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setSelectedIds(
                    new Set(
                      kept.filter((c) => c.hasEmail).map((c) => c.apolloPersonId),
                    ),
                  )
                }
                disabled={busy}
              >
                Select all with an email
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setSelectedIds(new Set(kept.map((c) => c.apolloPersonId)))
                }
                disabled={busy}
              >
                Select all passing
              </button>
              <button
                className="secondary"
                onClick={() => setSelectedIds(new Set())}
                disabled={busy}
              >
                Clear
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setSelectedIds(
                    new Set(visible.filter((c) => c.hasEmail).map((c) => c.apolloPersonId)),
                  )
                }
                disabled={busy || visible.length === 0}
                title="Select only the rows currently visible after filtering"
              >
                Select visible
              </button>
            </div>

            <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Name</th>
                    <th>Title</th>
                    <th style={{ width: 70 }}>Email</th>
                    <th style={{ width: 50 }}>Score</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr
                      key={c.apolloPersonId}
                      className={c.decision.keep ? "" : "rejected"}
                      data-selected={selectedIds.has(c.apolloPersonId)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.apolloPersonId)}
                          onChange={() => toggle(c.apolloPersonId)}
                          disabled={busy}
                          aria-label={`Select ${c.firstname} ${c.lastname}`}
                        />
                      </td>
                      <td>
                        <span className="name">
                          {c.firstname} {c.lastname}
                        </span>
                        {c.alreadySourcedIn && (
                          <>
                            <br />
                            <span
                              className="badge warn"
                              title={
                                c.alreadySourcedInType === "csv"
                                  ? "Already in a saved CSV"
                                  : "Already enriched — found in this Google Sheet"
                              }
                            >
                              <Check size={11} />
                              in {c.alreadySourcedIn}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        {c.title}
                        {c.decision.departments.length > 0 && (
                          <div className="dept-list">
                            {c.decision.departments.slice(0, 3).map((d) => (
                              <DeptChip key={d} id={d} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {c.hasEmail ? (
                          <span className="badge good" title="Apollo holds an email">
                            <Mail size={11} />
                            yes
                          </span>
                        ) : (
                          <span className="badge neutral" title="Apollo has no email on record">
                            <MailOff size={11} />
                            none
                          </span>
                        )}
                      </td>
                      <td className="mono">{c.decision.score}</td>
                      <td className="reason">{c.decision.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

      {/* ---------------- Stage 3: summary ---------------- */}
      {stage === "done" && summary && (
        <section className="panel" data-stage="result">
          <h2>
            <span className="step-num" data-state="done">
              3
            </span>
            {summary.company} — {summary.successful} contact
            {summary.successful === 1 ? "" : "s"} ready
          </h2>

          <div className="readout">
            <div className="cell">
              <div className="label">In CSV</div>
              <div className="value pos">{summary.successful}</div>
            </div>
            <div className="cell">
              <div className="label">Dropped</div>
              <div className="value">{summary.failed}</div>
            </div>
            <div className="cell">
              <div className="label">Credits used</div>
              <div className="value">{summary.creditsUsed ?? "—"}</div>
            </div>
            <div className="cell">
              <div className="label">Waterfall recovered</div>
              <div className="value sub">
                {summary.waterfallRecovered} of {summary.waterfallAttempted}
              </div>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 16 }}>
            <button onClick={handleDownload} disabled={contacts.length === 0}>
              <Download size={15} />
              Download {csvName}
            </button>
            <button
              className="secondary"
              onClick={handleSaveToFolder}
              disabled={contacts.length === 0}
            >
              <Save size={15} />
              Save to Apollo Lead Generation
            </button>
            <button
              className="secondary"
              onClick={togglePush}
              disabled={contacts.length === 0}
              aria-expanded={pushOpen}
            >
              <Upload size={15} />
              Push to Sheet
            </button>
            <button
              className="secondary"
              onClick={toggleCreate}
              disabled={contacts.length === 0}
              aria-expanded={createOpen}
            >
              <Plus size={15} />
              Create New Sheet
            </button>
          </div>

          {createOpen && (
            <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
              <div className="field">
                <label htmlFor="new-sheet-title">Sheet name</label>
                <input
                  id="new-sheet-title"
                  type="text"
                  value={newSheetTitle}
                  onChange={(e) => setNewSheetTitle(e.target.value)}
                  placeholder={selectedOrg?.name || company || "New sheet"}
                  disabled={creatingSheet}
                />
              </div>
              <button onClick={handleCreateSheet} disabled={creatingSheet}>
                <Plus size={15} />
                {creatingSheet ? "Creating…" : "Create"}
              </button>
              {createError && (
                <div className="small" style={{ color: "var(--bad)" }}>
                  {createError}
                </div>
              )}
            </div>
          )}

          {pushOpen && (
            <div style={{ marginBottom: 16 }}>
              <div
                className="row"
                style={{
                  marginBottom: 12,
                  alignItems: "flex-end",
                }}
              >
                <div className="field">
                  <label htmlFor="sheet-mode">Destination</label>

                  <select
                    id="sheet-mode"
                    value={sheetMode}
                    onChange={(e) =>
                      setSheetMode(e.target.value as "existing" | "create")
                    }
                    disabled={pushing}
                  >
                    <option value="existing">Existing Google Sheet</option>
                    <option value="create">Create new Google Sheet</option>
                  </select>
                </div>

                {sheetMode === "existing" ? (
                  <div className="field">
                    <label htmlFor="push-sheet">Google Sheet</label>

                    {sheetsLoading ? (
                      <div className="small muted">Loading sheets…</div>
                    ) : sheetsError ? (
                      <div className="small" style={{ color: "var(--bad)" }}>
                        {sheetsError}
                      </div>
                    ) : sheets.length === 0 ? (
                      <div className="small muted">
                        No existing sheets found. Create a new one instead.
                      </div>
                    ) : (
                      <select
                        id="push-sheet"
                        value={selectedSheetId}
                        onChange={(e) => setSelectedSheetId(e.target.value)}
                        disabled={pushing}
                      >
                        {sheets.map((sheet) => (
                          <option key={sheet.id} value={sheet.id}>
                            {sheet.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="new-sheet-name">New sheet name</label>

                    <input
                      id="new-sheet-name"
                      type="text"
                      value={newSheetName}
                      onChange={(e) => setNewSheetName(e.target.value)}
                      placeholder={
                        selectedOrg?.name
                          ? `${selectedOrg.name} Leads`
                          : "Apollo Leads"
                      }
                      disabled={pushing}
                    />
                  </div>
                )}

                <button
                  onClick={handlePushToSheet}
                  disabled={
                    pushing ||
                    contacts.length === 0 ||
                    (sheetMode === "existing" &&
                      (!selectedSheetId || sheets.length === 0)) ||
                    (sheetMode === "create" && !newSheetName.trim())
                  }
                >
                  <Upload size={15} />

                  {pushing
                    ? sheetMode === "create"
                      ? "Creating…"
                      : "Pushing…"
                    : sheetMode === "create"
                      ? "Create & Push"
                      : "Push"}
                </button>
              </div>

              {sheetMode === "create" && (
                <div className="small muted">
                  The spreadsheet will be created in the configured Google Shared Drive
                  folder.
                </div>
              )}
            </div>
          )}

          {pushResult && (
            <div className="notice info">
              <Check size={16} />
              <div>{pushResult}</div>
            </div>
          )}

          {createdSheetUrl && (
            <div className="notice info">
              <Check size={16} />
              <div>
                <a
                  href={createdSheetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google Sheet
                </a>
              </div>
            </div>
          )}

          {savedTo && (
            <div className="notice info">
              <Check size={16} />
              <div>
                Saved to <span className="mono">{savedTo}</span>
              </div>
            </div>
          )}

          {summary.issues.length > 0 && (
            <div className="notice warn">
              <AlertTriangle size={16} />
              <div>
                <strong>Worth knowing about this run</strong>
                <ul className="issues" style={{ marginTop: 6 }}>
                  {summary.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {summary.droppedContacts.length > 0 && (
            <details style={{ marginBottom: 14 }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>
                {summary.droppedContacts.length} dropped contacts and why
              </summary>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Title</th>
                      <th>Reason</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.droppedContacts.map((c) => (
                      <tr key={c.apolloPersonId}>
                        <td>
                          {c.firstname} {c.lastname}
                        </td>
                        <td className="small">{c.title}</td>
                        <td>
                          <span
                            className={`badge ${
                              c.dropped === "wrong_employer" ? "bad" : "warn"
                            }`}
                          >
                            {c.dropped?.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="reason">{c.droppedDetail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <details>
            <summary className="small muted" style={{ cursor: "pointer" }}>
              Run-log row for context.md
            </summary>
            <textarea
              readOnly
              value={buildRunLog(summary)}
              style={{ marginTop: 8 }}
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
        </section>
      )}

      {settings && stage === "review" && (
        <p className="small muted">
          Waterfall {settings.waterfallEnabled ? "on" : "off"} (cap{" "}
          {settings.waterfallCap}) · target {settings.contactTarget} contacts ·{" "}
          <a href="/filters">change</a>
        </p>
      )}

        </div>
      )}

    </div>
  );
}
