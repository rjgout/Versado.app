import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { authorizedStudyMedia } from "@/lib/studyContent/mediaAccess";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store, private",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401, headers });
  try {
    const media = await authorizedStudyMedia(user, (await params).mediaId);
    return new NextResponse(new Uint8Array(media.bytes), {
      headers: {
        ...headers,
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.length),
        "Content-Disposition": `inline; filename="${media.storageKey}"`,
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404, headers });
  }
}
