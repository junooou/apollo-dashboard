import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type CampaignScope = "company" | "industry";

type CampaignEmail = {
  label: string;
  topic: string;
  subject: string;
  body: string;
};

type GeneratedCampaign = {
  campaignName: string;
  scope: CampaignScope;
  sequenceRationale: string;
  emails: CampaignEmail[];
};

type GenerateTemplateRequest = {
  scope: CampaignScope;
  company?: string;
  industry?: string;
  context?: string;

  currentCampaign?: GeneratedCampaign;
  revisionInstruction?: string;
};

const campaignSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    campaignName: {
      type: "string",
    },

    scope: {
      type: "string",
      enum: ["company", "industry"],
    },

    sequenceRationale: {
      type: "string",
    },

    emails: {
      type: "array",
      minItems: 2,

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          label: {
            type: "string",
          },

          topic: {
            type: "string",
          },

          subject: {
            type: "string",
          },

          body: {
            type: "string",
          },
        },

        required: ["label", "topic", "subject", "body"],
      },
    },
  },

  required: [
    "campaignName",
    "scope",
    "sequenceRationale",
    "emails",
  ],
};

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "OPENAI_API_KEY is not set in .env.local",
        },
        {
          status: 500,
        },
      );
    }

    const body =
      (await request.json()) as GenerateTemplateRequest;

    if (
      body.scope !== "company" &&
      body.scope !== "industry"
    ) {
      return NextResponse.json(
        {
          error:
            'scope must be either "company" or "industry"',
        },
        {
          status: 400,
        },
      );
    }

    if (
      body.scope === "company" &&
      !body.company?.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "company is required for company-specific outreach",
        },
        {
          status: 400,
        },
      );
    }

    if (
      body.scope === "industry" &&
      !body.industry?.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "industry is required for industry-wide outreach",
        },
        {
          status: 400,
        },
      );
    }

    const isRevision =
      Boolean(body.currentCampaign) &&
      Boolean(body.revisionInstruction?.trim());

    const guidePath = path.join(
      process.cwd(),
      "prompts",
      "voncierge_outreach_generation_guidelines.md",
    );

    const outreachGuide = await fs.readFile(
      guidePath,
      "utf8",
    );

    let taskInput: string;

    if (isRevision) {
      taskInput = `
You are revising an existing Voncierge outreach campaign.

CAMPAIGN SCOPE:
${body.scope}

COMPANY:
${body.company || "Not applicable"}

INDUSTRY:
${body.industry || "Not provided"}

ORIGINAL / ADDITIONAL CONTEXT:
${body.context || "No additional context provided."}

CURRENT CAMPAIGN:
${JSON.stringify(body.currentCampaign, null, 2)}

USER REVISION INSTRUCTION:
${body.revisionInstruction}

REVISION RULES:

1. Treat the CURRENT CAMPAIGN as the starting point.
2. Follow the user's revision instruction precisely.
3. Do NOT rewrite unaffected emails unnecessarily.
4. Preserve wording and structure that the user did not ask to change wherever possible.
5. If the user asks to change only one email, leave the other emails materially unchanged.
6. If the user asks to replace a topic, ensure the replacement still follows the Voncierge outreach guide.
7. Do not invent unsupported facts.
8. Maintain lowercase single-brace merge variables such as {firstname} and {company}.
9. Return the complete updated campaign, including emails that were not changed.
`;
    } else if (body.scope === "company") {
      taskInput = `
Generate a company-specific Voncierge outreach sequence.

COMPANY:
${body.company}

INDUSTRY:
${body.industry || "Not provided"}

ADDITIONAL CONTEXT:
${body.context || "No additional context provided."}

RULES:

1. Make the sequence meaningfully relevant to the company.
2. Use only facts supported by the provided context or the Voncierge outreach guide.
3. Do not invent claims about the company.
4. Where company-specific evidence is unavailable, use careful operational framing rather than pretending we know something.
5. Use {company} as the company merge field where appropriate.
6. Always use {firstname} for the recipient's first name.
`;
    } else {
      taskInput = `
Generate an industry-wide reusable Voncierge outreach sequence.

INDUSTRY:
${body.industry}

ADDITIONAL CONTEXT:
${body.context || "No additional context provided."}

RULES:

1. This sequence must work across multiple companies in this industry.
2. Do not hardcode a specific company name.
3. Use {company} wherever the recipient's company should appear.
4. Always use {firstname} for the recipient's first name.
5. Keep examples and pain points specific enough to the industry to feel intentional.
6. Do not invent unsupported company-specific facts.
`;
    }

    const response = await openai.responses.create({
      model: "gpt-5.6",

      store: false,

      instructions: `
You generate outbound email campaigns for Voncierge.

The VONCIERGE OUTREACH GUIDE below is the source of truth for:
- tone
- positioning
- sequence structure
- approved proof points
- feature descriptions
- competitor framing
- industry guidance
- CTA style
- email length
- merge-field formatting

IMPORTANT NON-NEGOTIABLE RULES:

- Always use lowercase single-brace merge fields.
- Use {firstname}.
- Use {company}.
- Never use {FirstName}.
- Never use {Company}.
- Never use {{firstname}}.
- Never use {{company}}.
- Never invent unsupported company facts.
- Do not claim capabilities that are not supported by the guide.
- Each follow-up should generally focus on one main angle.
- Keep the sequence operationally grounded rather than generic SaaS sales copy.
- Preserve live human escalation framing where relevant.
- Do not imply that Voncierge replaces human staff.

VONCIERGE OUTREACH GUIDE:

${outreachGuide}
`,

      input: taskInput,

      text: {
        format: {
          type: "json_schema",
          name: "voncierge_outreach_campaign",
          strict: true,
          schema: campaignSchema,
        },
      },
    });

    if (!response.output_text) {
      return NextResponse.json(
        {
          error: "OpenAI returned an empty response",
        },
        {
          status: 500,
        },
      );
    }

    const campaign = JSON.parse(
      response.output_text,
    ) as GeneratedCampaign;

    return NextResponse.json(campaign);
  } catch (error) {
    console.error(
      "Template generation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Template generation failed",
      },
      {
        status: 500,
      },
    );
  }
}