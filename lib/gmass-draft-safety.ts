export type DraftOnlyCampaignSettings = {
  friendlyName: string;
  stageOneDays?: number;
  stageOneCampaignId?: number;
  stageOneAction?: string;
  stageOneThread?: string;
  stageTwoDays?: number;
  stageTwoCampaignId?: number;
  stageTwoAction?: string;
  stageTwoThread?: string;
  stageThreeDays?: number;
  stageThreeCampaignId?: number;
  stageThreeAction?: string;
  stageThreeThread?: string;
  stageFourDays?: number;
  stageFourCampaignId?: number;
  stageFourAction?: string;
  stageFourThread?: string;
};

const DRAFT_ONLY_CAMPAIGN_FIELDS = new Set<keyof DraftOnlyCampaignSettings>([
  "friendlyName",
  "stageOneDays",
  "stageOneCampaignId",
  "stageOneAction",
  "stageOneThread",
  "stageTwoDays",
  "stageTwoCampaignId",
  "stageTwoAction",
  "stageTwoThread",
  "stageThreeDays",
  "stageThreeCampaignId",
  "stageThreeAction",
  "stageThreeThread",
  "stageFourDays",
  "stageFourCampaignId",
  "stageFourAction",
  "stageFourThread",
]);

const FORBIDDEN_DELIVERY_FIELDS = new Set([
  "createDrafts",
  "sendTime",
  "emailsPerDay",
  "recurrence",
  "allowedSendingDays",
  "allowedSendDays",
  "sendingDays",
  "sendAt",
  "scheduledTime",
  "scheduleTime",
]);

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The only allowed path to GMass's campaign-registration endpoint. GMass can
 * launch or schedule campaigns through this endpoint, so callers receive no
 * way to set createDrafts and may pass only the fields used by our current
 * review-only sequence. Relative stage days configure the dormant follow-up
 * sequence; they do not deliver it while createDrafts remains true.
 */
export async function postDraftOnlyCampaign({
  apiKey,
  campaignDraftId,
  settings,
}: {
  apiKey: string;
  campaignDraftId: string;
  settings: DraftOnlyCampaignSettings;
}): Promise<{ response: Response; data: unknown }> {
  for (const field of Object.keys(settings)) {
    if (!DRAFT_ONLY_CAMPAIGN_FIELDS.has(field as keyof DraftOnlyCampaignSettings)) {
      const category = FORBIDDEN_DELIVERY_FIELDS.has(field)
        ? "delivery or scheduling"
        : "non-allowlisted";
      throw new Error(`Refusing ${category} GMass campaign field: ${field}`);
    }
  }

  const response = await fetch(
    `https://api.gmass.co/api/campaigns/${encodeURIComponent(campaignDraftId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-apikey": apiKey,
      },
      // Injected last and unavailable in DraftOnlyCampaignSettings, so a
      // caller cannot override the review-only behavior.
      body: JSON.stringify({ ...settings, createDrafts: true as const }),
      cache: "no-store",
    },
  );

  return { response, data: await parseResponse(response) };
}
