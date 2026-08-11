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

/** Lists spreadsheets directly inside a folder (or Shared Drive) — powers the "Push to Sheet" picker. */
export async function listSpreadsheetsInFolder(
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const { email, privateKey } = loadCredentials();
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    orderBy: "name",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
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
