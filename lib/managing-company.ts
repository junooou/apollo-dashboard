import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ManagingCompanyType =
  | "facilities_management"
  | "real_estate_management"
  | "property_owner"
  | "franchise_operator"
  | "other";

export type ManagingCompanyResult = {
  propertyName: string;
  found: boolean;
  managingCompany: string | null;
  managingCompanyType: ManagingCompanyType | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  alternateCandidates: string[];
};

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    propertyName: {
      type: "string",
    },

    found: {
      type: "boolean",
    },

    managingCompany: {
      anyOf: [
        {
          type: "string",
        },
        {
          type: "null",
        },
      ],
    },

    managingCompanyType: {
      anyOf: [
        {
          type: "string",
          enum: [
            "facilities_management",
            "real_estate_management",
            "property_owner",
            "franchise_operator",
            "other",
          ],
        },
        {
          type: "null",
        },
      ],
    },

    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },

    reasoning: {
      type: "string",
    },

    alternateCandidates: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },

  required: [
    "propertyName",
    "found",
    "managingCompany",
    "managingCompanyType",
    "confidence",
    "reasoning",
    "alternateCandidates",
  ],
} as const;

function buildPrompt(propertyName: string) {
  return `
You are researching who actually manages a specific property or building, for
Voncierge's B2B sales prospecting.

Voncierge sells to whoever runs day-to-day, customer-facing operations at a
property — but the visible brand on a building is often NOT the company that
makes vendor and technology decisions for it. That is frequently outsourced
to a separate facilities management (FM) company or real estate / property
management company under contract. Examples of this pattern: a mall's retail
brand vs. its FM operator (e.g. JLL, CBRE, Knight Frank, Savills, Cushman &
Wakefield, Lendlease, CapitaLand, Frasers Property, ISS Facility Services),
or a hotel's visible brand vs. the actual owning/operating entity behind it.

Search for and identify the company that is actually responsible for
operating and managing this property day-to-day — the property/facilities
manager, not necessarily the building's developer, landlord, or the tenants
inside it.

Property or building:
"${propertyName}"

Rules:

- In the large majority of cases there is exactly ONE company that manages a
  given property. Return your single best answer as "managingCompany" — do
  not hedge by naming a generic parent group when a specific operating
  entity is known.
- Only set "found" to true and fill "managingCompany" when you have a
  reasonably specific, named company — not a vague guess.
- "managingCompanyType" should describe what kind of company it is.
- "confidence" reflects how sure you are that the entity you named is
  currently responsible for this property, based on what you found.
- "reasoning" should be 1-3 concise sentences citing what you found and why
  it's the managing company, not just the brand or the owner.
- "alternateCandidates" should list other plausible companies only when the
  answer is genuinely ambiguous between them — leave it empty for a clear
  single answer.
- If you cannot find a specific enough answer, set "found" to false,
  "managingCompany" to null, "managingCompanyType" to null, and explain what
  you did find (e.g. only the owner, only the brand) in "reasoning".
- Do not invent a company name. If nothing specific enough turns up, say so.
`;
}

export async function findManagingCompany(
  propertyName: string,
): Promise<ManagingCompanyResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured.",
    );
  }

  const response = await openai.responses.create({
    model: "gpt-5.6",

    store: false,

    tools: [{ type: "web_search" }],

    input: buildPrompt(propertyName),

    text: {
      format: {
        type: "json_schema",
        name: "voncierge_managing_company",
        strict: true,
        schema: RESULT_SCHEMA,
      },
    },
  });

  if (!response.output_text) {
    throw new Error(
      "OpenAI did not return a managing-company result.",
    );
  }

  return JSON.parse(response.output_text) as ManagingCompanyResult;
}
