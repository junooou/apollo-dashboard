import { Resend } from "resend";

import type { NewsTriggerArticle } from "@/lib/currents";
import type { ScoredNewsTrigger } from "@/lib/news-scoring";

/**
 * Lazy singleton, not a module-scope `new Resend(...)`. The Resend SDK
 * throws immediately if its key is empty, and RESEND_API_KEY is an optional
 * integration (see .env.local.example) — constructing it at import time
 * broke `npm run build` for anyone without that key set, since Next
 * evaluates every API route module while collecting page data. Matches the
 * lazy-client pattern already used for Apollo (`getApiKey()` in
 * lib/apollo.ts) and Google Sheets (`getClient()` in lib/sheets.ts).
 */
let cachedResend: Resend | null = null;

function getResendClient(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY);
  }
  return cachedResend;
}

type AlertArticle = NewsTriggerArticle & {
  score: ScoredNewsTrigger;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(date);
}

function renderCapabilities(capabilities: string[]) {
  if (!capabilities.length) {
    return "";
  }

  return `
    <tr>
      <td style="padding-top: 12px;">
        <div style="
          font-size: 12px;
          line-height: 1.6;
          color: #667085;
        ">
          <strong style="color:#344054;">Relevant capabilities:</strong>
          ${capabilities.map((item) => escapeHtml(item)).join(" · ")}
        </div>
      </td>
    </tr>
  `;
}

function renderArticleCard(article: AlertArticle) {
  const score = article.score.relevanceScore;
  const company = article.score.company || "Potential opportunity";
  const industry = article.score.industry || "General";
  const badge =
    score >= 85 ? "HIGH SIGNAL" : "REVIEW";
  const badgeBg =
    score >= 85 ? "#EEF4FF" : "#F2F4F7";
  const badgeColor =
    score >= 85 ? "#3538CD" : "#475467";

  return `
    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      border="0"
      style="
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
        background: #ffffff;
        border: 1px solid #EAECF0;
        border-radius: 20px;
      "
    >
      <tr>
        <td style="padding: 24px;">

          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="width:100%; border-collapse: collapse;"
          >
            <tr>
              <td valign="top" style="padding-right: 16px;">
                <div style="
                  font-size: 28px;
                  line-height: 1;
                  font-weight: 800;
                  color: #315EFB;
                  margin-bottom: 12px;
                ">
                  ${score}
                </div>

                <div style="
                  display: inline-block;
                  padding: 6px 10px;
                  border-radius: 999px;
                  background: ${badgeBg};
                  color: ${badgeColor};
                  font-size: 11px;
                  font-weight: 700;
                  letter-spacing: 0.04em;
                  text-transform: uppercase;
                ">
                  ${badge}
                </div>
              </td>

              <td valign="top" width="100%">
                <div style="
                  font-size: 24px;
                  line-height: 1.2;
                  font-weight: 800;
                  color: #101828;
                  margin-bottom: 6px;
                ">
                  ${escapeHtml(company)}
                </div>

                <div style="
                  font-size: 13px;
                  line-height: 1.5;
                  color: #667085;
                  margin-bottom: 16px;
                ">
                  ${escapeHtml(industry)} · ${escapeHtml(article.domain)} · ${escapeHtml(formatDate(article.published))}
                </div>

                <div style="
                  font-size: 18px;
                  line-height: 1.4;
                  font-weight: 700;
                  color: #1D2939;
                  margin-bottom: 16px;
                ">
                  ${escapeHtml(article.title)}
                </div>

                ${
                  article.description
                    ? `
                  <div style="
                    font-size: 14px;
                    line-height: 1.65;
                    color: #475467;
                    margin-bottom: 18px;
                  ">
                    ${escapeHtml(article.description)}
                  </div>
                `
                    : ""
                }

                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="
                    width: 100%;
                    border-collapse: collapse;
                    background: #F8FAFC;
                    border-radius: 14px;
                    margin-bottom: 12px;
                  "
                >
                  <tr>
                    <td style="padding: 16px;">
                      <div style="
                        font-size: 11px;
                        line-height: 1.4;
                        font-weight: 800;
                        letter-spacing: 0.08em;
                        text-transform: uppercase;
                        color: #667085;
                        margin-bottom: 8px;
                      ">
                        Why this matters
                      </div>

                      <div style="
                        font-size: 14px;
                        line-height: 1.7;
                        color: #344054;
                      ">
                        ${escapeHtml(article.score.whyRelevant)}
                      </div>
                    </td>
                  </tr>
                </table>

                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="
                    width: 100%;
                    border-collapse: collapse;
                    background: #F8FAFC;
                    border-radius: 14px;
                  "
                >
                  <tr>
                    <td style="padding: 16px;">
                      <div style="
                        font-size: 11px;
                        line-height: 1.4;
                        font-weight: 800;
                        letter-spacing: 0.08em;
                        text-transform: uppercase;
                        color: #667085;
                        margin-bottom: 8px;
                      ">
                        Suggested angle
                      </div>

                      <div style="
                        font-size: 14px;
                        line-height: 1.7;
                        color: #344054;
                      ">
                        ${escapeHtml(article.score.suggestedOutreachAngle)}
                      </div>
                    </td>
                  </tr>
                </table>

                ${renderCapabilities(article.score.vonciergeCapabilities)}

                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="margin-top: 18px;"
                >
                  <tr>
                    <td>
                      <a
                        href="${escapeHtml(article.url)}"
                        style="
                          display: inline-block;
                          padding: 12px 18px;
                          background: #315EFB;
                          color: #ffffff;
                          text-decoration: none;
                          border-radius: 999px;
                          font-size: 13px;
                          font-weight: 700;
                        "
                      >
                        Read article ↗
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  `;
}

export async function sendNewsTriggerAlert(
  articles: AlertArticle[],
) {
  if (articles.length === 0) {
    return null;
  }

  const to = process.env.NEWS_ALERT_EMAIL;
  const logoUrl = process.env.NEWS_ALERT_LOGO_URL;
  const from =
    process.env.NEWS_ALERT_FROM ||
    "Voncierge Intelligence <onboarding@resend.dev>";

  if (!to) {
    throw new Error("NEWS_ALERT_EMAIL is not configured.");
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const highSignals = articles.filter(
    (article) => article.score.relevanceScore >= 85,
  ).length;

  const subject =
    articles.length === 1
      ? `✦ New Voncierge sales signal: ${articles[0].score.company || articles[0].title}`
      : `✦ ${articles.length} new Voncierge sales signals`;

  const html = `
    <!doctype html>
    <html>
      <body style="
        margin: 0;
        padding: 0;
        background: #F5F7FB;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      ">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="width:100%; border-collapse: collapse; background:#F5F7FB;"
        >
          <tr>
            <td align="center" style="padding: 32px 16px;">
              <table
                role="presentation"
                width="680"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width: 100%;
                  max-width: 680px;
                  border-collapse: collapse;
                "
              >
                <tr>
                  <td style="padding-bottom: 20px;">
                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="
                        width:100%;
                        border-collapse: collapse;
                        background: linear-gradient(135deg, #FFFFFF 0%, #F8F7FF 100%);
                        border: 1px solid #E8EAF5;
                        border-radius: 24px;
                      "
                    >
                      <tr>
                        <td style="padding: 28px 28px 24px 28px;">

                          ${
                            logoUrl
                              ? `
                            <div style="margin-bottom: 18px;">
                              <img
                                src="${escapeHtml(logoUrl)}"
                                alt="Voncierge"
                                style="
                                  display: block;
                                  max-width: 180px;
                                  height: auto;
                                  border: 0;
                                "
                              />
                            </div>
                          `
                              : `
                            <div style="
                              margin-bottom: 18px;
                              font-size: 14px;
                              font-weight: 800;
                              letter-spacing: 0.08em;
                              text-transform: uppercase;
                              color: #315EFB;
                            ">
                              Voncierge
                            </div>
                          `
                          }

                          <div style="
                            font-size: 12px;
                            line-height: 1.4;
                            font-weight: 800;
                            letter-spacing: 0.12em;
                            text-transform: uppercase;
                            color: #315EFB;
                            margin-bottom: 10px;
                          ">
                            Outbound Intelligence
                          </div>

                          <div style="
                            font-size: 38px;
                            line-height: 1.08;
                            font-weight: 850;
                            letter-spacing: -0.04em;
                            color: #101828;
                            margin-bottom: 12px;
                          ">
                            New sales signals found.
                          </div>

                          <div style="
                            font-size: 16px;
                            line-height: 1.6;
                            color: #667085;
                            margin-bottom: 18px;
                          ">
                            ${articles.length} new actionable ${articles.length === 1 ? "article" : "articles"}${highSignals > 0 ? ` · ${highSignals} high ${highSignals === 1 ? "signal" : "signals"}` : ""}
                          </div>

                          <div style="
                            font-size: 14px;
                            line-height: 1.6;
                            color: #475467;
                          ">
                            Here are the newly discovered news opportunities worth reviewing for Voncierge.
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td>
                    ${articles.map(renderArticleCard).join("")}
                  </td>
                </tr>

                <tr>
                  <td style="padding-top: 8px; text-align:center;">
                    <div style="
                      font-size: 12px;
                      line-height: 1.7;
                      color: #98A2B3;
                    ">
                      Generated automatically by Voncierge Outbound Intelligence.<br />
                      Only newly discovered articles scoring 70 or above are sent.
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const { data, error } = await getResendClient().emails.send({
    from,
    to: [to],
    subject,
    html,
  });

  if (error) {
    throw new Error(`Failed to send news alert: ${error.message}`);
  }

  return data;
}