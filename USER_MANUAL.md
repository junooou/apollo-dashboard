# User Manual — Outbound Intelligence

> **This is a living document.** As the app gains features, whoever builds them
> should update this manual in the same pull request — not "later." If a
> screen, button, or workflow described here no longer matches the app, fix
> the doc, don't leave it stale for the next person.

This is a plain-English walkthrough of the app, written for anyone at the
company trying it for the first time — no coding knowledge needed. It covers
the whole journey: pulling contacts from Apollo.io, reviewing and paying for
them, saving the CSV, and (optionally) turning them into an outreach email
saved as a Google Doc.

---

## 1. What this app does

It replaces a manual process — searching Apollo.io by hand, copy-pasting
contacts, and writing outreach emails — with a guided, three-step tool that
runs in your browser. In short:

**Search a company on Apollo → Review who it found → Approve the ones worth
paying for → Get a CSV → (Optional) Turn it into an outreach email saved as a
Google Doc.**

The app runs on your own computer (`localhost:3100`), not on a public
website. Only people on your machine, on your network config, can open it.
(This is expected to change — the app is planned to move onto AWS so the
whole team can reach one shared version; this manual will be updated when
that happens.)

---

## 2. Before you start

You need two things set up once, by whoever installed the app for you (or by
following `README.md`):

1. **Node.js installed**, the app's dependencies installed (`npm install`).
2. **An Apollo API key** pasted into a file called `.env.local`. This is
   required — without it the app cannot search or reveal contacts.

Two more keys are optional and unlock extra features:

- **An OpenAI API key** — needed only for the "Outreach Studio" tab (the
  email generator). Without it, lead sourcing still works fine.
- **A Google service account** (set up by an admin, see
  `GOOGLE_SHEETS_SETUP.md`) — needed only if you want to push contacts into a
  Google Sheet or save generated emails as a Google Doc.

Once installed, someone runs `npm run dev` in a terminal and leaves it
running. You then open **http://localhost:3100** in your browser. If that
terminal window is closed, the app stops working — just ask whoever set it up
to start it again.

If Google Sheets is configured, the first time you open the app you'll see a
small badge near the top-right that reads **"Loading Voncierge Outreach…"**
with a spinner — it's scanning every spreadsheet in the shared Voncierge
Outreach Drive folder so the app knows who's already been sourced. Once it
finishes, it flips to **"✓ Voncierge Outreach loaded — N sheets acquired."**
This only happens once per time the app is started (there's a small ↻ button
on the badge if you ever want to force a re-check, e.g. if a colleague just
pushed contacts from their own copy of the app).

---

## 3. The two workspaces

At the top of the page are two tabs:

| Tab | What it's for |
|---|---|
| **Lead Sourcing** | Find contacts at a company and export them as a CSV. This is the main workflow. |
| **✦ Outreach Studio** | Generate a multi-email outreach sequence for a company or industry, and optionally save it as a Google Doc. |

You can switch between them freely — nothing you've done is lost.

---

## 4. Lead Sourcing workflow (the main journey)

This workflow has three numbered steps on screen, and they always run in this
order.

### Step 1 — Find a company (free)

1. Type a company name (e.g. "DBS") or its website domain (e.g. `dbs.com`)
   into the search box and press **Search** (or hit Enter).
2. If Apollo finds more than one matching organization (common for large
   groups — e.g. a company's HQ vs. one of its business units), you'll be
   asked to pick the right one.
3. Four quick filters sit under the search box: **region**, **countries**,
   **departments**, and **seniority**. Use these to narrow who Apollo looks
   for — e.g. only "Consumer/Retail Banking" leaders, "Director"-level and
   above, in Singapore and Malaysia. Picking a region auto-fills its
   countries; you can still add or remove individual countries.

**This step costs nothing.** Apollo's search is free. What you get back is
partial on purpose — surnames are shown masked (e.g. "Ga\*\*\*i") and location
/ LinkedIn details are hidden. That's Apollo protecting its own data, not a
bug — full details only appear once you decide to pay for a contact in Step 3.

**Optional: "Load company profile" (costs 1 credit).** Once a company is
picked, a button appears offering industry, employee count, headquarters,
founding year, and funding stage for that company. Unlike everything else in
this step, this one small button **does spend 1 Apollo credit** when clicked
— that's why it isn't shown automatically. Use it when you want a sanity
check that you've picked the right entity (e.g. confirming you're looking at
a company's HQ, not an unrelated business unit) or a quick sense of company
size before committing to a full search.

**"Already logged" check.** Once a company is picked, the app also tells you
whether it already has contacts for that company sitting in a Google Sheet
inside the shared Voncierge Outreach Drive folder (free — this reads the
cache described in §2 above, not a live Apollo call). Two things worth
knowing: it checks **Google Sheets only** — if that company was ever sourced
but the results were only downloaded as a CSV and never pushed to a Sheet,
this will say "no existing contacts found" even though contacts do exist
somewhere, in the local `Apollo Lead Generation` folder. It's also
free-text-matched by company name, so slightly different spellings ("OCBC"
vs. "OCBC Bank") are usually still caught, but it isn't a guarantee.

### Step 2 — Review before spending credits (still free)

Every person Apollo found is now listed in a table. For each one you can see:

- A relevance **score** and *why* the app kept or flagged them (which rule
  matched).
- Whether Apollo **has an email on record** for that person — a small icon
  shows this. Only people who have one are pre-ticked for you, because
  reaching out to someone Apollo has no email for almost always fails and
  still costs nothing to try — the app avoids wasting your attention on
  those.
- Whether that person is **already in an existing spreadsheet** — flagged so
  you don't contact someone twice.

You can:

- **Type in the filter bar** to narrow the table by name, title, or
  department, or toggle "email only" — this is instant and doesn't re-search
  Apollo.
- **Tick/untick individual rows**, or click "Select visible" to tick
  everyone currently shown after your filtering.
- See an **estimated credit range** before you commit to anything.

**Nothing has been paid for yet.** This step is the "spend gate" — the app
deliberately makes you review and tick people before anything costs money.

### Step 3 — Enrich (this step spends Apollo credits)

Click **"Enrich [N] selected"**. Only the people you ticked are sent to
Apollo to have their full details "revealed" (real name, verified email,
phone if enabled, LinkedIn, location). This is the only step that spends
Apollo credits — searching and reviewing are always free.

Behind the scenes, three safety checks run on every result before it's
allowed into your CSV:

- No email found → dropped, and doesn't cost anything (Apollo doesn't charge
  for a miss).
- Only a personal email address found (Gmail, Yahoo, etc.) → dropped.
- Email belongs to a **different company** than the one you searched
  (this really happened once — a "verified" email pointed to a totally
  different employer) → dropped, because a wrong-company email is worse than
  no email at all.

When it's done you'll see a summary: how many contacts made it into the CSV,
how many were dropped and why, and how many credits were used.

### Getting the contacts out

From the results screen you can:

- **Download CSV** — saves a file to your computer, in the exact same format
  every other contact file in the company's `Apollo Lead Generation` folder
  uses.
- **Save to Apollo Lead Generation folder** — writes the CSV straight into
  the shared folder on this machine (only works if the app is running
  locally on a machine that has that folder).
- **Push to Sheet** — appends the contacts to an existing Google Sheet, or
  creates a brand-new one, inside the shared Google Drive folder. (Requires
  the Google service account to be configured — ask an admin if this option
  is missing or errors out.)
- A **ready-to-paste summary line** for the team's shared `context.md` run
  log, so everyone can see what was sourced and when.

---

## 5. Run History — seeing what's already been sourced

Click **"Run history"** near the top of the main screen. This is an automatic
log of every sourcing run completed on this app — no need to keep pasting
summaries into a shared document by hand. For each run you'll see the date,
the company, how many contacts landed in the CSV, how many were dropped,
credits used, and who ran it, plus running totals at the top of the page.

Every run is added here the moment Step 3 (Enrich) finishes — you don't need
to do anything extra. Right now this history is **local to the machine you're
using**: if a colleague runs the app on their own computer, their runs show
up in their own Run History, not yours. A shared, team-wide view is planned
as part of moving this app onto AWS.

---

## 6. Outreach Studio — turning contacts into an email

Click the **"✦ Outreach Studio"** tab. This is a separate tool for drafting
outbound emails — it does not require you to have sourced contacts first.

1. Choose a **scope**: target a specific **company**, or a whole
   **industry**.
2. Type in the company/industry name and any extra context you want the
   email to reflect (e.g. a recent news event, a specific pain point).
3. Click generate. The app calls OpenAI to write a full outreach
   **sequence** — several emails in order, each with a subject line, a body,
   and a short note on why that email comes at that point in the sequence.
4. Not happy with it? Type a plain-English instruction like *"make the
   second email shorter"* or *"make it less formal"* and it will revise the
   draft without starting over.
5. When you're happy, click **save as a Google Doc**. It's written into the
   same shared Google Drive folder used for spreadsheets. (Also requires the
   Google service account — see above.)

This feature needs the **OpenAI key** to be configured. If it's missing,
you'll see an error only on this tab — Lead Sourcing is unaffected.

---

## 7. Filters — tuning who counts as "relevant"

Click **"Targeting filters"** (near the search box) to go to `/filters`.
This screen controls the *rules* the app uses to decide who's worth showing
you, across two tabs:

### Simple — describe who you want, in plain English

Type a sentence like *"heads of customer experience at banks in Singapore
and Malaysia"* and click **"Build the prompt"**. The app does **not** call
any AI on its own here — instead:

1. It writes a prompt for you.
2. You copy that prompt into Claude yourself (claude.ai, the Claude app, or
   Claude Code — any plan, including the free/Pro tier, works).
3. You paste Claude's reply back into the app.

The app then shows you exactly what it understood before applying
anything — so if it guessed wrong about something, you'll see it and can
correct it rather than the app silently applying a bad guess.

This costs nothing beyond a Claude account you likely already have. You can
save a description as a **preset** to reuse later.

### Advanced — every setting directly

For finer control: turn the "waterfall" retry on/off (Apollo tries harder,
across more data sources, to find an email — costs more credits), set how
many contacts to aim for per company, override the output filename, and edit
the underlying title/seniority/location/keyword rules directly.

---

## 8. Reading the colours

The app uses colour to mean something specific, not just decoration:

- **Indigo** — Step 1, Search. Free, exploratory.
- **Amber** — Step 2, Review. This is the "about to spend money" step.
- **Green** — Step 3, Result. Done, paid for, safely in your CSV.
- Small coloured dots next to a department name (e.g. "Customer Experience")
  are just a fast visual grouping — the text label next to the dot always
  tells you what it means, so you're never guessing based on colour alone.

---

## 9. Common questions / troubleshooting

**"The page won't load at all."**
The background server (`npm run dev`) probably isn't running. Ask whoever
set up the app to start it, or run it yourself from a terminal in the
`apollo-dashboard` folder.

**"Credits show as '—' instead of a number."**
Harmless — Apollo's usage endpoint is temporarily unavailable. Everything
else keeps working.

**"Surnames look like 'Ch\*\*\*n'."**
Expected, and only in Step 1/2. Apollo hides full names until you pay to
reveal a contact in Step 3 — the CSV always has the real name.

**"Search found nobody for a company I know is on Apollo."**
Try the company's website domain instead of its name (e.g. `dbs.com`
instead of "DBS"), or widen the job-title/location filters on the Filters
page.

**"It says a webhook 'failed'."**
Expected when the waterfall retry is on — this is a deliberate privacy
choice explained in the technical docs, not a real failure. Your data was
never sent anywhere external.

**"I don't have a Google Sheets / Docs option."**
That feature needs an admin to configure a Google service account first —
ask them, or read `GOOGLE_SHEETS_SETUP.md`.

For anything not covered here, see the **Troubleshooting** section of
`README.md`, or ask whoever maintains the app.
