/* Warmt de lesroutes, de mediaroute en de annotatie-schrijfroute van de backend op met een los testaccount (Hans), zodat de eerste echte
 * aanroep uit de app niet door een koude compilatie in een tijdslimiet loopt. Draait vanuit apps/mobile-poc. */
import { createAppSession } from "@poc/core/session";
import { deleteStudyAnnotation, loadStudy, loadStudyImage, putStudyAnnotation } from "@poc/study/api";
import { buildItems, buildRunLayout, rangesToLessonSelector, selectionToRanges } from "@poc/study/runModel";

const base = process.env.POC_BASE_URL ?? "http://127.0.0.1:3100";
const pw = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
(async () => {
  let v: string | null = null;
  const s = createAppSession(base, { read: async () => v, write: async x => { v = x; }, clear: async () => { v = null; } });
  await s.signIn("hans@example.invalid", pw);
  const { lesson, annotations } = await loadStudy(s.client);
  const media = lesson.media.find(m => m.mediaId)?.mediaId;
  if (media) await loadStudyImage(s.client, media);
  const section = lesson.body.sections[0]!.id, first = buildItems(lesson.body, section)[0]!;
  if (first.type === "run") {
    const layout = buildRunLayout(first.units);
    const selector = rangesToLessonSelector(lesson.body, section, lesson.revisionId, selectionToRanges(layout, 2, 9));
    const put = await putStudyAnnotation(s.client, lesson, annotations.annotations, annotations.tombstones, selector, { kind: "highlight", color: "yellow" });
    await deleteStudyAnnotation(s.client, lesson, put.annotation);
  }
  console.log("lesroutes opgewarmd");
  process.exit(0);
})().catch(e => { console.error("opwarmen lesroutes mislukt (niet fataal):", e instanceof Error ? e.message : e); process.exit(0); });
