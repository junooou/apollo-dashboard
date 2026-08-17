# AWS Deployment Notes

> **This is a living document.** The app is being moved from "runs on one
> person's laptop" to "deployed on AWS for the whole team" — a real
> architecture change, not a config tweak. Every feature that assumes local,
> single-user operation needs to be re-checked against that move. **Whoever
> works on a feature is responsible for adding a note here the moment they
> build something that will behave differently once deployed** — don't wait
> for a dedicated "deployment cleanup" pass; by then the reasons will be
> forgotten. Whoever does the actual AWS deployment should treat this file as
> the punch list, not `AGENTS.md` (which stays focused on how the app works
> today) or `README.md` (which stays focused on local setup).

As of this writing the app still runs exactly as `README.md` describes: one
person, one laptop, `npm run dev`, `localhost:3100`, no authentication, files
on local disk. Nothing below has been changed yet — this file exists so the
AWS work has a concrete list to work from once it starts, rather than
discovering each of these live.

---

## Cross-cutting changes (needed regardless of which features exist)

These apply to the app as a whole, not to any one feature — read this section
first before diffing individual features below.

1. **No authentication exists today.** `README.md` states outright: *"There
   is no authentication — do not expose this to the internet as-is."* A
   public or even VPC-internal AWS deployment reachable by the whole company
   needs real auth (SSO via the company's existing identity provider is the
   obvious fit) before it goes live. This also gates every "who did this"
   feature below — right now the only identity signal anywhere in the app is
   an OS username, which is meaningless once many people share one deployed
   instance.
2. **Secrets currently live in a local `.env.local` file.** `APOLLO_API_KEY`,
   `OPENAI_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`
   must move to **AWS Secrets Manager** or **SSM Parameter Store**, read at
   startup — never baked into a container image or committed anywhere.
3. **Local filesystem writes won't survive a real deployment.** Several
   features read/write plain files under `data/` (`settings.json`,
   `presets.json`, and now `runs.json` — see below) or write CSVs directly to
   `../Apollo Lead Generation/` via `OUTPUT_DIR`. Once the app runs in a
   container (ECS/Fargate, most likely), that filesystem is ephemeral and not
   shared across instances — a file written by one request may not exist for
   the next one, and definitely won't exist for a different user's session.
   Every `data/*.json` file needs to move to a real datastore (DynamoDB is
   the natural fit for small JSON-shaped records like these) before multiple
   people can rely on it concurrently. The "Save to Apollo Lead Generation
   folder" button specifically needs to be reconsidered or removed — that
   folder is a path on someone's Mac, not a cloud resource; Google Sheets
   export is the cloud-compatible equivalent that already exists.
4. **It binds to `localhost` by design today.** The AWS listener/health-check
   setup is a normal deployment task, not called out further here, but note
   that `next dev -p 3100` is a dev server — the deployed app must run
   `npm run build && npm run start` (already defined in `package.json`), not
   `npm run dev`.

---

## Feature: Organization enrichment ("Load company profile" button)

**What it does locally:** `lib/apollo.ts`'s `enrichOrganization()`, called
from `app/api/org-profile/route.ts`, fetches industry/size/HQ/funding detail
for the selected company from Apollo's `organizations/enrich` endpoint. It is
**gated behind an explicit button** in `app/page.tsx` ("Load company profile
· 1 credit") rather than firing automatically, because it was verified live
(2026-08-13) to cost **1 Apollo credit per call** — the same credit pool
`people/bulk_match` draws from.

**What changes on AWS:**

- **Nothing structural.** This is a stateless, per-request API call — no
  local file writes, no persistence. It works the same in a container as it
  does locally.
- **The credit-gate button must stay a button, not become automatic**, and
  arguably needs to become *more* conservative once many people share one
  deployment: today, one person clicking it costs 1 credit against a pool
  they alone are drawing from; on a shared deployment it's still 1 credit,
  but now against the *whole team's* pool with no individual visibility into
  who spent what. If usage becomes a problem, consider gating this behind a
  per-user or per-day cap, using whatever identity system replaces the
  current OS-username signal (see cross-cutting note #1).
- **Rate limits become a real concern under concurrent load** in a way they
  aren't for one person clicking a button. `lib/apollo.ts` already limits
  itself to `MAX_CONCURRENT = 3` in-flight requests and retries on 429 with
  backoff — this was tuned for one local user, not N concurrent team members.
  Revisit `MAX_CONCURRENT` once real concurrent usage patterns are known.

---

## Feature: Run History / Dashboard (`/history`)

**What it does locally:** `lib/history.ts` appends one JSON record per
completed enrichment run to `data/runs.json` (gitignored, same pattern as
`data/settings.json`), written server-side from `app/api/enrich/route.ts`
right after a run completes. `/history` reads it back via
`app/api/history/route.ts` and renders a table plus aggregate totals (runs,
contacts sourced, credits used).

**What changes on AWS — this is the feature most affected by the move:**

- **The local JSON file must be replaced with a real datastore before this
  feature means anything on a shared deployment.** Right now "history" is
  silently per-machine: each colleague running their own local copy has
  their own separate `runs.json`, and the whole point of a dashboard — the
  team seeing everyone's activity in one place — doesn't actually happen
  yet. On AWS with ephemeral, non-shared container filesystems, it gets
  *worse*, not better: a run logged by one request may vanish before the
  next one reads it back. **This must move to DynamoDB (or RDS) as part of
  the AWS work**, not stay as a file. The `RunRecord` shape in
  `lib/history.ts` is already a flat, DynamoDB-friendly record — `listRuns()`
  and `appendRun()` are the only two functions that need reimplementing
  against the new store; nothing in `app/api/history/route.ts` or
  `app/history/page.tsx` should need to change.
- **`ranBy` is currently an OS username** (`os.userInfo().username`), which
  identifies "which laptop" locally but will be meaningless (or a single
  fixed value — whatever user the container runs as) once deployed. Replace
  it with the real signed-in user's identity as soon as auth exists (see
  cross-cutting note #1). Until then, don't trust this field for anything
  beyond casual local debugging.
- **No pagination or cap enforcement beyond `MAX_RECORDS = 2000`.** That cap
  exists to keep one person's local file from growing forever; it's not a
  real pagination strategy. A shared team datastore will accumulate records
  much faster — build real pagination (or a date-range query) into the
  `/api/history` route when this moves to DynamoDB, rather than reading the
  entire table on every page load.

---

## Feature: Voncierge Outreach sheets index (the "Loading Voncierge Outreach…" pill)

**What it does locally:** `lib/sheets.ts`'s `warmSheetsIndex()` scans every
spreadsheet reachable from `GOOGLE_PARENT_FOLDER_ID` — including subfolders,
see below — and caches every contact row **in a plain module-level variable
in server memory** — not a file, not a database, just a variable that lives
as long as the Node process does. The scan is triggered by the browser's
first call to `app/api/sheets-index/route.ts` (fired on page load from
`app/page.tsx`), which is what the header's "Loading Voncierge Outreach…"
pill is showing you — the scan in progress. Every "already sourced" check
after that (the Step 1 company-overview panel, and `checkCompany` on
`app/api/sheets/route.ts`) reads this cache instead of re-scanning, and the
cache is dropped and re-scanned after any write (`invalidateSheetsIndex()`,
called from the same route after a push/create) so it can't go stale within
a session.

**This cache's correctness depends on `listSpreadsheetsInFolder()` actually
finding every real sheet, which required a fix (2026-08-13).** The function
originally only looked at files directly inside the configured folder; the
real "Voncierge Outreach" shared drive keeps every sourced-contact sheet one
level down, in an "Outreach Sheets" subfolder, so the check was silently
finding nothing for any company, ever — confirmed live (DBS Bank has 36 real
contacts sitting in a sheet inside that subfolder). Fixed by walking
subfolders breadth-first (`collectFolderIds()`, capped at
`MAX_FOLDER_DEPTH = 4`) before querying. **If this app's Drive folder
structure changes again during the AWS migration** (e.g. sheets get
reorganized, or a new team convention nests things differently), re-verify
this still finds real sheets rather than assuming the depth cap is
sufficient — it was set from what was actually observed, not a guess at Drive
folder-structure norms in general.

**What changes on AWS:**

- **A server-memory cache does not survive a multi-instance deployment.**
  This is the same underlying problem as Run History (above), for a
  different reason: ECS/Fargate will likely run more than one instance
  behind a load balancer for availability, and each instance has its **own**
  copy of this cache. Two people could get different answers to "does this
  company already have contacts sourced?" depending on which instance
  happened to handle their request, and a write on one instance doesn't
  invalidate the cache on another. Before this matters in practice, either
  move the cache into something shared (ElastiCache/Redis is the natural fit
  for a warm, frequently-read, occasionally-invalidated cache like this — a
  real database is overkill for data that's fundamentally a mirror of Google
  Sheets, not this app's source of truth), or pin the deployment to a single
  instance until that's built.
- **An `instrumentation.ts` startup hook (`register()`) was tried first**,
  to begin the scan the moment the server process starts rather than waiting
  for a browser tab to open — and was reverted. Next.js compiles
  `instrumentation.ts` for the Edge runtime as well as Node, and `googleapis`
  (pulled in transitively through `lib/sheets.ts`) imports Node-only
  builtins (`http`, `https`) that don't exist in the Edge bundle. Even
  though the actual code path was correctly guarded behind a
  `NEXT_RUNTIME === "nodejs"` check at runtime, the Edge *compilation*
  failed at build time and took the whole app down with 500s. **Don't
  re-attempt a direct `import("./lib/sheets")` from `instrumentation.ts`.**
  If eager warm-up on process boot is worth revisiting for the AWS
  deployment (e.g. so the very first user after a container restart doesn't
  see the loading pill), route it through a plain `fetch()` call from
  `register()` to this app's own `/api/sheets-index` endpoint instead —
  `fetch` has no Node-only dependency, so it's safe from
  `instrumentation.ts`, and it defers the actual `googleapis` usage to a
  route that's genuinely Node-only.
