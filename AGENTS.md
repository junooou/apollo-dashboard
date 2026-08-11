# AGENTS.md

Orientation for AI coding assistants (Claude Code, Gemini CLI, Codex, Cursor, …)
working on this project. Written to be model-agnostic: it states facts and
constraints rather than assuming any particular tool.

## What this is

A local Next.js app that sources sales contacts from Apollo.io into per-company
CSVs. It automates a workflow previously done by hand. The domain rules live in
`../Apollo Lead Generation/context.md` — **read that file before changing any
filtering logic.** It is the source of truth for who counts as a relevant
contact, and it records the reasoning behind decisions that look arbitrary.

## Commands

```bash
npm install
npm run dev         # http://localhost:3100
npm test            # 122 offline tests, no API calls, no credits
npm run build       # type-checks everything
npm run check-key   # verifies the Apollo key + probes waterfall behaviour
```

## Layout

```
lib/apollo.ts     Apollo REST client — auth, retry/backoff, concurrency limit
lib/filter.ts     Relevance rules engine (the heart of the app)
lib/enrich.ts     Enrichment pipeline + post-reveal guards. SPENDS CREDITS.
lib/csv.ts        CSV read/write, pinned to the shipped schema; dedupe index
lib/settings.ts   Settings persistence (data/settings.json)
lib/runlog.ts     Generates a context.md table row
lib/sheets.ts     Google Sheets client (service account) — see below
lib/news.ts       Google News RSS fetch for the company overview
app/page.tsx      The 3-stage dashboard
app/settings/     Settings UI
app/api/*/route.ts  Server endpoints
criteria.default.json  context.md's rules as data
```

## Constraints you must respect

**1. Credits are real money. Search is free; enrichment is not.**

- `POST /mixed_people/api_search` — 0 credits, returns no emails.
- `POST /people/bulk_match` — 1–9 credits per person, **max 10 per call**,
  0 credits when nothing is found. Observed: 1 credit per standard reveal,
  3 per waterfall.

Never add a code path that enriches without explicit user selection. The
review-then-approve gate in `app/page.tsx` is a deliberate product decision, not
an implementation detail to optimise away.

**2. The MCP connector is not available here.** Earlier sourcing runs used
`mcp__claude_ai_Apollo_io__*` tools inside Claude Code. Those cannot be called
from a web server. This app uses the REST API with `x-api-key`. Do not "simplify"
by reaching for MCP tools.

**3. Never commit or log the API key.** It is server-side only, read from
`.env.local`. It must never reach the browser or an error message.

**4. The CSV schema is fixed.** All 19 existing files use exactly:

```
firstname,lastname,title,company,seniority,email,email_status,linkedin_url,location,apollo_person_id
```

Note `firstname`/`lastname` without underscores — a deliberate correction
recorded in context.md, differing from Apollo's native `first_name`/`last_name`.
The `location` column is always quoted, matching the existing files.

## The filter's three exclusion tiers

Changing this is the easiest way to silently break the app. Precedence in
`lib/filter.ts`:

1. `excludeKeywords` — **always** drops, even alongside a CX keyword. Holds
   unambiguous B2B/backend markers (`h2h`, `ibg`, `wholesale`, `tenant solution`).
   Required because "Group Head of API and H2H Digital Channels" matches the
   include keyword "digital channels" but was explicitly removed in the
   2026-08-04 audit as corporate treasury, not consumer-facing.
2. `conditionalExcludeKeywords` — drops **unless** an include keyword matches.
   From context.md: "wealth management or private banking, unless the role
   specifically covers customer experience." This is what keeps DBS's real
   "Group Head of Consumer Banking and Wealth Management".
3. `negativeSignals` — same conditional behaviour, softer intent. Drops generic
   "Business Insights" while keeping "Customer Experience Insights".

Keyword matching is word-boundary aware with a tolerated trailing `s`. Both
matter: naive substring matching fires "ux" inside "luxury" and misses
"tenant solutions" against the term "tenant solution".

If you change any list, run `npm test`. The suite encodes real audit decisions;
a failure usually means the change is wrong, not the test.

## The wrong-employer guard

`emailMatchesEmployer()` in `lib/filter.ts` exists because of a specific
incident: Apollo returned `siew_low@skyworld.my` — marked *verified* — for an IOI
Properties contact who had multiple concurrent employers. context.md's
conclusion: "a verified email at the wrong company is worse than no email."

Do not relax this guard to raise the hit rate. Widening it needs a real domain
case, and a test alongside.

## Apollo API gotchas (all verified live — do not "fix" these)

Each of these cost real debugging time. They look like bugs; they are not.

**`mixed_people/search` is dead.** It returns HTTP 422, "deprecated for API
callers". Use `mixed_people/api_search`. Its `total_entries` sits at the top
level, not under `pagination`.

**Search results are deliberately degraded.** `api_search` returns
`last_name_obfuscated` ("Ga***i") and omits seniority, location and LinkedIn
entirely. Full details arrive from `bulk_match` at enrichment time — so the
review table shows partial data by necessity, not by oversight. Do not try to
"fix" the masked surnames; only credits can unmask them.

Masking applies to **every** record, with no opt-out. Short surnames like "Lim"
or "Yee" merely look intact because the `Xx***x` pattern has nothing to hide.
Saved CRM contacts are not exempt: a search against a company with 101 saved
records returned an empty `contacts` array and masked `people` only.

**`person_departments` is silently ignored.** Sending any value returns exactly
the same result count as sending a made-up parameter name — Apollo discards
unrecognised filters rather than erroring, which makes a dead filter look alive.
Verified across 11 plausible values, all identical to baseline. Departments are
therefore matched **locally** against the job title in
`departmentsForTitle()`. Confirmed working: `person_titles`,
`person_seniorities`, `person_locations` (which accepts region names like
"Asia", not only countries).

The compensation is `has_email`: a boolean saying whether Apollo holds an email
at all. It drives both ranking and pre-selection, and it is the best defence
against the thin-shortlist problem recorded in context.md.

**Waterfall requires `webhook_url`.** Without it: HTTP 400. But Apollo only
validates the URL's *format*, never its reachability — so the app sends a
deliberately dead `https://example.com/...` and collects results by polling
`GET /webhook_result/{request_id}`. This keeps prospect emails inside Apollo
instead of routing them through a third-party sink like webhook.site. Override
with `WATERFALL_WEBHOOK_URL` if a real endpoint ever exists.

**`webhook_status: "failed"` is the normal, expected outcome.** It describes
delivery of the callback (which fails, because the sink is dead), *not* the
enrichment. The full successful result sits in `webhook_result` regardless.
Never gate on the status field — gate on the presence of `webhook_result`.

**`request_id` overflows JavaScript numbers.** It is a signed 64-bit integer
larger than `Number.MAX_SAFE_INTEGER`, so `JSON.parse` silently rounds it —
`-6263281650000783420` becomes `-6263281650000783000`, and polling that 404s.
`extractRequestId()` reads it from the raw response text with a regex. There is
a regression test for this in `lib/apollo.test.ts`.

**Waterfall returns MULTIPLE emails, including personal ones.** A live run
returned both `tsekoon@dbs.com` and `tsekoon@gmail.com` for one person, both
marked Verified. `pickBestEmail()` prefers the employer domain, then any
non-personal address. Taking the first would write personal addresses into the
CSV, which context.md forbids.

**Credit stats are a POST, not a GET.** `POST /usage_stats/credit_usage_stats`
with an empty body. The documented `GET /usage_stats/api_usage_stats` returns an
empty body on this plan, and the GET form of the credit path 404s. Read
`credit_usage_stats.lead_credit.left_over` — lead credits are what email reveals
draw from.

## The Simple-filters flow — there is NO LLM call

`lib/persona.ts` builds a prompt and parses a pasted reply. **It makes no
network request and imports no AI SDK.** Do not "finish" it by adding one.

The reason is a hard constraint, not an unfinished feature:

- A Claude Pro/Max subscription **does not include API access** — Anthropic's
  help centre states paid plans and the Console are separate products.
- Since February 2026 Anthropic **prohibits** using subscription OAuth
  credentials to authenticate third-party products. That is what ended the
  OpenClaw/OpenCode approach.

So an app cannot call Claude on a user's subscription. A human running the
prompt can, which is why the flow is build-prompt → user pastes into Claude →
paste reply back. It costs nothing and needs no credentials.

If someone asks to "just call the API", that is a different product decision
with a real bill attached — surface it, don't assume it.

**`parsePersonaResponse()` is the risky surface.** It consumes text a human
copied out of a chat window, so it tolerates markdown fences, preamble, and
trailing commentary, and distinguishes "no JSON here" from "truncated paste"
because the fixes differ. Every shape it accepts has a test.

**`normalise()` is the only validation.** Nothing constrains a pasted reply, so
values outside `lib/taxonomy.ts` are discarded rather than passed to Apollo, and
`findDiscarded()` reports what was dropped so a wrong guess is visible.

The filtering and enrichment paths are entirely deterministic and have no
runtime dependency beyond next/react/react-dom. `googleapis` (below) is the
one deliberate exception, added for the Sheets export feature — don't add
further dependencies without a similarly explicit reason.

## Google Sheets integration

`lib/sheets.ts` writes to Google Sheets via a **service account** (JWT), not
an OAuth consent flow — this app runs locally with no public callback URL, so
OAuth's redirect dance doesn't fit, the same reasoning that put waterfall
polling ahead of a webhook. Config lives in `GOOGLE_SERVICE_ACCOUNT_EMAIL` /
`GOOGLE_PRIVATE_KEY` in `.env.local`; see `.env.local.example` for the Cloud
Console setup steps.

**A service account has zero access to any spreadsheet until the sheet is
explicitly shared with its `client_email`, as Editor.** This is the most
common failure mode — a 403/404 from `app/api/sheets/route.ts` almost always
means the target sheet was never shared, not a code bug. `npm run
check-sheets` verifies the credentials and, if `GOOGLE_SHEET_ID` is set,
confirms that specific sheet is reachable.

**`createSpreadsheet()` needs `parentFolderId` to work at all** for a bare
(non-Workspace) service account: such accounts have zero Drive storage quota
of their own, so a plain `spreadsheets.create()` 403s with a generic "caller
does not have permission" — not an obvious quota error. The fix is a folder
the *user* owns and has shared with the service account (Editor); a file
created inside someone else's folder counts against their quota. Pass
`shareWithEmail` too if you also want the new sheet shared back to your own
account for visibility.

**A personal "My Drive" folder still bills new files to the folder owner's
personal quota**, even though the service account created them — confirmed
live (2026-08-06): `storageQuotaExceeded` on a folder-owning account with
only 34MB used, because the account's plan never assigned it a per-user
allocation from the org's pool. If this keeps recurring, move
`parentFolderId` to a **Shared Drive** instead of a personal folder — files
there draw from the Shared Drive's own storage pool, not any individual's
quota, which is Google's documented recommendation for exactly this
service-account-creates-files pattern. `createSpreadsheet()` already passes
`supportsAllDrives: true` so a Shared Drive ID works as `parentFolderId` with
no other code change. Requires Workspace Business Standard or higher — not
available on Business Starter.

Never log `GOOGLE_PRIVATE_KEY` or return it in an API response, same rule as
`APOLLO_API_KEY`.

**"Push to Sheet" (`app/api/sheets/route.ts`, `mode: "pushContacts"`) only
ever appends.** It reads `A1:A1` first to decide whether the target sheet is
empty; if so it prepends a header row, otherwise it appends straight after
the last row via `appendRows`'s `INSERT_ROWS` — it never calls `updateRange`
on existing data. Do not "simplify" this into an overwrite; the whole point is
that multiple sourcing runs land in the same sheet without clobbering earlier
rows.

**The existing-contacts check (`GET /api/sheets?checkCompany=`) is a
heuristic, not an exact lookup.** It reads every spreadsheet in
`GOOGLE_PARENT_FOLDER_ID`, finds each one's `company` column, and matches
case-insensitively with substring fallback in both directions (guarded by
`MIN_FUZZY_LEN` so short names can't match everything) — this absorbs naming
drift like "OCBC" vs "OCBC Bank" between Apollo's canonical name and whatever
got typed into a sheet by hand. It is intentionally forgiving; do not tighten
it to exact-match without checking it still catches real drift cases.

## Company news (`lib/news.ts`)

There is no official free Google News API. This uses the public
`news.google.com/rss/search` endpoint instead — no key, no signup, unofficial
but widely relied on for exactly this. It returns headline, link, source, and
date only — no article body or images. Parsing is a small purpose-built regex
extractor rather than a real XML library, to keep the dependency list from
growing again (see the `googleapis` note above). If Google changes the feed's
markup this will need updating; there is no SLA to depend on.

## Colour system

Colour encodes function; it is never decoration (Operate-mode rule).

- **Stage hues** mark what a step costs: indigo = searching (free), amber = the
  review gate (about to spend), green = banked result. A panel opts in with
  `data-stage="search|review|result"`.
- **Two tokens per stage.** `--stage-*-fill` sits behind white text (≥5:1 in
  both themes); `--stage-*-ink` is the hue used *as* text. This is the same
  split `--accent` needed — one hue cannot do both jobs at AA.
- **Department hues** are a categorical scale rendered as a dot beside an
  always-present label (`DeptChip`), so colour is never the only code and the
  dot never has to carry text contrast.
- Do not put a coloured border on a rounded card — the detector flags it, and
  the craft floor bans thick accent borders on cards.

## Style

TypeScript strict mode. Plain CSS in `app/globals.css` with CSS custom
properties and a dark-mode block — no Tailwind, no UI library, deliberately, so
the app has almost no dependency surface. Comments explain *why* (usually citing
a context.md decision), not *what*.
