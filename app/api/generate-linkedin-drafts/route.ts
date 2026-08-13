import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { findJobSignalAngle, findNewsAngle } from "@/lib/linkedin-personalization";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type DraftContact = {
  key: string;
  firstname: string;
  lastname: string;
  title: string;
  company: string;
  seniority?: string;
  location?: string;
};

type GenerateLinkedinDraftsRequest = {
  company: string;
  context?: string;
  contacts: DraftContact[];
};

const draftsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    drafts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          message: { type: "string" },
        },
        required: ["key", "message"],
      },
    },
  },
  required: ["drafts"],
};

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not set in .env.local" },
        { status: 500 },
      );
    }

    const body = (await request.json()) as GenerateLinkedinDraftsRequest;

    if (!body.company?.trim()) {
      return NextResponse.json({ error: "company is required" }, { status: 400 });
    }

    if (!body.contacts?.length) {
      return NextResponse.json({ error: "contacts must be a non-empty array" }, { status: 400 });
    }

    const guidePath = path.join(
      process.cwd(),
      "prompts",
      "voncierge_linkedin_draft_guidelines.md",
    );
    const draftGuide = await fs.readFile(guidePath, "utf8");

    // Company-level signals already computed elsewhere in the app (News
    // Triggers, Job Signals) — pure file reads, no new OpenAI/API cost. Only
    // surfaced if something already cleared those tabs' own "worth acting
    // on" bar (relevanceScore >= 70), so a company with nothing notable
    // simply gets no angle rather than a forced, thin one.
    const [newsAngle, jobSignalAngle] = await Promise.all([
      findNewsAngle(body.company),
      findJobSignalAngle(body.company),
    ]);

    const detectedAngles = [newsAngle, jobSignalAngle]
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => `- (${a.source}) ${a.summary}`)
      .join("\n");

    const contactsInput = body.contacts
      .map(
        (c) =>
          `- key: ${c.key}\n  firstname: ${c.firstname}\n  title: ${c.title || "Not provided"}\n  seniority: ${c.seniority || "Not provided"}\n  location: ${c.location || "Not provided"}\n  company: ${c.company}`,
      )
      .join("\n");

    const taskInput = `
Generate one LinkedIn connection request note per contact below, for outreach
to ${body.company}.

DETECTED COMPANY-LEVEL SIGNALS (use at most one, only if it genuinely fits —
do not force it into every note):
${detectedAngles || "None detected."}

ADDITIONAL CONTEXT:
${body.context?.trim() || "No additional context provided."}

CONTACTS:
${contactsInput}

RULES:

1. Return exactly one draft per contact, matched back by its "key" field —
   the key values must be copied verbatim from the input, unchanged.
2. Each message must independently respect the 300-character cap, and must
   land in the 220-280 character range — that is the actual target, not the
   cap. A draft under 200 characters is incomplete: go back and add a second
   sentence using a specific detail (title, seniority, location, or a
   detected signal) before returning it.
3. Every message must contain all four parts from the guide, in order:
   greeting, a personalized hook specific to that contact, what Voncierge
   does framed toward that contact's world, and a short connect-oriented
   closing line ("Would love to connect.", "Keen to connect.", "Let's
   connect.", or similar). A message that ends on a company fact or
   capability with no closing line is incomplete — if the hook and
   description leave no room for a closing line within 300 characters, trim
   them, never drop the closing.
4. Use each contact's actual firstname/title/seniority/location/company — do
   not swap details between contacts.
5. Do not invent facts about the contact or their company beyond what's given.
6. When multiple contacts share the same company, each note must still read
   as individually written for that person: vary the opening hook, sentence
   structure, and which detail (title vs. seniority vs. location vs. a
   detected signal) gets used as the personalization anchor. Do not reuse the
   same sentence template across contacts at the same company — if two notes
   in this batch would read near-identically, rewrite one.
`;

    const response = await openai.responses.create({
      model: "gpt-5.6",

      store: false,

      instructions: `
You generate LinkedIn connection request notes for Voncierge outreach.

The VONCIERGE LINKEDIN DRAFT GUIDE below is the source of truth for tone,
length, structure, approved proof points, and what not to do.

IMPORTANT NON-NEGOTIABLE RULES:

- Every message must be 300 characters or fewer, including spaces, AND at
  least 200 characters — target 220-280. Do not stop at a short, generic
  note just because it's under the cap; use the space for a real, specific
  detail about the recipient.
- Every message must contain all four parts, in order: greeting →
  personalized hook → what Voncierge does for this recipient → a short
  connect-oriented closing line. A message that ends on a company fact
  instead of a closing line is incomplete and must be rewritten — the
  closing line is never the part to cut for space.
- Never invent unsupported company or personal facts.
- Do not claim capabilities not supported by the guide.
- Do not imply Voncierge replaces human staff.
- No hard call-to-action inside the note itself.
- A detected company-level signal (news or hiring) is optional seasoning, not
  a requirement — use it only where it makes a note read as more specific,
  never force it in if it doesn't fit that particular contact.
- Batches of multiple contacts at the same company must not read like the
  same template with the name swapped.

VONCIERGE LINKEDIN DRAFT GUIDE:

${draftGuide}
`,

      input: taskInput,

      text: {
        format: {
          type: "json_schema",
          name: "voncierge_linkedin_drafts",
          strict: true,
          schema: draftsSchema,
        },
      },
    });

    if (!response.output_text) {
      return NextResponse.json({ error: "OpenAI returned an empty response" }, { status: 500 });
    }

    const parsed = JSON.parse(response.output_text) as { drafts: { key: string; message: string }[] };

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("LinkedIn draft generation failed:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "LinkedIn draft generation failed",
      },
      { status: 500 },
    );
  }
}
