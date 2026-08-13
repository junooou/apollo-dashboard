import OpenAI from "openai";
import type { NewsTriggerArticle } from "@/lib/currents";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type TriggerType =
  | "expansion"
  | "new_opening"
  | "renovation"
  | "digital_transformation"
  | "customer_experience"
  | "ai_adoption"
  | "self_service"
  | "partnership"
  | "other";

export type RecommendedAction =
  | "generate_outreach"
  | "watch"
  | "ignore";

export type ScoredNewsTrigger = {
  articleId: string;

  relevant: boolean;
  relevanceScore: number;

  company: string | null;
  industry: string | null;

  triggerType: TriggerType;

  whyRelevant: string;

  vonciergeCapabilities: string[];

  suggestedOutreachAngle: string;

  recommendedAction: RecommendedAction;
};

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          articleId: {
            type: "string",
          },

          relevant: {
            type: "boolean",
          },

          relevanceScore: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },

          company: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "null",
              },
            ],
          },

          industry: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "null",
              },
            ],
          },

          triggerType: {
            type: "string",
            enum: [
              "expansion",
              "new_opening",
              "renovation",
              "digital_transformation",
              "customer_experience",
              "ai_adoption",
              "self_service",
              "partnership",
              "other",
            ],
          },

          whyRelevant: {
            type: "string",
          },

          vonciergeCapabilities: {
            type: "array",
            items: {
              type: "string",
            },
          },

          suggestedOutreachAngle: {
            type: "string",
          },

          recommendedAction: {
            type: "string",
            enum: [
              "generate_outreach",
              "watch",
              "ignore",
            ],
          },
        },

        required: [
          "articleId",
          "relevant",
          "relevanceScore",
          "company",
          "industry",
          "triggerType",
          "whyRelevant",
          "vonciergeCapabilities",
          "suggestedOutreachAngle",
          "recommendedAction",
        ],
      },
    },
  },

  required: ["results"],
} as const;

function buildScoringPrompt(
  articles: NewsTriggerArticle[],
) {
  return `
You are evaluating recent business news for Voncierge sales opportunities.

Voncierge is an AI-enabled customer experience platform focused on
customer-facing and operational use cases.

Relevant Voncierge capabilities include:

- multilingual AI concierge
- conversational AI
- customer service automation
- guest / passenger / visitor assistance
- self-service experiences
- kiosk and physical-digital customer touchpoints
- live human escalation
- transcription and translation
- agentic workflows and actions
- customer experience transformation
- device-agnostic deployment
- deployment across hotels, airports, malls, banks, hospitals,
  government environments, retail environments and similar
  customer-facing organisations

IMPORTANT:
Do NOT treat every article as a sales opportunity.

An article should score highly only when there is:

1. A clearly identifiable organisation that could plausibly buy Voncierge.
2. A concrete recent event or change.
3. A meaningful customer-facing or operational implication.
4. A genuine fit with one or more Voncierge capabilities.
5. A timely reason to contact the organisation now.

Examples of STRONG triggers:

- hotel group opening or expanding properties
- airport opening or expanding a terminal
- mall redevelopment
- bank branch transformation
- hospital expansion
- customer experience transformation programme
- deployment of kiosks or self-service systems
- new digital customer service initiative
- conversational AI / automation initiative
- major hospitality, aviation, retail or healthcare expansion

Examples of WEAK or IRRELEVANT news:

- general AI commentary
- stock-market commentary
- academic research
- executive appointments without a relevant operational initiative
- accidents or incidents with no commercial CX implication
- generic rankings
- lifestyle stories
- unrelated technology companies
- stories where Voncierge could technically be mentioned but there is
  no compelling reason for outreach

Score according to this scale:

85-100:
Strong and actionable sales trigger.
There is a clear company, clear event, strong Voncierge fit and a timely
reason to contact them.
recommendedAction = "generate_outreach"

70-84:
Potentially useful trigger but requires human review.
recommendedAction = "watch"

0-69:
Not strong enough for the primary opportunity feed.
recommendedAction = "ignore"

Be conservative.

Do not invent initiatives, needs, budgets, projects, deployments,
procurement activity, or customer experience problems that are not
supported by the article title and description.

If the article is merely interesting to the Voncierge industry but does
not create an actionable sales reason, score it low.

For "whyRelevant":
Explain the connection to Voncierge in 1-3 concise sentences.

For "suggestedOutreachAngle":
Describe a grounded outreach angle based ONLY on the event stated in the
article.
Do not write the actual email.

If the article is irrelevant:
- relevant must be false
- recommendedAction must be "ignore"
- vonciergeCapabilities should usually be []
- suggestedOutreachAngle should be a short explanation such as
  "No clear outreach angle."

ARTICLES:

${JSON.stringify(
  articles.map((article) => ({
    articleId: article.id,
    title: article.title,
    description: article.description,
    domain: article.domain,
    published: article.published,
    category: article.category,
  })),
  null,
  2,
)}
`;
}

export async function scoreNewsTriggers(
  articles: NewsTriggerArticle[],
): Promise<ScoredNewsTrigger[]> {
  if (articles.length === 0) {
    return [];
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured.",
    );
  }

  const response = await openai.responses.create({
    model: "gpt-5.6",

    store: false,

    input: buildScoringPrompt(articles),

    text: {
      format: {
        type: "json_schema",
        name: "voncierge_news_trigger_scores",
        strict: true,
        schema: SCORE_SCHEMA,
      },
    },
  });

  if (!response.output_text) {
    throw new Error(
      "OpenAI did not return news trigger scores.",
    );
  }

  const parsed = JSON.parse(
    response.output_text,
  ) as {
    results: ScoredNewsTrigger[];
  };

  return parsed.results;
}