import { legacyAnnotationRoute } from "@/lib/annotations/http";

export async function PUT(req: Request, { params }: { params: Promise<{ verseId: string }> }) {
  return legacyAnnotationRoute(req, (await params).verseId, "note");
}
