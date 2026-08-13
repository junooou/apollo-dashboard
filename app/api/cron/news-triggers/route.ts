import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

    if (!baseUrl) {
      throw new Error(
        "NEXT_PUBLIC_APP_URL is not configured.",
      );
    }

    const response = await fetch(
      `${baseUrl}/api/news-triggers?refresh=1`,
      {
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Daily news refresh failed.",
      );
    }

    return NextResponse.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      counts: data.counts,
      cache: data.cache,
    });
  } catch (error) {
    console.error(
      "Daily news cron failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Daily news cron failed.",
      },
      {
        status: 500,
      },
    );
  }
}