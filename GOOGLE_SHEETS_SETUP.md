# Google Sheets Integration Setup

This guide explains how to configure the Apollo Dashboard to create and update Google Sheets using a Google service account.

## 1. Prerequisites

You need:

* Access to the Google Cloud project used by the Apollo Dashboard
* Google Sheets API enabled
* Google Drive API enabled
* A Google service account
* A folder inside a Google Shared Drive
* Node.js installed locally

## 2. Enable the Required Google APIs

In Google Cloud Console, make sure these APIs are enabled:

* Google Sheets API
* Google Drive API

Go to:

Google Cloud Console → APIs & Services → Library

Search for each API and enable it.

## 3. Create or Reuse the Service Account

Go to:

Google Cloud Console → IAM & Admin → Service Accounts

The dashboard currently uses a service account similar to:

```text
apollo-dashboard-sheets@your-project.iam.gserviceaccount.com
```

If a service account already exists, reuse it.

Otherwise, create one.

Then open the service account and create a JSON key:

Service Account → Keys → Add Key → Create new key → JSON

Download the JSON file.

Do not commit this JSON file to GitHub.

## 4. Get the Required Credentials

Inside the downloaded JSON file, find:

```json
"client_email"
```

and:

```json
"private_key"
```

These are used for:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

The private key must remain on one line in `.env.local` and keep the literal `\n` sequences.

Example:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

Never commit the real private key to GitHub.

## 5. Create a Folder in a Shared Drive

This is important.

A service account does not have its own Google Drive storage quota.

Because of this, creating spreadsheets inside a normal folder in **My Drive** may fail with:

```text
The user's Drive storage quota has been exceeded.
```

The folder used by the dashboard should therefore be inside a Google **Shared Drive**.

Example structure:

```text
Shared drives
└── Apollo Lead Generation
    └── Generated Sheets
```

Create the `Generated Sheets` folder inside the Shared Drive.

## 6. Give the Service Account Access

Share the `Generated Sheets` folder with the service account email.

For example:

```text
apollo-dashboard-sheets@your-project.iam.gserviceaccount.com
```

Give it sufficient permission to create and edit files.

## 7. Get the Parent Folder ID

Open the `Generated Sheets` folder.

The URL will look similar to:

```text
https://drive.google.com/drive/folders/1ABCDEF123456789
```

The folder ID is:

```text
1ABCDEF123456789
```

Add it to `.env.local`:

```env
GOOGLE_PARENT_FOLDER_ID=1ABCDEF123456789
```

## 8. Configure `.env.local`

Copy the example environment file if needed:

```bash
cp .env.local.example .env.local
```

Then add the required values:

```env
APOLLO_API_KEY=your_apollo_api_key

GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com

GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"

GOOGLE_PARENT_FOLDER_ID=your_shared_drive_folder_id
```

Optional:

```env
GOOGLE_SHEET_ID=
GOOGLE_CHECK_SHARE_WITH=
OUTPUT_DIR=
```

`GOOGLE_SHEET_ID` is only needed when using the validation script to test access to a specific existing spreadsheet.

`GOOGLE_CHECK_SHARE_WITH` can be used by the validation script when testing whether a newly created spreadsheet can be shared with a user.

## 9. Install Dependencies

From the project root:

```bash
npm install
```

## 10. Test the Google Sheets Integration

Run:

```bash
npm run check-sheets
```

A successful test should look similar to:

```text
Google Sheets pre-flight

✓ Service account found

1. Create a throwaway spreadsheet
   ✓ Created spreadsheet

2. Write a row
   ✓ Row appended

3. Read it back
   ✓ Round-trip matched

All good.
```

The test creates a temporary spreadsheet inside the configured Shared Drive folder.

It can be deleted afterward.

## Troubleshooting

### `tsx: command not found`

Run:

```bash
npm install
```

Then retry:

```bash
npm run check-sheets
```

### `storageQuotaExceeded`

Example:

```text
The user's Drive storage quota has been exceeded.
```

This usually means the service account is attempting to create a spreadsheet in a normal My Drive folder.

Move the target folder into a Shared Drive and update:

```env
GOOGLE_PARENT_FOLDER_ID=
```

with the Shared Drive folder ID.

Then run:

```bash
npm run check-sheets
```

again.

### Authentication works but spreadsheet creation fails

If this succeeds:

```text
✓ Service account found
```

but creation fails afterward, the Google credentials are probably valid.

Check:

* whether the folder is inside a Shared Drive
* whether the service account has access
* whether `GOOGLE_PARENT_FOLDER_ID` is correct
* whether the Google Drive API is enabled

## Security

Never commit any of the following:

```text
.env.local
service account JSON files
Google private keys
Apollo API keys
```

The repository should only contain placeholders and setup instructions.

Before committing, confirm that `.env.local` is ignored by Git:

```bash
git status
```

The `.env.local` file should not appear as a file waiting to be committed.
