# Outbound Intelligence

A full-stack outbound prospecting and sales-intelligence dashboard that turns a manual lead-sourcing workflow into a structured, repeatable pipeline.

The platform combines **Apollo prospecting and enrichment**, configurable lead qualification, credit-aware workflows, Google Sheets/Drive integrations, AI-assisted outreach generation, hiring signals, news triggers, and campaign handoff tools in one interface.

Rather than enriching every result immediately, the system separates **search → review → enrichment** so users can inspect who was selected, understand why they matched, and control Apollo credit spend before revealing contact data.

> **Note:** This project is designed for local/internal use and depends on third-party services such as Apollo, OpenAI, Google APIs, and GMass. It should not be exposed directly to the public internet without authentication and production infrastructure.

---

## What it does

### Lead sourcing

Search for a company or domain through Apollo, identify relevant decision-makers, review the shortlist, and selectively enrich only the contacts worth paying for.

The sourcing workflow supports:

- Company and organization resolution
- Region, country, department, and seniority filters
- Rule-based candidate scoring
- Explainable inclusion/exclusion decisions
- Duplicate-contact detection
- Email-availability checks before enrichment
- Employer/domain validation after enrichment
- Optional waterfall enrichment
- Apollo credit estimation and usage tracking
- CSV, Google Sheets, and Apollo-list outputs

### Outreach Studio

Generate multi-email outreach sequences for a specific company or industry using OpenAI.

Sequences include:

- Campaign positioning and rationale
- Subject lines and email bodies
- Multi-step follow-up sequences
- Natural-language revision requests
- Google Docs export
- GMass campaign draft integration

### Job Signals

Pull live hiring signals from **MyCareersFuture** and identify companies whose hiring activity may indicate relevant business needs.

Listings are:

- Classified against the same department taxonomy used for prospecting
- Scored using seniority, posting recency, and existing prospect coverage
- Filtered to remove recruitment/staffing agencies
- Connected directly to Outreach Studio for signal-based messaging

### News Triggers

Surface company news that may create a timely reason for outreach.

News signals can be grouped by company and filtered by region, allowing users to move from a relevant business event directly into the outreach workflow.

### Run History

Completed sourcing runs are recorded with:

- Company
- Date
- Contacts sourced
- Contacts dropped
- Credits consumed
- Waterfall recovery
- User

This provides a lightweight audit trail and makes it easier to compare sourcing performance over time.

---

## Why the workflow is structured this way

Apollo separates discovery from paid enrichment, so the application deliberately introduces a review gate before credits are spent.

### 1. Search

Apollo's people-search endpoint is used to generate a broad candidate pool.

Users can adjust:

- Region
- Countries
- Departments
- Seniority

Search results are then evaluated against local relevance rules.

### 2. Review

Each candidate is shown with:

- Match score
- Matching rule
- Department
- Seniority
- Email availability
- Existing-contact status

Users decide exactly who should proceed to enrichment before any paid reveal occurs.

### 3. Enrich

Only selected contacts are enriched.

Before an enriched contact is accepted, the system checks for:

- Missing email
- Personal email domains
- Employer/domain mismatches
- Previously sourced contacts

This matters because a technically verified email can still belong to a contact's unrelated or concurrent employer. Employer validation prevents that data from entering the outbound pipeline.

If enabled, contacts without an email can receive a capped waterfall-enrichment retry.

---

## Lead qualification

Lead relevance is not based on a single keyword list.

The filtering system distinguishes three levels of negative evidence:

| Tier | Behaviour | Example |
|---|---|---|
| **Exclude** | Always rejected | A clearly irrelevant corporate function |
| **Conditional exclude** | Rejected unless a strong relevant signal is also present | Wealth Management vs. Consumer Banking & Wealth Management |
| **Negative signal** | Softer exclusion that can be overridden by strong relevance | Business Insights vs. Customer Experience Insights |

This allows mixed-function titles to be handled more accurately than a flat allow/block list.

Search criteria and relevance rules can be configured from the application's filter settings.

---

## Technical highlights

### Credit-aware architecture

Search, review, and enrichment are deliberately separated so expensive API operations happen only after user approval.

### Explainable filtering

Candidates are shown alongside the rule that caused them to be included or excluded, making the sourcing logic auditable instead of opaque.

### Duplicate prevention

The application can compare new prospects against previously sourced contacts stored in Google Sheets and local sourcing outputs.

Google Sheet contact data is cached in memory after the initial scan so duplicate checks do not repeatedly traverse Drive.

### Server-side credential handling

Apollo, OpenAI, and Google credentials are used server-side and are never sent to the browser.

### Multi-source outbound intelligence

The dashboard combines:

- Apollo prospect data
- Existing outreach history
- MyCareersFuture hiring signals
- Google News company signals
- Google Drive / Sheets campaign data

to give users context before initiating outreach.

### Offline regression tests

The project includes **122 offline tests** covering sourcing and qualification behaviour.

The test cases are derived from real sourcing decisions so rule changes can be checked against previously agreed outcomes without consuming external API credits.

---

## Tech stack

**Frontend / application**
- Next.js
- React
- TypeScript

**Prospecting & enrichment**
- Apollo API

**AI**
- OpenAI API

**Google integrations**
- Google Sheets
- Google Drive
- Google Docs
- Service-account authentication

**Outreach**
- GMass

**Signals**
- MyCareersFuture
- Google News

**Testing**
- Offline unit/regression test suite

---

## Quick start

### Requirements

- Node.js 20+
- Apollo API key

Google integrations, OpenAI, and GMass are optional depending on which features you want to use.

```bash
git clone <repository-url>
cd apollo-dashboard

npm install
cp .env.local.example .env.local

npm run check-key
npm run dev
```

The application runs locally at:

```text
http://localhost:3100
```

---

## Environment variables

Start from:

```bash
cp .env.local.example .env.local
```

The main integrations use environment variables such as:

```env
APOLLO_API_KEY=

OPENAI_API_KEY=

GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_PARENT_FOLDER_ID=

GMASS_API_KEY=
GMASS_FROM_EMAIL=

NEXT_PUBLIC_APP_URL=
```

Do not commit `.env.local` or real credentials.

---

## Apollo setup

Create an API key from:

**Apollo → Settings → Integrations → API → API Keys**

The application uses Apollo for organization search, people search, enrichment, credit tracking, and contact/list management.

The key is read only on the server.

---

## Google Sheets / Drive setup

Google integrations use a service account rather than a personal API key.

See [`GOOGLE_SHEETS_SETUP.md`](./docs/GOOGLE_SHEETS_SETUP.md) for setup instructions.

Once configured, the application can:

- Detect previously sourced contacts
- Push sourcing results to Sheets
- Save outreach sequences to Google Docs
- Work with files inside a configured Drive folder

You can verify the integration with:

```bash
npm run check-drive
```

---

## OpenAI setup

`OPENAI_API_KEY` enables AI-assisted outreach generation and revision.

Without an OpenAI key, the core Apollo sourcing workflow continues to work; only AI-powered outreach generation is unavailable.

---

## Output

Sourced contacts use the following export schema:

```text
firstname,lastname,title,company,seniority,email,email_status,linkedin_url,location,apollo_person_id
```

Results can be:

- Downloaded as CSV
- Saved to the configured sourcing directory
- Pushed to Google Sheets
- Added to an Apollo list
- Passed into the outreach workflow

---

## Testing

Run the complete offline test suite with:

```bash
npm test
```

The suite currently contains **122 tests** and does not call Apollo or consume API credits.

---

## Documentation

More detailed documentation is available for different audiences:

- [`USER_MANUAL.md`](./docs/USER_MANUAL.md) — step-by-step non-technical guide to using the application
- [`CODEBASE_GUIDE.md`](./docs/CODEBASE_GUIDE.md) — plain-language overview of the codebase and project structure
- [`AGENTS.md`](./docs/AGENTS.md) — detailed technical and implementation reference
- [`INTERNAL_WORKFLOW.md`](./docs/INTERNAL_WORKFLOW.md) — detailed operational behaviour and workflow notes
- [`GOOGLE_SHEETS_SETUP.md`](./docs/GOOGLE_SHEETS_SETUP.md) — Google service-account and Sheets/Drive setup
- [`AWS_DEPLOYMENT_NOTES.md`](./docs/AWS_DEPLOYMENT_NOTES.md) — notes for adapting the current local architecture to a shared deployment

---

## Current deployment model

The application currently runs as a **local, single-user tool**.

Several behaviours intentionally rely on local files and local state, including run history and configurable sourcing settings.

There is currently no application authentication layer, so the project should **not be exposed publicly as-is**.

A production/shared deployment would require changes including:

- Authentication and authorization
- Shared persistent storage
- Production secret management
- Multi-user state handling
- Deployment-safe output/storage paths

See [`AWS_DEPLOYMENT_NOTES.md`](./docs/AWS_DEPLOYMENT_NOTES.md) for the existing deployment considerations.