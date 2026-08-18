/**
 * Google Sheets client. Auth is a service account (JWT) instead of an OAuth
 * consent flow, matching the server-only pattern already used for Apollo's
 * x-api-key — no browser redirect, no refresh token to babysit.
 *
 * A service account has no access to any spreadsheet until you explicitly
 * share it with the account's client_email (Editor). See .env.local.example.
 */

import { google, sheets_v4 } from "googleapis";

let cachedClient: sheets_v4.Sheets | null = null;

function loadCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local.",
    );
  }

  // .env files can't hold real newlines in a single value, so the key is
  // stored with literal \n escapes and unescaped here.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  return { email, privateKey };
}

function getClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const { email, privateKey } = loadCredentials();
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

export async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values as string[][] | undefined) ?? [];
}

function getDriveReadClient() {
  const { email, privateKey } = loadCredentials();
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

/**
 * How many folder levels deep to look for spreadsheets, below `folderId`
 * itself. Verified live (2026-08-13): the real "Voncierge Outreach" shared
 * drive keeps every sourced-contact sheet one level down, inside an
 * "Outreach Sheets" subfolder — only an ad-hoc test spreadsheet sat at the
 * drive's own root. A depth of 1 was silently finding nothing real; this
 * cap is generous headroom above the one level actually observed in use,
 * not a guess at what depth is needed.
 */
const MAX_FOLDER_DEPTH = 4;

/** Every subfolder ID directly inside `parentId`. */
async function listSubfolders(
  drive: ReturnType<typeof getDriveReadClient>,
  parentId: string,
): Promise<string[]> {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return (res.data.files ?? []).map((f) => f.id!).filter(Boolean);
}

/**
 * `rootId` plus every folder ID reachable underneath it — a breadth-first
 * walk capped at `MAX_FOLDER_DEPTH` so a pathological folder structure can't
 * cause runaway recursion. Needed because the shared Drive folder this app
 * points at is not flat: real contact sheets live inside a subfolder, not
 * directly in the folder configured as GOOGLE_PARENT_FOLDER_ID.
 */
async function collectFolderIds(
  drive: ReturnType<typeof getDriveReadClient>,
  rootId: string,
): Promise<string[]> {
  const all = [rootId];
  let frontier = [rootId];

  for (let depth = 0; depth < MAX_FOLDER_DEPTH && frontier.length > 0; depth++) {
    const children = await Promise.all(frontier.map((id) => listSubfolders(drive, id)));
    frontier = children.flat();
    all.push(...frontier);
  }

  return all;
}

/**
 * Lists every spreadsheet inside a folder (or Shared Drive) OR any of its
 * subfolders — powers both the "Push to Sheet" picker and the existing-
 * contacts scan. Recurses because the real shared Drive this app targets
 * organizes sheets inside a subfolder rather than at the top level; a
 * direct-children-only query silently misses everything real.
 */
export async function listSpreadsheetsInFolder(
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const drive = getDriveReadClient();
  const folderIds = await collectFolderIds(drive, folderId);

  const parentClause = folderIds.map((id) => `'${id}' in parents`).join(" or ");
  const res = await drive.files.list({
    q: `(${parentClause}) and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    orderBy: "name",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}

/** Below this length, a substring match is too likely to be noise ("A" would match everything). */
const MIN_FUZZY_LEN = 3;

/**
 * Loose company-name equality: exact match, or either name contains the
 * other. Absorbs drift like "OCBC" vs "OCBC Bank" between what Apollo
 * resolves and what a human typed into a sheet by hand.
 */
function companyNamesMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return (
    x === y ||
    (x.length >= MIN_FUZZY_LEN && y.includes(x)) ||
    (y.length >= MIN_FUZZY_LEN && x.includes(y))
  );
}

/** Normalizes "  Pearl   Low " and "Pearl Low" to the same comparable key. */
export function normalizeContactName(firstname: string, lastname: string): string {
  return `${firstname} ${lastname}`.trim().toLowerCase().replace(/\s+/g, " ");
}

export type SheetContact = {
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  email: string;
  linkedinUrl: string;
  apolloPersonId: string;
  sheetId: string;
  sheetName: string;
  /** Present only if the sheet already has a `seniority` column (part of the
   *  standard 10-column CSV schema, but unused by this type until now). */
  seniority?: string;
  /** Present only if the sheet already has a `location` column. */
  location?: string;
  /** 1-based row number within `sheetId`'s first tab (header is row 1) — lets
   *  a later write (e.g. marking a LinkedIn send) target this exact row
   *  without re-searching the sheet. */
  rowIndex: number;
  /** Present only if the sheet already has a `linkedin_status` column. */
  linkedinStatus?: string;
  /** Present only if the sheet already has a `linkedin_sent_at` column. */
  linkedinSentAt?: string;
};

/** Reads every row of every spreadsheet in `folderId` — the expensive part
 *  `findContactsForCompany` used to redo on every single company check.
 *  Unfiltered by company; filtering happens in-memory once this is cached. */
async function scanAllContacts(
  sheetsList: { id: string; name: string }[],
): Promise<SheetContact[]> {
  const perSheet = await Promise.all(
    sheetsList.map(async (s): Promise<SheetContact[]> => {
      try {
        const values = await readRange(s.id, "A1:Z5000");
        if (values.length < 2) return [];

        const header = values[0].map((h) => (h ?? "").trim().toLowerCase());
        const companyCol = header.indexOf("company");
        if (companyCol < 0) return [];

        const firstnameCol = header.indexOf("firstname");
        const lastnameCol = header.indexOf("lastname");
        const titleCol = header.indexOf("title");
        const emailCol = header.indexOf("email");
        const linkedinCol = header.indexOf("linkedin_url");
        const idCol = header.indexOf("apollo_person_id");
        const statusCol = header.indexOf("linkedin_status");
        const sentAtCol = header.indexOf("linkedin_sent_at");
        const seniorityCol = header.indexOf("seniority");
        const locationCol = header.indexOf("location");

        const out: SheetContact[] = [];
        values.slice(1).forEach((row, i) => {
          const cell = row[companyCol]?.trim() ?? "";
          if (!cell) return;
          const status = statusCol >= 0 ? (row[statusCol] ?? "").trim() : "";
          const sentAt = sentAtCol >= 0 ? (row[sentAtCol] ?? "").trim() : "";
          const seniority = seniorityCol >= 0 ? (row[seniorityCol] ?? "").trim() : "";
          const location = locationCol >= 0 ? (row[locationCol] ?? "").trim() : "";
          out.push({
            firstname: firstnameCol >= 0 ? (row[firstnameCol] ?? "").trim() : "",
            lastname: lastnameCol >= 0 ? (row[lastnameCol] ?? "").trim() : "",
            title: titleCol >= 0 ? (row[titleCol] ?? "").trim() : "",
            company: cell,
            email: emailCol >= 0 ? (row[emailCol] ?? "").trim() : "",
            linkedinUrl: linkedinCol >= 0 ? (row[linkedinCol] ?? "").trim() : "",
            apolloPersonId: idCol >= 0 ? (row[idCol] ?? "").trim() : "",
            sheetId: s.id,
            sheetName: s.name,
            // Header is row 1, so the Nth data row (0-based `i`) sits at sheet row i+2.
            rowIndex: i + 2,
            ...(status ? { linkedinStatus: status } : {}),
            ...(sentAt ? { linkedinSentAt: sentAt } : {}),
            ...(seniority ? { seniority } : {}),
            ...(location ? { location } : {}),
          });
        });
        return out;
      } catch {
        return []; // A single unreadable sheet shouldn't fail the whole scan.
      }
    }),
  );

  return perSheet.flat();
}

export type SheetsIndex = {
  sheets: { id: string; name: string }[];
  contacts: SheetContact[];
  loadedAt: string;
};

/**
 * In-memory, process-lifetime cache of every contact across every
 * spreadsheet in the shared Drive folder. Exists so a company check doesn't
 * re-scan the whole folder (potentially dozens of sheets, thousands of rows)
 * on every single search — it scans once, then every check after that is a
 * plain in-memory filter.
 *
 * Scope: this cache lives for the life of ONE running `npm run dev` / `npm
 * start` process, on ONE machine. It is not shared between colleagues each
 * running their own local copy — see AWS_DEPLOYMENT_NOTES.md for what that
 * means once this app runs as a shared AWS deployment.
 */
let cache: SheetsIndex | null = null;
let warmingPromise: Promise<SheetsIndex> | null = null;

/**
 * Populates (or returns the already-populated) sheets index. Concurrent
 * callers during the initial scan share the same in-flight promise rather
 * than each kicking off their own — matters because the app's header
 * (app/page.tsx) and any in-flight "existing contacts" check can both land
 * here within the same first second after the app loads.
 */
export async function warmSheetsIndex(folderId: string, force = false): Promise<SheetsIndex> {
  if (cache && !force) return cache;
  if (warmingPromise) return warmingPromise;

  warmingPromise = (async () => {
    const sheetsList = await listSpreadsheetsInFolder(folderId);
    const contacts = await scanAllContacts(sheetsList);
    const index: SheetsIndex = { sheets: sheetsList, contacts, loadedAt: new Date().toISOString() };
    cache = index;
    return index;
  })();

  try {
    return await warmingPromise;
  } finally {
    warmingPromise = null;
  }
}

/** Synchronous peek at the current cache, without triggering a scan. */
export function getCachedSheetsIndex(): SheetsIndex | null {
  return cache;
}

/**
 * Drops the cache so the next read re-scans from Google. Call this after any
 * write that changes what's in the folder (a new sheet, a push of new
 * contacts) — otherwise "already sourced" checks would keep reporting
 * pre-write data until the server restarts.
 */
export function invalidateSheetsIndex(): void {
  cache = null;
}

/**
 * Every contact whose company column fuzzy-matches `companyName`, across
 * every spreadsheet in `folderId`. Uses the warm cache when available —
 * effectively instant after the first scan — and transparently falls back to
 * a fresh live scan on a cache miss or read failure, so this keeps working
 * even if the startup warm-up never ran or failed.
 */
export async function findContactsForCompany(
  folderId: string,
  companyName: string,
): Promise<SheetContact[]> {
  let index: SheetsIndex;
  try {
    index = await warmSheetsIndex(folderId);
  } catch {
    return [];
  }

  return index.contacts.filter((c) => companyNamesMatch(c.company, companyName));
}

/**
 * Every distinct company name across the warm index, deduped
 * case-insensitively but keeping the first-seen casing (so "OCBC" doesn't
 * get silently rewritten to "ocbc"). Powers the LinkedIn Drafts company
 * picker — it only ever needs to offer companies that already have a sheet.
 */
export async function listCompaniesFromIndex(folderId: string): Promise<string[]> {
  let index: SheetsIndex;
  try {
    index = await warmSheetsIndex(folderId);
  } catch {
    return [];
  }

  const seen = new Map<string, string>();
  for (const c of index.contacts) {
    const key = c.company.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, c.company.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Appends rows after the last row with data in `range`'s sheet. */
export async function appendRows(
  spreadsheetId: string,
  range: string,
  rows: (string | number)[][],
): Promise<{ updatedRange: string | undefined; updatedRows: number | undefined }> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
  return {
    updatedRange: res.data.updates?.updatedRange ?? undefined,
    updatedRows: res.data.updates?.updatedRows ?? undefined,
  };
}

/** Overwrites the exact cells in `range`. Does not shift existing rows. */
export async function updateRange(
  spreadsheetId: string,
  range: string,
  rows: (string | number)[][],
): Promise<{ updatedRange: string | undefined; updatedCells: number | undefined }> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
  return {
    updatedRange: res.data.updatedRange ?? undefined,
    updatedCells: res.data.updatedCells ?? undefined,
  };
}

/** "A" for 0, "B" for 1, ... "Z" for 25, "AA" for 26, matching Sheets' own column labels. */
function columnLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Per-spreadsheet cache of the first tab's internal numeric id (gid) — needed
 *  for cell-formatting requests, which address a sheet by gid, not by name or
 *  index. Safe to cache for the process lifetime: a tab's gid doesn't change
 *  unless the tab itself is deleted and recreated. */
const sheetGidCache = new Map<string, number>();

async function getFirstSheetId(spreadsheetId: string): Promise<number> {
  const cached = sheetGidCache.get(spreadsheetId);
  if (cached !== undefined) return cached;

  const sheets = getClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,index)",
  });
  const first = res.data.sheets?.find((s) => s.properties?.index === 0);
  const gid = first?.properties?.sheetId ?? 0;
  sheetGidCache.set(spreadsheetId, gid);
  return gid;
}

/** Sets a solid background color on one cell via `batchUpdate`'s `repeatCell`
 *  — the values.* endpoints used elsewhere in this file only ever touch cell
 *  *values*, never formatting, so this is a distinct code path. */
async function formatCellBackground(
  spreadsheetId: string,
  sheetGid: number,
  rowIndex0: number,
  colIndex0: number,
  color: { red: number; green: number; blue: number },
): Promise<void> {
  const sheets = getClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: sheetGid,
              startRowIndex: rowIndex0,
              endRowIndex: rowIndex0 + 1,
              startColumnIndex: colIndex0,
              endColumnIndex: colIndex0 + 1,
            },
            cell: { userEnteredFormat: { backgroundColor: color } },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ],
    },
  });
}

/**
 * Finds (or creates) a pair of tracking columns on a sheet — an "anchor"
 * column that must already exist (e.g. `linkedin_url`, `email`) plus a
 * status/timestamp pair appended to the header row if they don't exist yet.
 * Shared by `markLinkedinContactSent` and `markJobSignalContacted` — both
 * record a manual "I did the outreach" confirmation, differing only in
 * which columns they touch. Separate from the fixed 10-column CSV schema in
 * `lib/csv.ts` — this only ever extends a sheet's own header, never touches
 * what `contactsToRows` writes, so it can't drift the local-CSV schema
 * AGENTS.md pins in place.
 */
async function ensureTrackingColumns(
  spreadsheetId: string,
  anchorColumn: string,
  statusColumn: string,
  sentAtColumn: string,
): Promise<{ anchorCol: number; statusCol: number; sentAtCol: number }> {
  const headerRows = await readRange(spreadsheetId, "A1:Z1");
  const header = (headerRows[0] ?? []).map((h) => (h ?? "").trim().toLowerCase());

  const anchorCol = header.indexOf(anchorColumn);
  if (anchorCol < 0) {
    throw new Error(`This sheet has no ${anchorColumn} column — cannot track a send here.`);
  }

  let statusCol = header.indexOf(statusColumn);
  let sentAtCol = header.indexOf(sentAtColumn);

  if (statusCol < 0 || sentAtCol < 0) {
    const nextCol = header.length;
    const newHeaders: string[] = [];
    if (statusCol < 0) {
      statusCol = nextCol + newHeaders.length;
      newHeaders.push(statusColumn);
    }
    if (sentAtCol < 0) {
      sentAtCol = nextCol + newHeaders.length;
      newHeaders.push(sentAtColumn);
    }
    const startLetter = columnLetter(nextCol);
    const endLetter = columnLetter(nextCol + newHeaders.length - 1);
    await updateRange(spreadsheetId, `${startLetter}1:${endLetter}1`, [newHeaders]);
  }

  return { anchorCol, statusCol, sentAtCol };
}

/** Pale green — visible against both light and dark Sheets themes without
 *  reading as an error/warning color. */
const CONTACTED_GREEN = { red: 0.78, green: 0.91, blue: 0.8 };

/**
 * Records a manual "I sent this LinkedIn connection request" confirmation:
 * writes `linkedin_status`/`linkedin_sent_at` into the contact's row (adding
 * those columns first if the sheet doesn't have them yet) and shades the
 * `linkedin_url` cell green. There is no LinkedIn API that can verify a send
 * actually happened — this is a trusted manual confirmation, the same trust
 * model as the rest of this app's human-in-the-loop steps.
 */
export async function markLinkedinContactSent(
  spreadsheetId: string,
  rowIndex: number,
): Promise<{ sentAt: string }> {
  const { anchorCol, statusCol, sentAtCol } = await ensureTrackingColumns(
    spreadsheetId,
    "linkedin_url",
    "linkedin_status",
    "linkedin_sent_at",
  );
  const sentAt = new Date().toISOString().slice(0, 10);

  const statusLetter = columnLetter(statusCol);
  const sentAtLetter = columnLetter(sentAtCol);
  await updateRange(spreadsheetId, `${statusLetter}${rowIndex}:${statusLetter}${rowIndex}`, [["Sent"]]);
  await updateRange(spreadsheetId, `${sentAtLetter}${rowIndex}:${sentAtLetter}${rowIndex}`, [[sentAt]]);

  const gid = await getFirstSheetId(spreadsheetId);
  await formatCellBackground(spreadsheetId, gid, rowIndex - 1, anchorCol, CONTACTED_GREEN);

  return { sentAt };
}

/**
 * Same manual-confirmation pattern as `markLinkedinContactSent`, for the
 * "Job Signals Outreach" sheet (see `getOrCreateJobSignalOutreachSheet`).
 * Anchors on `email` rather than `linkedin_url` because a Job Signals
 * contact was reached through whichever channel (email or LinkedIn) the
 * user actually used — the sheet doesn't track which, same trust model as
 * the rest of this app's "Mark as Sent" buttons.
 */
export async function markJobSignalContacted(
  spreadsheetId: string,
  rowIndex: number,
): Promise<{ contactedAt: string }> {
  const { anchorCol, statusCol, sentAtCol } = await ensureTrackingColumns(
    spreadsheetId,
    "email",
    "outreach_status",
    "contacted_at",
  );
  const contactedAt = new Date().toISOString().slice(0, 10);

  const statusLetter = columnLetter(statusCol);
  const sentAtLetter = columnLetter(sentAtCol);
  await updateRange(spreadsheetId, `${statusLetter}${rowIndex}:${statusLetter}${rowIndex}`, [
    ["Contacted"],
  ]);
  await updateRange(spreadsheetId, `${sentAtLetter}${rowIndex}:${sentAtLetter}${rowIndex}`, [
    [contactedAt],
  ]);

  const gid = await getFirstSheetId(spreadsheetId);
  await formatCellBackground(spreadsheetId, gid, rowIndex - 1, anchorCol, CONTACTED_GREEN);

  return { contactedAt };
}

/** Name of the single running sheet every Job Signals-sourced contact gets
 *  appended to, across all companies — one running log rather than a sheet
 *  per employer, so "who have we already contacted" is a single scan
 *  (product decision, not a technical constraint). */
export const JOB_SIGNAL_OUTREACH_SHEET_NAME = "Job Signals Outreach";

/** Cached per-process once resolved, same lifetime rule as `sheetGidCache` —
 *  the sheet is found-or-created at most once per server process. */
let cachedJobSignalOutreachSheetId: string | null = null;

/**
 * Finds the "Job Signals Outreach" spreadsheet in `parentFolderId`, or
 * creates it if this is the first time anyone has saved a Job Signals
 * contact. `GOOGLE_JOB_SIGNALS_SHEET_ID` skips the lookup entirely when set
 * (e.g. if the sheet was created by hand and moved somewhere the folder
 * scan wouldn't find it).
 */
export async function getOrCreateJobSignalOutreachSheet(parentFolderId: string): Promise<string> {
  const envId = process.env.GOOGLE_JOB_SIGNALS_SHEET_ID?.trim();
  if (envId) return envId;
  if (cachedJobSignalOutreachSheetId) return cachedJobSignalOutreachSheetId;

  const existing = await listSpreadsheetsInFolder(parentFolderId);
  const found = existing.find((s) => s.name === JOB_SIGNAL_OUTREACH_SHEET_NAME);
  if (found) {
    cachedJobSignalOutreachSheetId = found.id;
    return found.id;
  }

  const outreachSheetsFolderId = await resolveOutreachSheetsFolderId(parentFolderId);
  const { spreadsheetId } = await createSpreadsheet(JOB_SIGNAL_OUTREACH_SHEET_NAME, ["Sheet1"], {
    parentFolderId: outreachSheetsFolderId,
  });
  cachedJobSignalOutreachSheetId = spreadsheetId;
  return spreadsheetId;
}

/** Name of the subfolder inside `GOOGLE_PARENT_FOLDER_ID` ("Voncierge
 *  Outreach") where every generated contact sheet actually lives — verified
 *  live (2026-08-13, see `MAX_FOLDER_DEPTH` above). New sheets must be
 *  created here, not at the shared drive's root, or they'd sit alongside
 *  real sheets instead of inside the folder people actually browse. */
export const OUTREACH_SHEETS_SUBFOLDER_NAME = "Outreach Sheets";

/** Cached per-process once resolved, same lifetime rule as `sheetGidCache`. */
let cachedOutreachSheetsFolderId: string | null = null;

/**
 * Resolves the "Outreach Sheets" subfolder ID directly inside `parentFolderId`,
 * creating it if it doesn't exist yet. New spreadsheets are created here
 * instead of at `parentFolderId`'s own root so they land next to every other
 * sourced-contact sheet (see `OUTREACH_SHEETS_SUBFOLDER_NAME`).
 */
export async function resolveOutreachSheetsFolderId(parentFolderId: string): Promise<string> {
  if (cachedOutreachSheetsFolderId) return cachedOutreachSheetsFolderId;

  const drive = getDriveReadClient();
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${OUTREACH_SHEETS_SUBFOLDER_NAME}' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  const existing = res.data.files?.[0]?.id;
  if (existing) {
    cachedOutreachSheetsFolderId = existing;
    return existing;
  }

  const { email, privateKey } = loadCredentials();
  const driveAuth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const driveWrite = google.drive({ version: "v3", auth: driveAuth });
  const created = await driveWrite.files.create({
    requestBody: {
      name: OUTREACH_SHEETS_SUBFOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  cachedOutreachSheetsFolderId = created.data.id!;
  return cachedOutreachSheetsFolderId;
}

/**
 * Creates a new spreadsheet.
 *
 * A bare service account (not part of a Google Workspace domain) has ZERO
 * Drive storage quota of its own — calling spreadsheets.create() directly
 * 403s with a generic "caller does not have permission", not a clear quota
 * error. The fix is `parentFolderId`: a folder you own, shared with the
 * service account as Editor. A file created inside someone else's folder
 * counts against *their* quota, not the creator's, so this works with zero
 * storage on the service account side. Without `parentFolderId` this only
 * works for Workspace-domain-delegated service accounts.
 *
 * If `parentFolderId` points into a Shared Drive instead of a personal "My
 * Drive" folder, files created there draw from the Shared Drive's own pool
 * and don't count against any individual's quota at all — Google's
 * recommended pattern for service-account file creation, and worth moving to
 * if a user's personal quota keeps getting hit. `supportsAllDrives: true` is
 * required for both reads and writes to work against a Shared Drive; it is a
 * no-op for a regular folder, so it's always safe to pass.
 */
export async function createSpreadsheet(
  title: string,
  sheetTitles: string[] = ["Sheet1"],
  opts: { shareWithEmail?: string; parentFolderId?: string } = {},
): Promise<{ spreadsheetId: string; url: string }> {
  const { shareWithEmail, parentFolderId } = opts;
  const { email, privateKey } = loadCredentials();

  let spreadsheetId: string;
  let url: string;

  if (parentFolderId) {
    const driveAuth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth: driveAuth });
    const file = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [parentFolderId],
      },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    spreadsheetId = file.data.id!;
    url = file.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // The Drive-created file starts as a single default-named sheet — rename
    // it and add the rest to honour the requested tab list.
    const sheets = getClient();
    const requests: sheets_v4.Schema$Request[] = sheetTitles.map((t, i) =>
      i === 0
        ? { updateSheetProperties: { properties: { sheetId: 0, title: t }, fields: "title" } }
        : { addSheet: { properties: { title: t } } },
    );
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  } else {
    const sheets = getClient();
    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: sheetTitles.map((t) => ({ properties: { title: t } })),
      },
    });
    spreadsheetId = res.data.spreadsheetId!;
    url = res.data.spreadsheetUrl!;
  }

  if (shareWithEmail) {
    const driveAuth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const drive = google.drive({ version: "v3", auth: driveAuth });
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { type: "user", role: "writer", emailAddress: shareWithEmail },
      sendNotificationEmail: false,
      supportsAllDrives: true,
    });
  }

  return { spreadsheetId, url };
}
