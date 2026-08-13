# Apollo Lead Sourcing Dashboard

A local web app, branded on-screen as **Outbound Intelligence**, that turns the
manual Apollo sourcing workflow into a repeatable tool: search a company, review
who the filter picked, approve the shortlist, and get a CSV in the same format
as every file already in `../Apollo Lead Generation/`. A second tab, **Outreach
Studio**, turns a company or industry into a multi-email outreach sequence and
can save it straight to a Google Doc.

The rules it applies come from `../Apollo Lead Generation/context.md` — the
priority roles, the exclusions, the credit policy, and the lessons from previous
sourcing runs.

**New here?** Read **[`USER_MANUAL.md`](./USER_MANUAL.md)** for a non-technical,
step-by-step walkthrough of the whole app — no coding knowledge needed. Developers
and AI assistants should read **[`CODEBASE_GUIDE.md`](./CODEBASE_GUIDE.md)** for a
plain-language map of the folder structure, styling, and wording conventions, and
**[`AGENTS.md`](./AGENTS.md)** for the full technical reference. Both `USER_MANUAL.md`
and `CODEBASE_GUIDE.md` are living documents — update them whenever you ship a
feature that changes what's described in them.

## Setup

You need **Node 20+** and an **Apollo API key**. Google Sheets/Docs export and
the outreach email generator are optional add-ons, each gated behind their own
key — the core sourcing workflow runs without either.

```bash
cd apollo-dashboard
npm install
cp .env.local.example .env.local   # then paste your keys into it
npm run check-key                  # pre-flight: verifies the Apollo key works
npm run dev                        # http://localhost:3100
```

### Getting an Apollo API key

Apollo → **Settings → Integrations → API → API Keys**. The key needs master
scope to reach both the search and enrichment endpoints.

This is required. The MCP connector used inside Claude Code cannot be used here —
MCP connectors only exist inside an AI client and cannot be called from a web
server. The key is read server-side from `.env.local` and is never sent to the
browser.

### Getting an OpenAI API key (optional — outreach email generator)

platform.openai.com → **API keys → Create new secret key**. Powers
`app/api/generate-template/route.ts` — see
[Outreach email generator](#outreach-email-generator) below. Without
`OPENAI_API_KEY` set, that one feature errors; the rest of the app is
unaffected.

### Google Sheets/Docs export (optional)

A service account, not a personal API key — see `GOOGLE_SHEETS_SETUP.md` for
the full walkthrough, and `npm run check-drive` to verify it once configured.

## How a run works

The app has two tabs: **Lead Sourcing** (below) and **Outreach Studio** (see
[Outreach email generator](#outreach-email-generator)). Lead Sourcing runs in
three stages, with a deliberate gate in the middle.

**1. Search — free.** Enter a company name or domain. Apollo's people-search
endpoint costs **zero credits** and returns no emails, so the net is cast wide.
If several organizations match, you pick the right one — group structures often
split across domains (Sunway's corporate HQ vs its mall business unit).

Four filters sit directly under the search box — **region**, **countries**,
**departments** and **seniority** — because those are what change run to run.
They override your saved defaults for that search only. Picking a region fills
in its countries; you can then adjust individual countries freely.

Apollo masks surnames at this stage ("Ga***i") and withholds location and
LinkedIn until you pay. That is Apollo's behaviour, not a limitation of this
app — the full details arrive at enrichment. Short surnames like "Lim" just
look intact because there is nothing to mask.

**2. Review — the credit gate.** Every candidate appears with a score and the
rule that matched, so you can see *why* someone was kept or dropped. Nothing has
cost anything yet, and the estimated credit range is shown before you commit.

Each row also shows whether Apollo **has an email** for that person. Only people
with one are pre-ticked, because those without will almost certainly fail
enrichment — this is the direct fix for runs that landed 7 contacts against a
target of 20. Anyone already present in an existing CSV is flagged and skipped.

A filter bar above the table narrows what's already been returned — by name or
title, by department, or to people with an email. It's instant and costs
nothing, since it filters results you already have rather than re-searching.
"Select visible" then ticks exactly what's on screen.

**3. Enrich — this spends credits.** Only the people you ticked are submitted, in
batches of 10. Results run through three guards before reaching the CSV:

- **No email** → dropped (costs 0 credits; Apollo doesn't charge for a miss).
- **Personal domain** (gmail, yahoo, …) → dropped.
- **Wrong employer** → dropped. Apollo can return a "verified" email belonging to
  a *different* concurrent employer; the IOI Properties run surfaced
  `siew_low@skyworld.my` for an IOI contact. A verified email at the wrong
  company is worse than no email, so the app checks the domain and rejects
  mismatches.

If waterfall is enabled, contacts that found no email get one retry pass through
Apollo's third-party sources, capped (default 10 per company).

Then: summary with credits used, success/failure counts, an itemised issues log,
CSV download, and a ready-to-paste run-log row for `context.md`.

## Filters

At `/filters`, in two tabs. Everything is stored in `data/settings.json`, which
is gitignored — your tuning stays local. "Reset to defaults" restores the values
transcribed from `context.md` in `criteria.default.json`.

### Simple — describe the persona

Write who you want to reach in plain English ("heads of customer experience at
banks in Singapore and Malaysia"). Claude reads it and proposes the criteria:
departments, seniority, locations, job titles, exclusions. The field's border
cycles through the spectrum while it thinks.

You always see the proposal before it applies — including a one-line read-back
of what it understood and a rationale naming anything it inferred rather than
was told, so a wrong guess is visible instead of silent. Applying it merges the
keywords into the existing `context.md` rules rather than replacing them.

Save a persona as a preset to reuse it. Presets live in `data/presets.json`.

### How it works — and why there's no API key

Three steps: the app builds a prompt from your description, you run it in Claude
yourself, you paste the answer back.

1. **Describe** the persona and press "Build the prompt".
2. **Copy** it into Claude — claude.ai, the desktop app, or a Claude Code
   session. Any plan works, including Pro.
3. **Paste** the JSON reply back. A code fence or a sentence of preamble is
   stripped for you.

This is deliberate, not a limitation we failed to remove. **A Claude Pro or Max
subscription does not include API access** — Anthropic's own help centre is
explicit that paid plans and the Console are separate products — and since
February 2026 Anthropic prohibits using subscription OAuth credentials to
authenticate third-party applications. So an app cannot call Claude on your
subscription's behalf. A person running a prompt can.

The upside is that this tab needs **no credentials, no API key, and costs
nothing** beyond a plan you already have. The app makes no network call here at
all; `lib/persona.ts` is pure string handling.

Whatever comes back is validated against the taxonomy before it is applied —
department ids, seniorities and country names outside the allowed lists are
discarded rather than silently passed to Apollo.

### Advanced — every criterion directly

- **Waterfall** on/off and its per-company cap
- **Contacts per company** (default 20)
- **Filename override** (default: the company name, per convention)
- **Phone column** (off — none of the shipped CSVs have one; phone reveals cost
  roughly 8 extra credits each)
- **Search criteria** sent to Apollo: titles, seniorities, locations
- **Relevance rules** applied locally at no cost

## Outreach email generator

On the main dashboard, below the sourcing workflow. Generates a multi-email
outreach sequence scoped to either a **company** or an **industry** — pick the
scope, enter the target and any extra context, and it calls OpenAI
(`app/api/generate-template/route.ts`, `OPENAI_API_KEY` required) for a named
campaign: a sequencing rationale plus subject/body per email.

You can ask for a **revision** in plain English (e.g. "make the second email
shorter") without starting over, and **save the result as a Google Doc**
(`lib/docs.ts`) into the same Drive folder used for Sheets export
(`GOOGLE_PARENT_FOLDER_ID`) — so it needs the Google service account set up too
if you want that step, not just the OpenAI key.

## Colour

Colour is bound to function, not decoration. Each workflow step owns a hue that
says what it costs you — indigo while searching (free), amber at the review gate
(about to spend), green on the result (banked) — and the 12 departments each
have a categorical hue shown as a dot beside its always-present label, so colour
is never the only thing carrying meaning.

### The three tiers of exclusion

This distinction matters, and it exists because a flat keyword list gets real
cases wrong:

| Tier | Behaviour | Example |
|---|---|---|
| **Exclude** | Always drops, even with a CX keyword present | `H2H Digital Channels` matches "digital channels" but is corporate treasury |
| **Conditional exclude** | Drops *unless* a CX keyword also matches | `Wealth Management` drops, but `Consumer Banking and Wealth Management` is kept |
| **Negative signal** | Drops *unless* a CX keyword also matches, softer intent | `Business Insights` drops, `Customer Experience Insights` is kept |

## Output

CSVs use the exact schema of the 19 existing files:

```
firstname,lastname,title,company,seniority,email,email_status,linkedin_url,location,apollo_person_id
```

"Download CSV" saves through the browser. "Save to Apollo Lead Generation folder"
writes straight into `../Apollo Lead Generation/` — possible because this runs
locally. Set `OUTPUT_DIR` in `.env.local` to point somewhere else.

## Tests

```bash
npm test
```

122 tests, all offline — no API calls, no credits. The cases come from real
decisions in `context.md`, especially the 2026-08-04 relevance audit, so a
failure here means the app has drifted from the agreed criteria.

## Sharing with colleagues

Each person clones the repo, runs `npm install`, and adds a key to their own
`.env.local`. If you share one team key, remember everyone draws from the same
credit pool.

One consequence worth knowing: the "credits used" figure in the run summary is a
before/after snapshot of the account balance, so **concurrent use by a colleague
inflates it**. Observed during development: 16 credits disappeared between two
readings while only free searches were running locally. If the number looks
wrong, that is usually why — the per-contact reality is roughly 1 credit for a
standard reveal and 3 for a waterfall.

There is no authentication — do not expose this to the internet as-is. It binds
to localhost by design.

## Troubleshooting

**"APOLLO_API_KEY is not set"** — create `.env.local` (not `.env`) and restart
`npm run dev`; Next.js only reads env files at startup.

**Key rejected (401/403)** — the key may lack master scope, or the plan may not
include API access. `npm run check-key` will tell you which.

**Credits show "—"** — the app returns null rather than guessing if the usage
endpoint is unavailable. Harmless; everything else still works.

**"Cannot find module './331.js'" or random 500s** — the `.next` cache is
corrupted, usually from running `npm run build` while `npm run dev` was live.
Stop the server, `rm -rf .next`, and start it again.

**Search returns nobody** — the company may be matched to the wrong Apollo org.
Try the domain (`dbs.com`) instead of the name, or widen the title list in
Settings.

**Surnames look like `Ch***n`** — expected. Apollo masks them until enrichment;
the CSV gets the real name.

**Waterfall logs a "failed" webhook status** — also expected, and not an error.
The app deliberately sends an unreachable webhook URL so that no third party
receives your prospects' data, then polls Apollo for the result. Delivery fails;
the enrichment succeeds. `AGENTS.md` explains the mechanism.
