/**
 * Pre-flight check for the Google Sheets integration. Run `npm run
 * check-sheets` after filling in GOOGLE_SERVICE_ACCOUNT_EMAIL and
 * GOOGLE_PRIVATE_KEY in .env.local.
 *
 * It creates a throwaway spreadsheet, writes a row, reads it back, then
 * (if GOOGLE_SHEET_ID is set) confirms read access to your real sheet — the
 * step that actually verifies you shared it with the service account.
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

function ok(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function bad(msg: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
}
function info(msg: string) {
  console.log(`  \x1b[90m·\x1b[0m ${msg}`);
}

async function main() {
  console.log("\nGoogle Sheets pre-flight\n");

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.trim();

  if (!email || !key) {
    bad("GOOGLE_SERVICE_ACCOUNT_EMAIL and/or GOOGLE_PRIVATE_KEY are not set.");
    info("Copy .env.local.example to .env.local and fill both in.");
    process.exit(1);
  }
  ok(`Service account found (${email})`);

  const { createSpreadsheet, appendRows, readRange } = await import("../lib/sheets");

  console.log("\n1. Create a throwaway spreadsheet");
  const parentFolderId = process.env.GOOGLE_PARENT_FOLDER_ID?.trim();
  if (!parentFolderId) {
    info("GOOGLE_PARENT_FOLDER_ID not set — skipping create (bare service accounts have no");
    info("Drive storage quota of their own; spreadsheets.create() will 403 without a folder");
    info("you own and shared with the service account as Editor). Continuing to steps 2-4");
    info("only if GOOGLE_SHEET_ID is set below.");
  }

  let spreadsheetId: string | undefined;
  if (parentFolderId) {
    const created = await createSpreadsheet(
      `apollo-dashboard check-sheets ${new Date().toISOString()}`,
      ["Sheet1"],
      { shareWithEmail: process.env.GOOGLE_CHECK_SHARE_WITH || undefined, parentFolderId },
    );
    spreadsheetId = created.spreadsheetId;
    ok(`Created ${spreadsheetId}`);
    info(created.url);
  }

  if (spreadsheetId) {
    console.log("\n2. Write a row");
    await appendRows(spreadsheetId, "Sheet1!A1", [["hello", "from", "apollo-dashboard"]]);
    ok("Row appended");

    console.log("\n3. Read it back");
    const values = await readRange(spreadsheetId, "Sheet1!A1:C1");
    if (values[0]?.join(",") === "hello,from,apollo-dashboard") {
      ok("Round-trip matched");
    } else {
      bad(`Unexpected values: ${JSON.stringify(values)}`);
    }

    info("This spreadsheet lives in your Drive folder — delete it if unwanted.");
  }

  if (process.env.GOOGLE_SHEET_ID) {
    console.log("\n4. Checking access to GOOGLE_SHEET_ID (your real sheet)");
    try {
      const real = await readRange(process.env.GOOGLE_SHEET_ID, "A1:A1");
      ok(`Read access confirmed (${real.length} row(s) in A1:A1)`);
    } catch (err) {
      bad(`Could not read GOOGLE_SHEET_ID: ${err instanceof Error ? err.message : err}`);
      info(`Make sure the sheet is shared with ${email} as Editor.`);
      process.exit(1);
    }
  } else {
    info("Set GOOGLE_SHEET_ID to also verify access to a real, pre-shared sheet.");
  }

  console.log("\n\x1b[32mAll good.\x1b[0m\n");
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
