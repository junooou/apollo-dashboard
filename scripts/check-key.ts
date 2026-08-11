/**
 * Pre-flight check. Run `npm run check-key` before the first real sourcing run.
 *
 * It answers three questions without spending meaningful credits:
 *   1. Does the API key work at all?
 *   2. Does free people-search return results?
 *   3. Does waterfall accept a request without a public webhook_url?
 *      (Question 3 is the one Apollo's docs don't answer. We need to poll
 *       /webhook_result instead of receiving a webhook, because this app runs
 *       on localhost and has no public HTTPS endpoint.)
 */

import { readFileSync } from "node:fs";
import path from "node:path";

// Minimal .env.local loader so this runs without extra dependencies.
try {
  const envPath = path.join(process.cwd(), ".env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — fall back to the ambient environment */
}

const BASE = "https://api.apollo.io/api/v1";
const KEY = process.env.APOLLO_API_KEY?.trim();

function ok(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function bad(msg: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
}
function info(msg: string) {
  console.log(`  \x1b[90m·\x1b[0m ${msg}`);
}

async function call(path: string, method: "GET" | "POST", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "x-api-key": KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  // request_id is a 64-bit int; JSON.parse rounds it and the rounded value 404s.
  return { status: res.status, body: parsed, raw: text };
}

async function main() {
  console.log("\nApollo API pre-flight\n");

  if (!KEY) {
    bad("APOLLO_API_KEY is not set.");
    info("Copy .env.local.example to .env.local and add your key.");
    info("Get one at: Apollo -> Settings -> Integrations -> API -> API Keys");
    process.exit(1);
  }
  ok(`Key found (${KEY.slice(0, 4)}…${KEY.slice(-4)})`);

  // --- 1. Auth ------------------------------------------------------------
  console.log("\n1. Authentication");
  const auth = await call("/auth/health", "GET");
  if (auth.status === 200) {
    ok("Key authenticates");
  } else if (auth.status === 401 || auth.status === 403) {
    bad(`Key rejected (${auth.status}). It may lack master scope, or the plan may not include API access.`);
    console.log(JSON.stringify(auth.body, null, 2));
    process.exit(1);
  } else {
    info(`Health endpoint returned ${auth.status}; continuing anyway.`);
  }

  // --- 2. Free search -----------------------------------------------------
  console.log("\n2. People search (free, no credits)");
  const search = await call("/mixed_people/api_search", "POST", {
    q_organization_domains_list: ["dbs.com"],
    person_titles: ["customer experience"],
    page: 1,
    per_page: 5,
  });
  if (search.status === 200) {
    const people = [...(search.body.people ?? []), ...(search.body.contacts ?? [])];
    const total = search.body.total_entries ?? search.body.pagination?.total_entries;
    ok(`Search works — ${people.length} returned, ${total ?? "?"} total available`);
    const withEmail = people.filter((p: any) => p.has_email);
    info(`${withEmail.length} of ${people.length} have an email Apollo can reveal`);
    info("Surnames are masked at search time; full details arrive at enrichment.");
  } else {
    bad(`Search failed (${search.status})`);
    console.log(JSON.stringify(search.body, null, 2));
  }

  // --- 3. Waterfall via polling ------------------------------------------
  console.log("\n3. Waterfall + polling (costs a few credits)");
  info("Apollo requires a webhook_url but only validates its format, so we send");
  info("a deliberately dead URL and poll /webhook_result for the payload. This");
  info("keeps prospect emails inside Apollo rather than a third-party sink.");

  const sink = process.env.WATERFALL_WEBHOOK_URL || "https://example.com/apollo-waterfall-sink";
  const waterfall = await call("/people/bulk_match", "POST", {
    details: [{ first_name: "Tse", last_name: "Shee", organization_name: "DBS Bank" }],
    reveal_personal_emails: false,
    run_waterfall_email: true,
    webhook_url: sink,
  });

  if (waterfall.status !== 200) {
    bad(`Waterfall request rejected (${waterfall.status}).`);
    console.log(JSON.stringify(waterfall.body, null, 2));
    info("Turn waterfall off in Settings — standard reveal is unaffected.");
    return;
  }

  // Pull the id from the raw text: it exceeds Number.MAX_SAFE_INTEGER, so the
  // JSON.parse'd value is silently rounded and polling it returns 404.
  const requestId = waterfall.raw.match(/"request_id"\s*:\s*"?(-?\d+)"?/)?.[1];
  if (!requestId) {
    bad("No request_id returned — cannot poll for waterfall results.");
    return;
  }
  ok(`Accepted — request_id ${requestId}`);
  if (String(waterfall.body.request_id) !== requestId) {
    info(`(JSON.parse would have rounded this to ${waterfall.body.request_id})`);
  }

  // Give Apollo a few seconds to run the vendor chain.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await call(`/webhook_result/${requestId}`, "GET");
    if (poll.status !== 200) {
      bad(`Polling returned ${poll.status}`);
      return;
    }
    const result = poll.body.webhook_result;
    if (result) {
      ok(`Payload retrieved (delivery status "${poll.body.webhook_status}")`);
      if (poll.body.webhook_status === "failed") {
        info("A 'failed' delivery status is EXPECTED — the sink URL is unreachable.");
        info("The enrichment itself succeeded; results come from polling.");
      }
      info(`records enriched: ${result.records_enriched}, credits consumed: ${result.credits_consumed}`);
      const emails = result.people?.[0]?.emails?.map((e: any) => e.email) ?? [];
      info(`emails found: ${emails.join(", ") || "none"}`);
      console.log("\n\x1b[32mAll good. Waterfall works from localhost via polling.\x1b[0m\n");
      return;
    }
    info(`still processing… (attempt ${attempt + 1})`);
  }

  bad("Timed out waiting for the waterfall payload.");
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
