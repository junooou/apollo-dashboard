import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { postDraftOnlyCampaign } from "../../../../lib/gmass-draft-safety";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GMass draft-only campaign safety", () => {
  it("forces createDrafts for both rich-text follow-ups and the main campaign", async () => {
    vi.stubEnv("GMASS_API_KEY", "test-key");
    vi.stubEnv("GMASS_FROM_EMAIL", "sender@example.com");

    let draftNumber = 0;
    let campaignNumber = 0;
    const campaignBodies: Record<string, unknown>[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/campaigndrafts")) {
          draftNumber += 1;
          return Response.json({ campaignDraftId: `draft-${draftNumber}` });
        }

        if (url.includes("/api/campaigns/")) {
          campaignNumber += 1;
          campaignBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({ campaignId: campaignNumber });
        }

        throw new Error(`Unexpected GMass request: ${url}`);
      }),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/gmass/create-draft", {
        method: "POST",
        body: JSON.stringify({
          campaignName: "Safety Test",
          emailAddresses: "recipient@example.com",
          emails: [
            { label: "Initial", topic: "Intro", subject: "Hello", body: "Main body" },
            { label: "Follow-Up 1", topic: "Follow up", subject: "Re: Hello", body: "Follow-up" },
          ],
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(campaignBodies).toHaveLength(2);
    expect(campaignBodies[0]).toEqual({
      friendlyName: "Safety Test — Follow-Up 1",
      createDrafts: true,
    });
    expect(campaignBodies[1]).toMatchObject({
      friendlyName: "Safety Test",
      createDrafts: true,
      stageOneDays: 10,
      stageOneCampaignId: 1,
      stageOneAction: "r",
      stageOneThread: "same",
    });
  });

  it.each([
    "createDrafts",
    "sendTime",
    "emailsPerDay",
    "recurrence",
    "allowedSendingDays",
    "scheduleTime",
  ])("rejects forbidden field %s before calling GMass", async (field) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postDraftOnlyCampaign({
        apiKey: "test-key",
        campaignDraftId: "draft-1",
        settings: {
          friendlyName: "Safety Test",
          [field]: field === "createDrafts" ? false : "forbidden",
        } as never,
      }),
    ).rejects.toThrow(`Refusing delivery or scheduling GMass campaign field: ${field}`);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects any other non-allowlisted field before calling GMass", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postDraftOnlyCampaign({
        apiKey: "test-key",
        campaignDraftId: "draft-1",
        settings: { friendlyName: "Safety Test", futureOption: true } as never,
      }),
    ).rejects.toThrow("Refusing non-allowlisted GMass campaign field: futureOption");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
