import { NextRequest, NextResponse } from "next/server";

type GmassDraftRequest = {
  subject: string;
  message: string;
  emailAddresses: string;
};

export async function POST(
  request: NextRequest,
) {
  try {
    const apiKey =
      process.env.GMASS_API_KEY;

    const fromEmail =
      process.env.GMASS_FROM_EMAIL;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GMASS_API_KEY is not configured.",
        },
        {
          status: 500,
        },
      );
    }

    if (!fromEmail) {
      return NextResponse.json(
        {
          error:
            "GMASS_FROM_EMAIL is not configured.",
        },
        {
          status: 500,
        },
      );
    }

    const body =
      (await request.json()) as GmassDraftRequest;

    const subject =
      body.subject?.trim();

    const message =
      body.message?.trim();

    const emailAddresses =
      body.emailAddresses?.trim();

    if (!subject) {
      return NextResponse.json(
        {
          error:
            "Subject is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!message) {
      return NextResponse.json(
        {
          error:
            "Email message is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!emailAddresses) {
      return NextResponse.json(
        {
          error:
            "At least one recipient email is required.",
        },
        {
          status: 400,
        },
      );
    }

    const response =
      await fetch(
        "https://api.gmass.co/api/campaigndrafts",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-apikey":
              apiKey,
          },

          body: JSON.stringify({
            fromEmail,

            subject,

            message,

            messageType:
              "plain",

            emailAddresses,
          }),

          cache:
            "no-store",
        },
      );

    const text =
      await response.text();

    let data: unknown;

    try {
      data =
        JSON.parse(text);
    } catch {
      data =
        text;
    }

    if (!response.ok) {
      console.error(
        "GMass draft creation failed:",
        data,
      );

      return NextResponse.json(
        {
          error:
            "GMass draft creation failed.",

          details:
            data,
        },
        {
          status:
            response.status,
        },
      );
    }

    return NextResponse.json({
      ok: true,

      message:
        "GMass campaign draft created.",

      draft:
        data,
    });
  } catch (error) {
    console.error(
      "GMass draft route failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "GMass draft creation failed.",
      },
      {
        status: 500,
      },
    );
  }
}