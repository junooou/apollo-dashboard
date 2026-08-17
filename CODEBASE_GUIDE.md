# Codebase Structure Guide

> **This is a living document, shared across the whole team.** Every time
> someone adds a feature, renames a file, changes the colour system, or
> changes wording conventions in the app, **update this guide in the same
> change** — don't leave it for later, and don't let it silently go stale.
> The next developer (or the next AI assistant) reading this file will trust
> it as ground truth, so an out-of-date guide is worse than no guide. If you
> read something here that no longer matches the code, fix it on the spot.

This document explains how the codebase is organized, in plain language, for
people who don't necessarily write code day-to-day. If you're a developer
looking for the terse, technical version with implementation gotchas, read
`AGENTS.md` instead — this guide is the friendlier map that points you to it.

**Note:** everything in this guide describes the app as it runs **today**:
locally, one person at a time, files on local disk. The app is planned to
move onto AWS for team-wide use — see `AWS_DEPLOYMENT_NOTES.md` for what's
expected to change structurally when that happens, and update both that file
and this one when it does.

---

## 1. What this project is, in one paragraph

This is a **Next.js** web app (a common framework for building websites/apps
using React and TypeScript). It runs locally on one computer at
`http://localhost:3100`. It has no separate database — it reads and writes
plain files on disk (JSON settings files, CSV contact files, a couple of
local caches). It talks to three outside services over the internet: **Apollo
.io** (finding and revealing sales contacts), **OpenAI** (writing outreach
emails), and **Google** (Sheets/Docs/Drive, to save results into shared
company documents).

---

## 2. Folder-by-folder map

```
apollo-dashboard/
├── app/                    ← Everything the user sees and clicks (the "frontend")
│   ├── page.tsx            ← The main screen: the 3-step Lead Sourcing workflow
│   ├── layout.tsx          ← Wraps every page (shared HTML shell, fonts, etc.)
│   ├── globals.css         ← ALL of the app's visual styling lives in this one file
│   ├── settings/           ← The Settings page
│   ├── filters/            ← The "Targeting filters" page (Simple + Advanced tabs)
│   ├── components/         ← Small reusable UI pieces (dropdowns, icons, chips, the outreach generator)
│   └── api/                ← The "backend" — server code the browser calls to do real work
│       ├── search/         ← Talks to Apollo: free company/people search
│       ├── enrich/         ← Talks to Apollo: paid contact reveal (spends credits)
│       ├── credits/        ← Checks how many Apollo credits are left
│       ├── company/        ← Looks up a company's basic Apollo record
│       ├── news/           ← Fetches recent news headlines about a company
│       ├── org-profile/    ← Talks to Apollo: paid firmographic detail (industry, size, funding — 1 credit)
│       ├── history/        ← Reads back the log of past sourcing runs
│       ├── export/         ← Builds the downloadable CSV file
│       ├── sheets/         ← Reads/writes Google Sheets
│       ├── sheets-index/   ← Status of the cached Voncierge Outreach scan (the header's loading pill)
│       ├── apollo-labels/  ← Lists/creates Apollo lists ("Tag in Apollo") — 0 credits
│       ├── job-signals/    ← Live Singapore hiring-signal listings (MyCareersFuture — free, no key)
│       ├── docs/           ← Saves a generated outreach email as a Google Doc
│       ├── generate-template/ ← Talks to OpenAI: writes the outreach email sequence
│       ├── presets/        ← Saves/loads named filter presets
│       └── settings/       ← Saves/loads the app's saved settings
│
├── lib/                    ← The "brains" — logic shared by multiple screens/routes,
│                              with no UI of its own. Anything that isn't "what does
│                              a button look like" tends to live here.
│   ├── apollo.ts           ← The one place that actually talks to Apollo's API
│   ├── filter.ts           ← THE core rules engine: decides who counts as a relevant contact
│   ├── enrich.ts           ← Runs the paid reveal step + safety checks (wrong email, wrong company, etc.)
│   ├── csv.ts              ← Reads/writes CSV files in the company's fixed format
│   ├── settings.ts         ← Loads/saves the app's settings file
│   ├── history.ts          ← Logs/reads past sourcing runs (local file — see AWS_DEPLOYMENT_NOTES.md)
│   ├── presets.ts          ← Loads/saves saved filter presets (from the Simple tab)
│   ├── persona.ts          ← Builds/parses the "describe who you want" AI prompt (no AI call itself — see below)
│   ├── taxonomy.ts         ← The fixed lists: departments, seniorities, countries, regions
│   ├── runlog.ts           ← Formats the "paste this into context.md" summary line
│   ├── sheets.ts           ← Google Sheets read/write logic
│   ├── docs.ts             ← Google Docs "save this email" logic
│   ├── news.ts             ← Fetches company news headlines (Google News RSS, no API key needed)
│   ├── mycareersfuture.ts  ← MyCareersFuture (SG job portal) client — free, unauthenticated public API
│   ├── job-signal-scoring.ts ← Deterministic 0–100 hiring-signal score — no AI call, no cost
│   ├── types.ts            ← Shared TypeScript type definitions (shapes of data)
│   └── *.test.ts           ← Automated tests, one per major file above
│
├── data/                   ← Local files the app reads/writes at runtime
│   ├── settings.json       ← Your saved filter settings (gitignored — local to you)
│   ├── presets.json        ← Saved "Simple" filter presets (actually tracked in git, shared as a starting point)
│   ├── runs.json           ← Log of past sourcing runs (gitignored — local to this machine, see Run History below)
│   └── job-signals-history.json ← Cached Job Signals listings (gitignored — pruned on every refresh, not kept forever)
│
├── scripts/                 ← One-off command-line helper scripts (e.g. "check my Apollo key works")
├── criteria.default.json    ← The factory-default filter rules, transcribed from context.md
├── prompts/                  ← Saved prompt templates
├── public/                   ← Static files (icons, images) served as-is
│
├── AGENTS.md                ← Technical deep-dive: architecture, gotchas, hard-won lessons (for developers/AI assistants)
├── CLAUDE.md / GEMINI.md     ← Point AI coding assistants at AGENTS.md
├── README.md                  ← Setup instructions + feature walkthrough
├── USER_MANUAL.md              ← THIS guide's sibling: how to use the app (non-technical)
├── CODEBASE_GUIDE.md            ← This file
├── AWS_DEPLOYMENT_NOTES.md       ← Running list of what changes when this moves to AWS for the team
└── GOOGLE_SHEETS_SETUP.md         ← Step-by-step Google Cloud Console setup for Sheets/Docs
```

**Rule of thumb for where new code goes:** if it draws something on screen,
it goes in `app/`. If it's a rule, a calculation, or talks to an outside
service, it goes in `lib/`. `app/api/*/route.ts` files are the bridge between
the two — the browser calls them, and they call into `lib/`.

---

## 3. How a "Lead Sourcing" run actually flows through the code

This mirrors the 3 steps described in `USER_MANUAL.md`, but from the code's
point of view:

1. **Search** — `app/page.tsx` calls `app/api/search/route.ts`, which calls
   `lib/apollo.ts` (free Apollo search), then runs every result through
   `lib/filter.ts` to score and flag them before showing the table.
2. **Review** — no server call at all. Everything (filtering the table,
   ticking rows) happens in the browser instantly, using data already
   fetched.
3. **Enrich** — `app/page.tsx` calls `app/api/enrich/route.ts`, which calls
   `lib/enrich.ts`. That file calls Apollo's paid reveal endpoint in batches
   of 10, then runs the three safety checks (no email / personal email /
   wrong employer) before handing back a clean contact list.
4. **Export** — `app/api/export/route.ts` (CSV download),
   `app/api/sheets/route.ts` (push to Google Sheet), or
   `app/api/apollo-labels/route.ts` ("Tag in Apollo") — built on `lib/csv.ts`,
   `lib/sheets.ts`, and `lib/apollo.ts`'s `tagContactsInApollo()`
   respectively. Tagging is the odd one out: it doesn't write to a local file
   or a Google resource at all — it writes into Apollo's own CRM, via
   `POST /contacts/bulk_create`, since Apollo's list endpoints only accept
   Contact records already saved to the team, not the raw prospect-search
   results this app sources from. Free (0 credits), but still gated behind a
   manual click, same reasoning as Push to Sheet: it's visible to the whole
   team the moment it happens.
5. **Logging** — the very last thing `app/api/enrich/route.ts` does before
   responding is call `lib/history.ts`'s `appendRun()`, so every completed run
   shows up on the `/history` page automatically. This happens regardless of
   what the user does with the result afterwards (download, push to Sheet, or
   nothing).

The **Outreach Studio** tab is a separate, shorter flow:
`app/components/OutreachGenerator.tsx` → `app/api/generate-template/route.ts`
(calls OpenAI) → optionally `app/api/docs/route.ts` → `lib/docs.ts` (saves to
Google Docs).

**Company profile** (the optional "Load company profile" button in Step 1) is
its own small flow, deliberately *not* wired into automatic search: a click
in `app/page.tsx` calls `app/api/org-profile/route.ts`, which calls
`enrichOrganization()` in `lib/apollo.ts`. This is a paid Apollo call — 1
credit, verified live and documented in `AGENTS.md` — so unlike
news/existing-contacts-check (both free) it never fires on its own when a
company is selected; it waits for the explicit click.

**The "Voncierge Outreach loaded" pill in the header** is the app warming a
cache, not a decoration. The moment `app/page.tsx` mounts (i.e. the moment
you open the app in a browser), it calls `app/api/sheets-index/route.ts`,
which scans every spreadsheet reachable from the shared Google Drive
folder — **including subfolders** — and keeps every contact row **in server
memory** via `warmSheetsIndex()` in `lib/sheets.ts`. The subfolder part
matters in practice: the real "Voncierge Outreach" drive keeps every actual
contact sheet inside an "Outreach Sheets" subfolder, not at the top level,
so `listSpreadsheetsInFolder()` walks subfolders first (`collectFolderIds()`,
capped at a depth of 4) before asking Google for spreadsheets — a
direct-children-only version of this function was tried first and silently
found nothing real. Everything that needs to know "does this company already
have contacts sourced" afterwards — the Step 1 overview panel, and the
underlying `GET /api/sheets?checkCompany=` route — reads that cache instead
of re-scanning Google Sheets each time, which is what makes the check
near-instant after the first load. Pushing new contacts to a sheet
automatically drops the cache (`invalidateSheetsIndex()`) so the next check
re-scans rather than showing stale data; there's also a manual ↻ button on
the pill for the same purpose. **This cache lives only as long as the
`npm run dev`/`npm start` process does** — it's not written to disk, and it
resets on every restart.

**Job Signals** (the fourth workspace tab) is the one feed in this app that
fetches live on every single page load, no manual button, no cache-only
default — deliberately different from both the sheets-index pill above and
News Triggers. The reason is simple: `lib/mycareersfuture.ts` calls a
genuinely free, unauthenticated public API (Singapore's official
MyCareersFuture job portal), so there's no credit or credential to protect
by making the user ask for fresh data. `app/api/job-signals/route.ts`'s
`GET` always re-fetches, re-filters out recruitment agencies (by SSIC
industry code — see `AGENTS.md` for how that code was verified), and
re-scores every listing with `lib/job-signal-scoring.ts` — a plain
deterministic function, not an AI call, which is exactly what makes it safe
to run on every load. History is still kept (`data/job-signals-history.json`)
for "is this new since last time" tracking, but unlike News Triggers'
history — which keeps every article forever, because a news event stays
true — job listings that no longer come back from a live fetch are dropped
from history entirely, because a posting MyCareersFuture stops returning has
almost certainly been filled or expired.

---

## 4. The filter rules engine (`lib/filter.ts`) — in plain terms

This is the single most important piece of business logic in the app: it
decides which of the people Apollo finds are actually worth showing you. It
works like a three-layer sieve, checked in this order:

1. **Always exclude** — if a keyword here matches, the person is dropped, no
   exceptions. Reserved for unambiguous "wrong department entirely" signals.
2. **Conditional exclude** — dropped *unless* a "this is relevant" keyword
   also matches somewhere in their title. Used for roles that are usually
   irrelevant but occasionally aren't (e.g. "Wealth Management" is usually
   dropped, but "Consumer Banking **and** Wealth Management" is kept).
3. **Negative signal** — same idea as #2, but a softer, weaker signal.

The full written-out rules (which words, which roles, and *why* each
decision was made) live in the separate `context.md` file at the top of the
whole `voncierge` project folder — `lib/filter.ts` and
`criteria.default.json` are the code's implementation of what that document
says. If you're ever unsure *why* a rule exists, that document has the
reasoning; this codebase just enforces it.

---

## 5. Current visual style ("what the app looks like")

Everything visual lives in **one file**: `app/globals.css` (~2,500 lines).
There is deliberately no design library (no Tailwind, no Material UI, etc.)
— just plain CSS. That keeps the app simple to reason about, at the cost of
more lines in one file.

### Look and feel

- **Typeface:** the system's own default UI font (e.g. San Francisco on Mac,
  Segoe UI on Windows) — no custom font is loaded. Numbers/code use a
  monospace font.
- **Corners:** gently rounded (7px main, 5px small elements) — not sharp,
  not pill-shaped.
- **Shadows:** always a soft, offset shadow (never a flat glow) on floating
  elements like menus.
- **Light and dark mode:** both are fully supported and switch automatically
  based on the visitor's system setting. Every colour below has a light and
  a dark value.

### Colour is never just decoration — it always means something

This is a deliberate rule in the codebase (called "Operate-mode" in the
code's comments): colour is used to communicate function, not to make things
pretty.

- **Step colours** (the 3-step Lead Sourcing workflow): each step is tinted
  by what it costs you.
  - **Indigo** = Step 1, Search — free, exploratory.
  - **Amber** = Step 2, Review — the "about to spend money" gate.
  - **Green** = Step 3, Result — done, paid for, safely saved.
- **Status colours:** green = good, amber = warning, red = bad — used
  consistently everywhere (buttons, badges, banners).
- **Department colours:** each of the 12 department categories (Customer
  Experience, Digital Transformation, AI & Innovation, Design/UX, Loyalty &
  CRM, Operations, Consumer/Retail Banking, Technology Leadership, Product,
  Marketing, Data & Analytics, Customer Service) has its own fixed colour,
  always shown as a small dot **next to a text label** — never colour alone,
  so the app stays usable for colourblind users.
- **One rule that's actively enforced:** no coloured borders are used purely
  as decoration on rounded cards — every colour used has to mean one of the
  things above.

### Type sizes

Only four sizes are used across the whole app (12px labels/badges, 15px body
text, 19px section headings, 24px page title, plus one larger 30px size for
big result numbers). This is intentionally restrained — a dashboard viewed
up close doesn't need the dramatic size jumps a marketing page would use.

---

## 6. Current wording conventions ("how the app talks")

- **App title:** "Outbound Intelligence" (shown top-left of every page).
- **The two workspace tabs:** "**Lead Sourcing**" and "**✦ Outreach
  Studio**" (note the ✦ star character is part of the Outreach Studio label
  — it's used as a small visual flag that this tab is the "creative
  generation" side of the app, distinct from the data-pulling side).
- **The 3 steps are numbered and named** directly on screen: "1 — Find a
  company", "2 — Review before spending credits", "3 — [Company] — N
  contact(s) ready".
- **Tone:** direct, short, and honest about cost. The app never hides that
  something costs Apollo credits — phrases like *"Nothing has cost anything
  yet"* and *"this step spends credits"* appear directly in the UI rather
  than being left to a tooltip or docs page.
- **Empty/error states teach, they don't just say "nothing here."** E.g.
  when a search returns nobody, the app explains the likely cause (a
  location filter excluding the company's home market, or too narrow a
  title list) and offers a one-click retry, rather than a bare "No results."
- **Numbers agree grammatically** with what they describe (e.g. "1 contact"
  vs. "2 contacts") — small detail, but consistently done throughout.

If you add new screens or copy, match this tone: concise, cost-aware,
explains *why* rather than just *what*.

---

## 7. The two "no AI call happens here" features — don't be confused by this

Two parts of the app look like they should call an AI service but
deliberately don't:

1. **`lib/persona.ts`** (the "Simple" filter tab) — builds a prompt for you
   to paste into Claude yourself, then parses whatever you paste back. It
   makes **zero network calls**. This is intentional: a Claude subscription
   (Pro/Max) cannot be used for direct API access under Anthropic's terms, so
   the app can't call Claude on your behalf — you run the prompt yourself,
   for free, in a tool you already have.
2. **The rest of Lead Sourcing** (search, filter, enrich) has **no AI
   involved at all** — it's plain rule-based logic in `lib/filter.ts`.

Only **Outreach Studio** calls a real AI model (OpenAI, via
`app/api/generate-template/route.ts`), and only because that specific
feature needs an API key set up for it.

---

## 8. Tests

`lib/*.test.ts` files hold ~120 automated tests, run with `npm test`. They
run entirely offline (no real Apollo/OpenAI/Google calls, no cost). Many of
them exist to lock in a real decision made during a contact-relevance audit
— if a test fails after you change `lib/filter.ts`, treat that as a signal
the change may be wrong, not the test.

---

## 9. Where to go next

- **Using the app day-to-day:** see `USER_MANUAL.md`.
- **Setup instructions and full feature list:** see `README.md`.
- **Deep technical detail, API gotchas, and the reasoning behind
  non-obvious decisions:** see `AGENTS.md` — this is the canonical technical
  reference and should be read before changing any filtering or enrichment
  logic.
- **Google Sheets/Docs setup:** see `GOOGLE_SHEETS_SETUP.md`.
- **What has to change before/during the move to AWS:** see
  `AWS_DEPLOYMENT_NOTES.md` — add to it whenever you build something that
  assumes local, single-user operation (a local file, an OS username as an
  identity, etc.).
- **The underlying business rules for who counts as a relevant contact:**
  see `context.md` in the parent `voncierge` folder — not part of this
  codebase, but the source of truth `lib/filter.ts` implements.
