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

**This app is being moved to AWS for team-wide use.** It still runs locally
today (single user, local files, no auth) — see **`AWS_DEPLOYMENT_NOTES.md`**
for the running list of what has to change before/during that move, and add to
it whenever you build something that assumes local, single-user operation
(local file storage, an OS username as an identity, etc.).

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
lib/history.ts    Run history persistence (data/runs.json) — local file, see below
lib/runlog.ts     Generates a context.md table row
lib/sheets.ts     Google Sheets client (service account) — see below
lib/news.ts       Google News RSS fetch for the company overview
lib/mycareersfuture.ts     MyCareersFuture (SG job portal) client — free, no key
lib/job-signal-scoring.ts  Deterministic scoring for Job Signals — no AI, no cost
app/page.tsx      The 3-stage dashboard
app/history/      Run History dashboard — past runs logged on this machine
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
- `GET /organizations/enrich` — **1 credit per call**, verified live
  (2026-08-13: three consecutive calls each dropped the account balance by
  exactly 1). This is despite `searchOrganizations()` in `lib/apollo.ts` also
  calling this same endpoint during the (free) Step 1 company search when a
  user types a domain rather than a name — that path is free in practice only
  because most lookups go through `mixed_companies/search` instead. Any *new*
  caller of `enrichOrganization()` (the org-profile/firmographic-detail
  function) must go behind an explicit user action, same as people enrichment
  — see the "Load company profile" button in `app/page.tsx`, which exists
  specifically so this never fires automatically on company selection.

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

**MCP is never involved here, same as with Apollo.** The
`mcp__claude_ai_Google_Drive__*` tools some AI clients have access to are a
Claude-Code-only mechanism for diagnostics in a chat session — they run
under the *user's own* Google OAuth identity, not this app's. This deployed
Next.js server has no MCP client and cannot call MCP tools; it only ever
reaches Google via `googleapis` and this service account's JWT, exactly like
Apollo's REST API. If Google Sheets/Docs access looks broken, the fix is
always in `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY`/sharing
settings or the query logic in `lib/sheets.ts` — never "enable MCP", which
isn't a thing this app has a slot for. Verified live (2026-08-13): the
service account already has full member access to the "Voncierge Outreach"
shared drive (`drives.get` on `GOOGLE_PARENT_FOLDER_ID` succeeds), so a
report of "can't find X" there is a query-logic question (see
`listSpreadsheetsInFolder()` below), not an access question.

**A service account has zero access to any spreadsheet until the sheet is
explicitly shared with its `client_email`, as Editor.** This is the most
common failure mode — a 403/404 from `app/api/sheets/route.ts` almost always
means the target sheet was never shared, not a code bug. `npm run
check-drive` verifies the credentials and, if `GOOGLE_SHEET_ID` is set,
confirms that specific sheet is reachable. Named for the shared Drive folder
(`GOOGLE_PARENT_FOLDER_ID`) rather than "sheets" specifically, since that
folder now holds both generated spreadsheets and the email-template Docs from
`lib/docs.ts`.

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
heuristic, not an exact lookup.** It reads every spreadsheet reachable from
`GOOGLE_PARENT_FOLDER_ID` (see below — this now means subfolders too), finds
each one's `company` column, and matches case-insensitively with substring
fallback in both directions (guarded by `MIN_FUZZY_LEN` so short names can't
match everything) — this absorbs naming drift like "OCBC" vs "OCBC Bank"
between Apollo's canonical name and whatever got typed into a sheet by hand.
It is intentionally forgiving; do not tighten it to exact-match without
checking it still catches real drift cases.

**`listSpreadsheetsInFolder()` recurses into subfolders — this was a real
bug until 2026-08-13.** It originally queried only `'<folderId>' in parents`,
i.e. files directly inside the configured folder. The real "Voncierge
Outreach" shared drive doesn't keep sheets at that top level at all — every
actual sourced-contact sheet lives one level down, inside an "Outreach
Sheets" subfolder (confirmed live: DBS Bank has 36 real contacts in "1st
Outreach Wave - Competitor Reach (Amity & Tetherfi) 2026", inside that
subfolder). The old code silently found zero matches for every company,
every time — not a credentials problem, not an MCP problem (the app never
uses MCP; a service account via `googleapis` has full read/write access,
confirmed live via `drives.get`/`drives.list`), just a folder-depth-of-1
assumption that didn't match how the real Drive is organized. Fixed by
`collectFolderIds()` walking subfolders breadth-first up to
`MAX_FOLDER_DEPTH` (4) before querying — see `lib/sheets.ts`. If this ever
regresses to "finds nothing", check folder depth before anything else.

**Data quality inside the sheets themselves is not this app's problem to
silently fix.** Some rows in "1st Outreach Wave - Competitor Reach" have a
seniority-tier word ("manager", "vp", "c_suite", "owner") sitting in the
`email` column and a real email address sitting in `linkedin_url` — the
sheet's own data is shifted for those rows, most likely a missing
`seniority` column in that particular sheet's header versus its data. This
app reads exactly what's in the cells under whatever header names are
present; it does not guess or reshuffle values. If asked to "fix" this,
that's a decision for whoever owns that sheet to make by editing it
directly, not something to patch around in code.

**"No existing contacts found" only means no Google Sheet has that company —
it says nothing about local CSVs.** Verified live (2026-08-13): DBS Bank
correctly shows "no existing contacts found in your sheets" because DBS's
contacts were only ever saved to `Apollo Lead Generation/DBS.csv`, never
pushed to a Sheet via "Push to Sheet". This is not a bug in the check; it is
the check doing exactly what its name says. The separate, existing local-CSV
dedupe (`indexExistingContacts` in `lib/csv.ts`, used inside
`app/api/search/route.ts` to flag `ScoredCandidate.alreadySourcedIn` as
`"csv"`) is what covers CSV-only history — the two checks are intentionally
separate data sources, not one unified index. Don't conflate a user asking
"why doesn't the app know about this CSV-only contact" with a Sheets-check
bug.

**The sheets index (`lib/sheets.ts`: `warmSheetsIndex` / `getCachedSheetsIndex`
/ `invalidateSheetsIndex`) is an in-memory, whole-folder cache that makes the
above check fast.** Before this existed, every single `checkCompany` call
re-scanned every spreadsheet in the folder from scratch (`readRange` on each,
up to `A1:Z5000`) — slow, and repeated on every company selection in a
session. Now the first caller (in practice, `app/page.tsx`'s mount-time call
to `app/api/sheets-index/route.ts`, which drives the "Loading Voncierge
Outreach…" header pill) scans once and caches every contact row from every
sheet; `findContactsForCompany` then just filters that cached array in
memory. **Call `invalidateSheetsIndex()` after any write that changes what's
in the folder** (`app/api/sheets/route.ts` already does, after
create/append/update/pushContacts) — otherwise a push in the same session
would silently not show up in the next check until the server restarts. This
cache is per-process, in server memory, not a file — it does not persist
across restarts and, once this runs as multiple AWS instances behind a load
balancer, will not be consistent across them; see `AWS_DEPLOYMENT_NOTES.md`.

An `instrumentation.ts` `register()` hook was tried to start this scan at
server-process boot rather than waiting for a browser tab — **reverted**,
because Next.js also compiles `instrumentation.ts` for the Edge runtime, and
`googleapis` (pulled in via `lib/sheets.ts`) needs Node-only builtins that
don't exist there. The runtime-guarded import still broke the Edge
*compilation* and took the whole app down with 500s. Do not re-add a direct
`lib/sheets` import to `instrumentation.ts`; see the note in
`app/api/sheets-index/route.ts` for the safe way to revisit this (route it
through `fetch()` instead).

## LinkedIn Drafts (Outreach Studio sub-tab)

A second channel alongside the email `OutreachGenerator`, in
`app/components/LinkedInDraftGenerator.tsx` — reachable via a segmented
toggle inside the existing Outreach Studio tab, not a new top-level
workspace tab. Company picker is `GET /api/sheets?listCompanies=1`, which
dedupes company names off the already-warmed sheets index — no new Sheets
calls beyond what `warmSheetsIndex` already does.

**There is no LinkedIn API, official or otherwise, that this app (or any
third party) can use to send a connection request, or to verify one was
sent.** LinkedIn's User Agreement prohibits automated messaging/connecting,
and detection leads to account restrictions or bans — this was a deliberate
decision after weighing automation tools (PhantomBuster, Dux-Soup, etc.)
that operate this way anyway. So "Mark as Sent" in the UI is a **trusted
manual confirmation**, not a verified event — same trust model as the
Simple-filters paste-from-Claude flow. Do not add a "send" button here; if
someone asks for one, that's a product decision with real ToS/ban risk
attached, not a bug to fix.

**Drafts are connection notes, not InMail.** Capped at 200 characters
(LinkedIn's actual limit for the note sent with a connection request) —
`prompts/voncierge_linkedin_draft_guidelines.md` is the tone/format
reference, parallel to the email guide but written for one bespoke message
per already-known contact rather than a `{firstname}`/`{company}` merge-field
template. `app/api/generate-linkedin-drafts/route.ts` batches every selected
contact into one OpenAI call (matched back by a `key` field) rather than one
call per contact, same cost-shape reasoning as `generate-template`.

**Sheets formatting is a new code path.** Every existing `lib/sheets.ts`
writer (`appendRows`, `updateRange`) only ever touches cell *values* via the
`spreadsheets.values.*` endpoints. Shading the `linkedin_url` cell green on
"Mark as Sent" needed `spreadsheets.batchUpdate`'s `repeatCell` request
instead, which addresses a sheet by its internal numeric `gid` — not by name
or tab index — so `getFirstSheetId()` fetches and caches that per
spreadsheet (`sheets.get`, `fields: sheets.properties(sheetId,index)`,
picking `index === 0`). Cached for the process lifetime; a tab's gid only
changes if the tab itself is deleted and recreated, which none of this
app's flows do.

**Tracking columns are added on demand, per sheet, not part of the fixed CSV
schema.** `ensureLinkedinTrackingColumns()` reads a sheet's header, and only
appends `linkedin_status`/`linkedin_sent_at` if that sheet doesn't already
have them — completely separate from the 10-column schema `lib/csv.ts`'s
`contactsToRows` writes (see "The CSV schema is fixed" above). This can't
drift that schema because it only ever extends a sheet's *own* header past
whatever `pushContacts` already wrote, never rewrites existing columns.

`SheetContact` (from `scanAllContacts`/the warm index) now also carries
`rowIndex` (1-based, header is row 1) so "Mark as Sent" can target the exact
row without re-searching, plus `linkedinStatus`/`linkedinSentAt` when a
sheet already has those columns — this is what lets the UI show "Already
sent" immediately on loading a company's contacts, before generating
anything new. It also now carries `seniority`/`location` when a sheet has
those columns (part of the standard 10-column schema, just previously unread
by this type) — fed into draft generation as extra personalization inputs.

**Personalization also pulls in signals from elsewhere in the app, at zero
extra cost.** `lib/linkedin-personalization.ts`'s `findNewsAngle()` and
`findJobSignalAngle()` are pure reads of `data/news-history.json` and
`data/job-signals-history.json` — the same on-disk stores
`app/api/news-triggers/route.ts` and `app/api/job-signals/route.ts` already
maintain — filtered to the target company (fuzzy match, same rule as
`lib/sheets.ts`'s `companyNamesMatch`) and gated at `relevanceScore >= 70`,
reusing the exact bar both of those tabs already use for "worth acting on"
rather than inventing a third threshold. This makes **zero** new network or
OpenAI calls; it only surfaces what those tabs already scored. If neither
history file has a match above the bar, the generator gets `None detected`
and drafts purely off contact-level fields — this is expected for most
companies, not a bug.

**A detected signal is deliberately optional, and batches must vary.**
`app/api/generate-linkedin-drafts/route.ts` passes at most one company-level
angle alongside every contact in the batch, with an explicit instruction not
to reuse the same signal-anchored sentence across multiple contacts at the
same company, and to vary which detail (title/seniority/location/signal)
anchors each note — otherwise a batch of five contacts at one company would
read as one templated note with the name swapped, which defeats the point of
personalizing at all.

## Company news (`lib/news.ts`)

There is no official free Google News API. This uses the public
`news.google.com/rss/search` endpoint instead — no key, no signup, unofficial
but widely relied on for exactly this. It returns headline, link, source, and
date only — no article body or images. Parsing is a small purpose-built regex
extractor rather than a real XML library, to keep the dependency list from
growing again (see the `googleapis` note above). If Google changes the feed's
markup this will need updating; there is no SLA to depend on.

## Job Signals (`lib/mycareersfuture.ts`, `lib/job-signal-scoring.ts`)

A fourth workspace tab, in the same "scored signal feed" family as News
Triggers, but built on a genuinely free, unauthenticated public API —
MyCareersFuture, Singapore's official government job portal
(`api.mycareersfuture.gov.sg/v2/jobs`). No key, no signup, verified live
(2026-08-13).

**Fetch trigger is deliberately different from News Triggers.** News
Triggers gates its refresh behind a manual button because Currents + OpenAI
cost real money per call. MyCareersFuture costs nothing, so Job Signals
fetches live on every page mount and every browser refresh — no cache-only
default, no `?refresh=1` param. `app/api/job-signals/route.ts`'s `GET` always
calls `refreshJobSignals()`.

**Scoring is deterministic, not AI.** Job titles and departments are
exact-match-able in a way news headlines aren't, so `lib/job-signal-scoring.ts`
computes a 0–100 score from: 50 base (matched a target department) + up to 15
for seniority (MyCareersFuture's own `positionLevels` field, backed by a
title-text fallback for roles it under-labels) + up to 10 for freshness
(decays after 14 days — deliberately, so an old listing doesn't stay
permanently "hot") + 30 if the company is already in
`Apollo Lead Generation/` (via `outputDir()` from `lib/csv.ts`, same folder
the CSV dedupe already reads). No network call, no cost — this is what makes
it safe to score on every single page load.

**Recruitment agencies are filtered out.** Verified live: Singapore's SSIC
code `78104` ("Employment placement agencies and executive search services")
was confirmed against five staffing firms (Persol, GMP Recruitment, The
Supreme HR Advisory, EA Recruitment, People Profilers, JobStudio) that were
otherwise dominating results — a posting from one of these is a signal for
an undisclosed end client, not the agency itself, and MyCareersFuture doesn't
reveal who that client is. `RECRUITMENT_AGENCY_SSIC_CODES` in
`lib/mycareersfuture.ts` filters on this before scoring even runs.

**History intentionally does NOT accumulate forever, unlike News Triggers.**
A news event stays true after it happened; a job posting that's no longer
returned by MyCareersFuture has very likely been filled or expired.
`app/api/job-signals/route.ts` drops history entries not present in the
latest live fetch rather than keeping them — referencing an outreach angle
around an already-closed role is worse than not mentioning it. If this ever
needs revisiting (e.g. to show "recently closed" for context), that's a
deliberate product decision, not a bug to "fix" back to News Triggers'
keep-forever behaviour.

**Coverage is Singapore-only.** Several companies already in
`Apollo Lead Generation/` are based in Malaysia, Thailand, or Indonesia
(Sunway, Siam Piwat, The Mall Group, KLCC, Pavilion, IOI Properties, Pacific
Place Jakarta) and will never appear here. This complements the pipeline's
Singapore coverage; it does not replace the rest.

**`scripts/prototype-mycareersfuture.ts`** is the throwaway script that
validated the API before this feature was built — a standalone CLI check,
not wired into the app. Safe to delete once nobody needs it as a quick
debugging reference outside the running app.

## Job Signals → Explore Outreach

The Job Signals "Generate outreach" button was replaced with "Explore
outreach" (`app/page.tsx`'s `handleExploreOutreachFromJobSignal`), which no
longer prefills Outreach Studio. Instead it opens
`app/components/JobSignalOutreachView.tsx`, a dedicated dashboard for one job
signal: employer info, auto-loaded management contacts, then explicit
enrich/save/mark-contacted steps — a separate flow from Outreach Studio's
email/LinkedIn drafting, which still only operates on already-sourced
contacts.

**Who to pitch is not who's in the job listing.** A "hotel concierge"
posting is the signal (see `isFrontlineSignal` in `lib/job-signal-scoring.ts`)
but the pitch target is a decision-maker — General Manager, Front Office
Manager, etc. `lib/job-signal-persona.ts`'s `getOutreachPersona()` maps the
employer's SSIC code (MyCareersFuture's `company.ssicCode`) to an
industry-specific title list, falling back to the same generic CX titles
used elsewhere when the SSIC code isn't covered. **This mapping is a
best-effort product decision, not verified against live data** the way
`RECRUITMENT_AGENCY_SSIC_CODES` is — extend `PERSONA_RULES` as new verticals
show up.

**The contact search deliberately skips `lib/filter.ts`'s `filterAndRank`.**
That pipeline's department gate (`evaluateCandidate`, `lib/filter.ts`) hard-
excludes any title outside `settings.departments`, which is tuned for the
banking/retail CX taxonomy in `lib/taxonomy.ts` — a "Front Office Manager"
title matches none of those departments and would be silently dropped.
`app/api/job-signal-outreach/route.ts`'s `GET` calls `searchPeople` directly
with the persona's own title list (already the narrowing step) and ranks by
`hasEmail` only.

**Both calls in the GET handler are free.** `searchOrganizations` resolves a
domain via `mixed_companies/search`, and `searchPeople` via
`mixed_people/api_search` — no credits, per the credit-safety rule above.
Enrichment only happens when the user selects contacts and hits "Enrich
selected", reusing `/api/enrich` unchanged (it takes full `ScoredCandidate`
objects, and the GET response already returns candidates in that exact
shape so the frontend can pass them straight through).

**Saved contacts land in one running "Job Signals Outreach" sheet, not a
sheet per company** — a deliberate product decision so "who have we already
contacted from a job signal" is a single scan, unlike the per-company sheets
`app/api/sheets/route.ts`'s `pushContacts` targets.
`getOrCreateJobSignalOutreachSheet()` (`lib/sheets.ts`) finds it by name
inside `GOOGLE_PARENT_FOLDER_ID` (or creates it on first save);
`GOOGLE_JOB_SIGNALS_SHEET_ID` overrides the lookup. Rows are the standard
10-column schema (`lib/csv.ts`'s `contactsToRows`) plus `job_title`,
`job_url`, `outreach_persona` — see `jobSignalContactsToRows`.

**"Mark contacted" reuses the LinkedIn Drafts green-shading pattern, but
anchors on `email` instead of `linkedin_url`.** A Job Signals contact might
be reached by email or LinkedIn — the sheet doesn't track which, same trust
model as "Mark as Sent" elsewhere (a manual confirmation, not a verified
event). `ensureLinkedinTrackingColumns`/`markLinkedinContactSent` were
generalized into a shared `ensureTrackingColumns` helper plus
`markJobSignalContacted`, both in `lib/sheets.ts`.

## Tag in Apollo (labels/lists)

A fourth action alongside Download/Save/Push to Sheet in the Stage 3 summary
panel, in `app/page.tsx` (state prefixed `label`/`tag`) and
`app/api/apollo-labels/route.ts`. Adds the just-sourced contacts to a named
Apollo "list" (Apollo's UI calls these Labels; the API calls them Lists —
`GET/POST /labels`), so the team's Apollo CRM view can be filtered to exactly
what this app sourced, without a second data store.

**Apollo's label endpoints do not operate on searched people.** Verified
against Apollo's own API docs (2026-08-15): `entity_ids` for
`/labels/add_entity_ids_to_label_names` must be existing Contact/Account
records already saved to the team, obtained via "Search for Contacts" — which
"only returns contacts... added to your team's Apollo account," explicitly
distinct from the People API Search this app already uses for sourcing. The
`apolloPersonId` this app carries throughout (from `mixed_people/api_search`
and `people/bulk_match`) is a prospect-database id, not a Contact id, and
cannot be labeled directly.

**`tagContactsInApollo()` (`lib/apollo.ts`) bridges the two via
`POST /contacts/bulk_create`**, which creates-or-dedupes up to 100 contacts
and applies `append_label_names` in the same call — no separate
create-then-label round trip needed for the common case. `run_dedupe: true`
means calling this again for an already-tagged contact updates the existing
Apollo Contact in place rather than creating a duplicate; the response's
`existing_contacts` vs `created_contacts` split is surfaced in the UI ("N new,
M already in Apollo") so a repeat tag isn't silently miscounted as new.

**Confirmed FREE — 0 credits**, per Apollo's docs for every endpoint involved
(`/labels`, `/labels/add_entity_ids_to_label_names`,
`/contacts/bulk_create`), unlike `enrichOrganization()`/`bulkMatch()` above.
`GET /labels` was verified live (2026-08-15) against the real account; its
response shape matches the documented one exactly. Still gated behind an
explicit "Tag in Apollo" button rather than running automatically on save —
not a credit concern here, but it writes into the team's shared Apollo CRM,
visible to everyone on the account, same reasoning as "Push to Sheet."

**List name, not list id, is the API's own primary key for this flow.**
`append_label_names` and `add_entity_ids_to_label_names` both take names and
auto-create the list if the name doesn't already exist for that modality — so
the "New Apollo list" input in the UI needs no separate create-list call.
`GET /api/apollo-labels` lists existing **contacts**-modality lists (accounts
lists are filtered out; this app only ever tags people) to populate the
"Existing Apollo list" picker, so repeat runs against the same company can
land in the list already created for it.

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
