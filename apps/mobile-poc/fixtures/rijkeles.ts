/* Synthetische rijke studieles (eigen tekst, geen officiële inhoud) voor de architectuurproef rijke studielessen.
 * Eén bron voor de seed (echte importketen) en de unit-tests, zodat beide exact dezelfde documentstructuur gebruiken. */
import { parseStudyDocument } from "@/lib/studyContent/schema";

const t = (text: string, marks?: ("strong" | "emphasis")[]) => ({ type: "text" as const, text, ...(marks ? { marks } : {}) });
export const REF_URL = "https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/3?lang=nld&id=p7";
const filler = (n: number) => t(`Synthetische vervolgalinea ${n}. Deze tekst bestaat alleen om de les lang genoeg te maken, zodat scrollen, selecteren onder de vouw en grotere lettergroottes echt gemeten worden zonder officiële brontekst.`);

export function richLessonBody() {
  return parseStudyDocument({
    schemaVersion: 1,
    sections: [{
      id: "section-main",
      blocks: [
        { type: "heading", id: "b-title1", level: 2, content: [t("Proeflezing: de weg naar het beloofde land")] },
        { type: "paragraph", id: "b-intro", content: [t("Dit is een "), t("synthetische", ["strong"]), t(" les met "), t("nadruk", ["emphasis"]), t(" en een verwijzing: "), { type: "reference", id: "ref-inline", label: "1 Nephi 3:7", target: { sourceKey: REF_URL, workKey: "bofm", editionKey: "bofm", language: "nl", externalUrl: REF_URL } }, t(". Zie ook café, naïef en 😊 in één regel.")] },
        { type: "paragraph", id: "b-spaces", content: [t("Dubbele  spatie en\ttab blijven in de bron staan.")] },
        { type: "heading", id: "b-topic1", level: 3, content: [t("Onderwerp één")] },
        { type: "paragraph", id: "b-p1", content: [t("Eerste alinea onder het onderwerp. Een woord selecteren, een deel van een zin of meerdere alinea's tegelijk moet allemaal werken.")] },
        { type: "paragraph", id: "b-p2", content: [t("Tweede alinea direct erna, zodat een selectie over twee alinea's heen kan lopen.")] },
        { type: "figure", id: "img-img2", mediaKey: "media-painting", width: 400, height: 300, alt: "Synthetisch schilderij", caption: [t("Synthetisch schilderij, testkunstenaar")] },
        { type: "list", id: "list-unordered", ordered: false, items: [
          { id: "li-1", content: [t("Eerste opsommingspunt")] },
          { id: "li-2", content: [t("Tweede punt met een subpunt")], children: [{ id: "li-2a", content: [t("Genest subpunt")] }] },
          { id: "li-3", content: [t("Derde punt")] },
        ] },
        { type: "list", id: "list-ordered", ordered: true, items: [
          { id: "ol-1", content: [t("Eerste stap")] },
          { id: "ol-2", content: [t("Tweede stap")] },
        ] },
        { type: "quote", id: "b-quote", content: [t("Een synthetisch citaat dat over meerdere regels kan lopen en een bronvermelding krijgt.")], attribution: [t("Testauteur, 2026")] },
        { type: "table", id: "b-table", rows: [
          { id: "tr-0", cells: [{ id: "th-a", header: true, content: [t("Kolom A")], colSpan: 1, rowSpan: 1 }, { id: "th-b", header: true, content: [t("Kolom B")], colSpan: 1, rowSpan: 1 }] },
          { id: "tr-1", cells: [{ id: "td-a1", header: false, content: [t("Cel A1")], colSpan: 1, rowSpan: 1 }, { id: "td-b1", header: false, content: [t("Cel B1 met iets meer tekst")], colSpan: 1, rowSpan: 1 }] },
          { id: "tr-2", cells: [{ id: "td-a2", header: false, content: [t("Cel A2")], colSpan: 1, rowSpan: 1 }, { id: "td-b2", header: false, content: [t("Cel B2")], colSpan: 1, rowSpan: 1 }] },
        ] },
        { type: "question", id: "b-question", content: [t("Wat betekent deze synthetische proef voor jou?")], items: [{ id: "q-1", content: [t("Denk hier één minuut over na.")] }] },
        { type: "reference", id: "ref-block", label: "1 Nephi 3:7", target: { sourceKey: REF_URL, workKey: "bofm", editionKey: "bofm", language: "nl", externalUrl: REF_URL } },
        { type: "divider", id: "b-divider" },
        { type: "heading", id: "b-topic2", level: 3, content: [t("Onderwerp twee")] },
        ...[1, 2, 3, 4, 5, 6].map(n => ({ type: "paragraph" as const, id: `b-fill${n}`, content: [filler(n)] })),
      ],
    }],
  });
}
