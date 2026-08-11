import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import {
  fetchNewsTriggerCandidates,
  type NewsTriggerArticle,
} from "@/lib/currents";

import {
  scoreNewsTriggers,
  type ScoredNewsTrigger,
} from "@/lib/news-scoring";

const CANDIDATES_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "news-candidates.json",
);

const SCORED_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "news-scored.json",
);

type CachedCandidates = {
  fetchedAt: string;
  articles: NewsTriggerArticle[];
};

type NewsTriggerResult = NewsTriggerArticle & {
  score: ScoredNewsTrigger;
};

type CachedScoredNews = {
  fetchedAt: string;
  scoredAt: string;
  results: NewsTriggerResult[];
};

async function readCandidatesCache(): Promise<CachedCandidates | null> {
  try {
    const raw = await fs.readFile(
      CANDIDATES_CACHE_PATH,
      "utf8",
    );

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return null;
    }

    return parsed as CachedCandidates;
  } catch {
    return null;
  }
}

async function writeCandidatesCache(
  articles: NewsTriggerArticle[],
): Promise<CachedCandidates> {
  await fs.mkdir(
    path.dirname(CANDIDATES_CACHE_PATH),
    {
      recursive: true,
    },
  );

  const cache: CachedCandidates = {
    fetchedAt: new Date().toISOString(),
    articles,
  };

  await fs.writeFile(
    CANDIDATES_CACHE_PATH,
    JSON.stringify(cache, null, 2),
    "utf8",
  );

  return cache;
}

async function readScoredCache(): Promise<CachedScoredNews | null> {
  try {
    const raw = await fs.readFile(
      SCORED_CACHE_PATH,
      "utf8",
    );

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return null;
    }

    return parsed as CachedScoredNews;
  } catch {
    return null;
  }
}

async function writeScoredCache(
  fetchedAt: string,
  results: NewsTriggerResult[],
): Promise<CachedScoredNews> {
  await fs.mkdir(
    path.dirname(SCORED_CACHE_PATH),
    {
      recursive: true,
    },
  );

  const cache: CachedScoredNews = {
    fetchedAt,
    scoredAt: new Date().toISOString(),
    results,
  };

  await fs.writeFile(
    SCORED_CACHE_PATH,
    JSON.stringify(cache, null, 2),
    "utf8",
  );

  return cache;
}

async function scoreArticles(
  candidates: CachedCandidates,
): Promise<CachedScoredNews> {
  const scores =
    await scoreNewsTriggers(
      candidates.articles,
    );

  const scoresById = new Map(
    scores.map((score) => [
      score.articleId,
      score,
    ]),
  );

  const results: NewsTriggerResult[] =
    candidates.articles
      .map((article) => {
        const score =
          scoresById.get(article.id);

        if (!score) {
          return null;
        }

        return {
          ...article,
          score,
        };
      })
      .filter(
        (
          item,
        ): item is NewsTriggerResult =>
          item !== null,
      );

  results.sort(
    (a, b) =>
      b.score.relevanceScore -
      a.score.relevanceScore,
  );

  return writeScoredCache(
    candidates.fetchedAt,
    results,
  );
}

export async function GET(
  request: NextRequest,
) {
  try {
    /*
     * refresh=1
     *
     * Fetch NEW articles from Currents
     * AND rescore them with OpenAI.
     *
     * This costs Currents + OpenAI requests.
     */
    const shouldRefresh =
      request.nextUrl.searchParams.get(
        "refresh",
      ) === "1";

    /*
     * rescore=1
     *
     * Keep the existing Currents articles,
     * but run OpenAI again.
     *
     * Useful while tuning the scoring prompt.
     *
     * This costs OpenAI only.
     */
    const shouldRescore =
      request.nextUrl.searchParams.get(
        "rescore",
      ) === "1";

    let candidates =
      await readCandidatesCache();

    let scored =
      await readScoredCache();

    if (shouldRefresh) {
      console.log(
        "Fetching fresh news from Currents...",
      );

      const freshArticles =
        await fetchNewsTriggerCandidates();

      candidates =
        await writeCandidatesCache(
          freshArticles,
        );

      console.log(
        `Saved ${freshArticles.length} fresh Currents articles.`,
      );

      console.log(
        "Scoring fresh articles with OpenAI...",
      );

      scored =
        await scoreArticles(
          candidates,
        );
    } else if (
      shouldRescore
    ) {
      if (!candidates) {
        throw new Error(
          "No cached Currents articles found. Run ?refresh=1 first.",
        );
      }

      console.log(
        "Rescoring cached articles with OpenAI...",
      );

      scored =
        await scoreArticles(
          candidates,
        );
    } else {
      /*
       * Normal dashboard request.
       *
       * No Currents.
       * No OpenAI.
       */
      if (scored) {
        console.log(
          `Using scored news cache from ${scored.scoredAt}`,
        );
      } else {
        /*
         * If raw candidates exist but scored cache doesn't,
         * score them once automatically.
         */
        if (!candidates) {
          throw new Error(
            "No news cache found. Run /api/news-triggers?refresh=1 first.",
          );
        }

        console.log(
          "No scored cache found. Scoring cached articles once...",
        );

        scored =
          await scoreArticles(
            candidates,
          );
      }
    }

    const results =
      scored.results;

    const opportunities =
      results.filter(
        (item) =>
          item.score.relevanceScore >=
          70,
      );

    const ignored =
      results.filter(
        (item) =>
          item.score.relevanceScore <
          70,
      );

    return NextResponse.json({
      opportunities,

      counts: {
        fetched:
          results.length,
        scored:
          results.length,
        opportunities:
          opportunities.length,
        ignored:
          ignored.length,
      },

      ignored,

      cache: {
        fetchedAt:
          scored.fetchedAt,
        scoredAt:
          scored.scoredAt,

        source: shouldRefresh
          ? "currents_and_openai"
          : shouldRescore
            ? "cached_currents_and_openai"
            : "cache",
      },
    });
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