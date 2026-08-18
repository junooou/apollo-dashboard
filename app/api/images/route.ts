import { NextResponse } from "next/server";
import {
  listEmailImages,
  uploadEmailImage,
  validateImageFile,
  MAX_IMAGE_BYTES,
} from "@/lib/email-images";

export async function GET() {
  try {
    const images = await listEmailImages();
    return NextResponse.json({ images });
  } catch (error) {
    console.error("Listing email images failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Listing email images failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A file is required" },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          error: `Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB per image).`,
        },
        { status: 400 },
      );
    }

    const validationError = validateImageFile(file.type, file.size);

    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 },
      );
    }

    const saveToLibrary = formData.get("saveToLibrary") === "true";

    const buffer = Buffer.from(await file.arrayBuffer());
    const image = await uploadEmailImage(buffer, file.name, file.type, {
      toLibrary: saveToLibrary,
    });

    return NextResponse.json(image);
  } catch (error) {
    console.error("Email image upload failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Email image upload failed",
      },
      { status: 500 },
    );
  }
}
