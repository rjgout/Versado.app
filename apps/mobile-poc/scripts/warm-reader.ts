/* Warmt de leesroutes en de annotatie-schrijfroute van de backend op met een los testaccount (Frank), zodat de eerste echte
 * aanroep uit de app niet door een koude compilatie of een trage eerste transactie in een tijdslimiet loopt. Draait vanuit apps/mobile-poc. */
import { createAppSession } from "@poc/core/session";
import { deleteAnnotation, loadBundle, putAnnotation } from "@poc/reader/api";

const base = process.env.POC_BASE_URL ?? "http://127.0.0.1:3100";
const pw = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
(async () => {
  let v: string | null = null;
  const s = createAppSession(base, { read: async () => v, write: async x => { v = x; }, clear: async () => { v = null; } });
  await s.signIn("frank@example.invalid", pw);
  const { reader, annotations } = await loadBundle(s.client);
  const verse = reader.verses[reader.verses.length - 1]!;
  const put = await putAnnotation(s.client, reader, annotations.annotations, { kind: "highlight", verseId: verse.id, color: "yellow" });
  await deleteAnnotation(s.client, reader, put.annotation);
  console.log("leesroutes opgewarmd");
  process.exit(0);
})().catch(e => { console.error("opwarmen leesroutes mislukt (niet fataal):", e instanceof Error ? e.message : e); process.exit(0); });
