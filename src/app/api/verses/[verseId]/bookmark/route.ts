import { legacyAnnotationRoute } from "@/lib/annotations/http";

export async function POST(req: Request, { params }: { params: Promise<{ verseId: string }> }) {
  return legacyAnnotationRoute(req, (await params).verseId, "bookmark");
}
