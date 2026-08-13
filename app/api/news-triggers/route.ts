import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import {
  sendNewsTriggerAlert,
} from "@/lib/news-alert-email";

import {
  fetchNewsTriggerCandidates,
  type NewsTriggerArticle,
} from "@/lib/currents";

import {
  scoreNewsTriggers,
  type ScoredNewsTrigger,
} from "@/lib/news-scoring";

const HISTORY_PATH = path.join(
  process.cwd(),
  "data",
  "news-history.json",
);

const LEGACY_SCORED_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "news-scored.json",
);

type NewsHistoryEntry = {
  article: NewsTriggerArticle;
  score: ScoredNewsTrigger;

  firstSeenAt: string;
  lastSeenAt: string;

  alertSentAt: string | null;
};

type NewsHistory = {
  lastRefreshAt: string | null;
  entries: NewsHistoryEntry[];
};

type NewsTriggerResult = NewsTriggerArticle & {
  score: ScoredNewsTrigger;

  firstSeenAt: string;
  lastSeenAt: string;

  isNew: boolean;
};

type LegacyScoredCache = {
  fetchedAt?: string;
  scoredAt?: string;

  results?: Array<
    NewsTriggerArticle & {
      score: ScoredNewsTrigger;
    }
  >;
};

function emptyHistory(): NewsHistory {
  return {
    lastRefreshAt: null,
    entries: [],
  };
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);

    url.hash = "";

    // Tracking/query parameters should not make
    // the same article look new.
    url.search = "";

    return url
      .toString()
      .replace(/\/$/, "")
      .toLowerCase();
  } catch {
    return value
      .trim()
      .replace(/\/$/, "")
      .toLowerCase();
  }
}

function articleKey(article: NewsTriggerArticle) {
  if (article.url) {
    return `url:${normalizeUrl(article.url)}`;
  }

  return `id:${article.id}`;
}

async function readHistory(): Promise<NewsHistory> {
  try {
    const raw = await fs.readFile(
      HISTORY_PATH,
      "utf8",
    );

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      !Array.isArray(parsed.entries)
    ) {
      return emptyHistory();
    }

    return parsed as NewsHistory;
  } catch {
    return emptyHistory();
  }
}

async function writeHistory(
  history: NewsHistory,
) {
  await fs.mkdir(
    path.dirname(HISTORY_PATH),
    {
      recursive: true,
    },
  );

  await fs.writeFile(
    HISTORY_PATH,
    JSON.stringify(
      history,
      null,
      2,
    ),
    "utf8",
  );
}

async function migrateLegacyScoredCache(
  history: NewsHistory,
): Promise<NewsHistory> {
  // Only migrate once.
  if (history.entries.length > 0) {
    return history;
  }

  try {
    const raw = await fs.readFile(
      LEGACY_SCORED_CACHE_PATH,
      "utf8",
    );

    const parsed =
      JSON.parse(raw) as LegacyScoredCache;

    if (
      !parsed ||
      !Array.isArray(parsed.results) ||
      parsed.results.length === 0
    ) {
      return history;
    }

    const migratedAt =
      parsed.scoredAt ||
      parsed.fetchedAt ||
      new Date().toISOString();

    const migrated: NewsHistory = {
      lastRefreshAt: null,

      entries: parsed.results.map(
        (result) => {
          const {
            score,
            ...article
          } = result;

          return {
            article,
            score,

            firstSeenAt:
              migratedAt,

            lastSeenAt:
              migratedAt,

            alertSentAt:
              null,
          };
        },
      ),
    };

    await writeHistory(
      migrated,
    );

    console.log(
      `Migrated ${migrated.entries.length} scored articles into news history.`,
    );

    return migrated;
  } catch {
    return history;
  }
}

function buildResponse(
  history: NewsHistory,
  fetchedThisRefresh = 0,
  scoredThisRefresh = 0,
) {
  const latestRefreshAt =
    history.lastRefreshAt;

  const results: NewsTriggerResult[] =
    history.entries.map(
      (entry) => ({
        ...entry.article,

        score:
          entry.score,

        firstSeenAt:
          entry.firstSeenAt,

        lastSeenAt:
          entry.lastSeenAt,

        isNew:
          Boolean(
            latestRefreshAt,
          ) &&
          entry.firstSeenAt ===
            latestRefreshAt,
      }),
    );

  const opportunities =
    results
      .filter(
        (item) =>
          item.score
            .relevanceScore >= 70,
      )
      .sort((a, b) => {
        if (
          a.isNew !== b.isNew
        ) {
          return a.isNew
            ? -1
            : 1;
        }

        return (
          b.score
            .relevanceScore -
          a.score
            .relevanceScore
        );
      });

  const ignored =
    results
      .filter(
        (item) =>
          item.score
            .relevanceScore < 70,
      )
      .sort(
        (a, b) =>
          new Date(
            b.firstSeenAt,
          ).getTime() -
          new Date(
            a.firstSeenAt,
          ).getTime(),
      );

  const newArticles =
    results.filter(
      (item) =>
        item.isNew,
    );

  const newOpportunities =
    newArticles.filter(
      (item) =>
        item.score
          .relevanceScore >= 70,
    );

  return {
    opportunities,

    counts: {
      fetched:
        fetchedThisRefresh,

      scored:
        results.length,

      opportunities:
        opportunities.length,

      ignored:
        ignored.length,

      newArticles:
        newArticles.length,

      newOpportunities:
        newOpportunities.length,

      scoredThisRefresh,
    },

    ignored,

    cache: {
      fetchedAt:
        history.lastRefreshAt,

      scoredAt:
        history.lastRefreshAt,

      source:
        "history",

      lastRefreshAt:
        history.lastRefreshAt,
    },
  };
}

async function refreshNews(
  history: NewsHistory,
) {
  const refreshAt =
    new Date().toISOString();

  const freshArticles =
    await fetchNewsTriggerCandidates();

  console.log(
    `Currents returned ${freshArticles.length} trusted articles.`,
  );

  const existingByKey =
    new Map<
      string,
      NewsHistoryEntry
    >();

  for (
    const entry
    of history.entries
  ) {
    existingByKey.set(
      articleKey(
        entry.article,
      ),
      entry,
    );
  }

  const newArticles:
    NewsTriggerArticle[] = [];

  for (
    const article
    of freshArticles
  ) {
    const key =
      articleKey(article);

    const existing =
      existingByKey.get(
        key,
      );

    if (existing) {
      /*
       * IMPORTANT:
       * Preserve the ORIGINAL score.
       *
       * The same article should not be
       * sent to OpenAI every day and
       * randomly move from 92 → 88 etc.
       */
      existing.article = {
        ...existing.article,
        ...article,
      };

      existing.lastSeenAt =
        refreshAt;

      continue;
    }

    newArticles.push(
      article,
    );
  }

  console.log(
    `${newArticles.length} genuinely new article${
      newArticles.length === 1
        ? ""
        : "s"
    } found.`,
  );

  /*
   * Score ONLY genuinely new articles.
   */
  if (
    newArticles.length > 0
  ) {
    console.log(
      "Scoring new articles with OpenAI...",
    );

    const scores =
      await scoreNewsTriggers(
        newArticles,
      );

    const scoreById =
      new Map(
        scores.map(
          (score) => [
            score.articleId,
            score,
          ],
        ),
      );

    for (
      const article
      of newArticles
    ) {
      const score =
        scoreById.get(
          article.id,
        );

      if (!score) {
        console.warn(
          `No OpenAI score returned for article ${article.id}`,
        );

        continue;
      }

      const entry:
        NewsHistoryEntry = {
          article,
          score,

          firstSeenAt:
            refreshAt,

          lastSeenAt:
            refreshAt,

          alertSentAt:
            null,
        };

      history.entries.push(
        entry,
      );

      existingByKey.set(
        articleKey(
          article,
        ),
        entry,
      );
    }
  }

  /*
   * Find ONLY:
   *
   * - articles discovered in THIS refresh
   * - score >= 70
   * - never emailed before
   */
  const newActionableEntries =
    history.entries.filter(
      (entry) =>
        entry.firstSeenAt ===
          refreshAt &&
        entry.score
          .relevanceScore >= 70 &&
        entry.alertSentAt ===
          null,
    );

  /*
   * Send ONE digest email containing
   * all new actionable articles.
   *
   * If there are no new >=70 articles,
   * no email is sent.
   */
  if (
    newActionableEntries.length >
    0
  ) {
    console.log(
      `Sending email alert for ${newActionableEntries.length} new opportunity${
        newActionableEntries.length ===
        1
          ? ""
          : "ies"
      }...`,
    );

    try {
      await sendNewsTriggerAlert(
        newActionableEntries.map(
          (entry) => ({
            ...entry.article,
            score:
              entry.score,
          }),
        ),
      );

      /*
       * Only mark an alert as sent
       * AFTER Resend succeeds.
       */
      const sentAt =
        new Date().toISOString();

      for (
        const entry
        of newActionableEntries
      ) {
        entry.alertSentAt =
          sentAt;
      }

      console.log(
        "News alert email sent successfully.",
      );
    } catch (error) {
      /*
       * IMPORTANT:
       *
       * If the email fails, leave
       * alertSentAt = null.
       *
       * We don't want a failed email
       * to permanently suppress the alert.
       */
      console.error(
        "News alert email failed:",
        error,
      );
    }
  } else {
    console.log(
      "No new actionable articles. No email alert needed.",
    );
  }

  history.lastRefreshAt =
    refreshAt;

  /*
   * Keep newest discoveries first
   * inside news-history.json.
   */
  history.entries.sort(
    (a, b) =>
      new Date(
        b.firstSeenAt,
      ).getTime() -
      new Date(
        a.firstSeenAt,
      ).getTime(),
  );

  /*
   * Save EVERYTHING:
   *
   * - old history
   * - new articles
   * - stable scores
   * - lastSeenAt
   * - alertSentAt
   */
  await writeHistory(
    history,
  );

  return {
    history,

    fetchedThisRefresh:
      freshArticles.length,

    scoredThisRefresh:
      newArticles.length,
  };
}

export async function GET(
  request: NextRequest,
) {
  try {
    const shouldRefresh =
      request.nextUrl
        .searchParams
        .get(
          "refresh",
        ) === "1";

    let history =
      await readHistory();

    history =
      await migrateLegacyScoredCache(
        history,
      );

    /*
     * Normal dashboard load:
     *
     * /api/news-triggers
     *
     * ZERO Currents calls
     * ZERO OpenAI calls
     * ZERO emails
     */
    if (!shouldRefresh) {
      return NextResponse.json(
        buildResponse(
          history,
        ),
      );
    }

    /*
     * Manual or scheduled refresh:
     *
     * /api/news-triggers?refresh=1
     *
     * Currents runs
     * → new articles identified
     * → only new articles scored
     * → new >=70 articles emailed
     * → history saved
     */
    const refreshed =
      await refreshNews(
        history,
      );

    return NextResponse.json(
      buildResponse(
        refreshed.history,
        refreshed
          .fetchedThisRefresh,
        refreshed
          .scoredThisRefresh,
      ),
    );
  } catch (error) {
    console.error(
      "News trigger pipeline failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "News trigger pipeline failed",
      },
      {
        status: 500,
      },
    );
  }
}