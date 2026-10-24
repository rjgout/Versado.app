import { OT_SCRIPTURE } from "../studyContent/cfmScripture";
import { parseOtbPassage, type OtbPassage } from "./otb";
import { parseVerseSpec } from "./standardWorks";

const codes: Record<string, string> = {
  matt: "mat", mark: "mrk", luke: "luk", john: "jhn", acts: "act", rom: "rom",
  "1-cor": "1co", "2-cor": "2co", gal: "gal", eph: "eph", phil: "php", col: "col",
  "1-thes": "1th", "2-thes": "2th", "1-tim": "1ti", "2-tim": "2ti", titus: "tit",
  philem: "phm", heb: "heb", james: "jas", "1-pet": "1pe", "2-pet": "2pe",
  "1-jn": "1jo", "2-jn": "2jo", "3-jn": "3jo", jude: "jud", rev: "rev",
};
/** Alleen officiële Bijbel-URL's; de URL en het zichtbare label moeten hetzelfde begin aanwijzen.
 * Beschikbaarheid en versnummering worden daarna tegen de echte interne editie gecontroleerd. */
export function bibleUrlTarget(raw: string, label: string) {
  if (label.length > 512) return null;
  if (raw.length > 2048 || /[\u0000-\u0020\\]/.test(raw) || /%(?!2c)/i.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "www.churchofjesuschrist.org" || url.port || url.username || url.password) return null;
  const match = /^\/study\/scriptures\/(ot|nt)\/([^/]+)\/([1-9]\d{0,2})$/.exec(url.pathname);
  const bookCodes = match?.[1] === "ot" ? OT_SCRIPTURE.bookCodes : codes;
  if (!match || !bookCodes[match[2]] || [...url.searchParams.keys()].some(k => !["lang", "id"].includes(k))) return null;
  const language = ({ nld: "nl", eng: "en", deu: "de", fra: "fr", spa: "es" } as Record<string, string>)[url.searchParams.get("lang") ?? ""];
  if (!language || (match[1] === "ot" && language !== "nl") || new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length) return null;
  const parts = label.split(/;\s*/);
  const passages: OtbPassage[] = [];
  let book = "";
  for (const part of parts) {
    const named = /^(.+?)\s+(\d.*)$/.exec(part.trim());
    const spec = named ? named[2] : part.trim();
    if (named) book = named[1];
    if (spec.split(":").length > 2) return null;
    const [chapters, verses] = spec.split(":");
    const ranges = parseVerseSpec(chapters);
    if (!ranges || (verses && ranges.some(([a,b]) => a !== b))) return null;
    for (const [a,b] of ranges) for (let chapter = a; chapter <= b; chapter++) {
      const passage = parseOtbPassage(`${book} ${chapter}${verses ? `:${verses}` : ""}`);
      if (!passage || passage.bookKey !== bookCodes[match[2]] || passages.length >= 40) return null;
      passages.push(passage);
    }
  }
  if (!passages.length || passages[0].chapter !== Number(match[3])) return null;
  const id = url.searchParams.get("id");
  if (id) {
    if (!/^p[1-9]\d{0,2}(?:-p?[1-9]\d{0,2})?(?:,p[1-9]\d{0,2}(?:-p?[1-9]\d{0,2})?)*$/.test(id)) return null;
    const selected = parseOtbPassage(`${bookCodes[match[2]]}:${match[3]}:${id.replace(/p/g, "")}`);
    if (!selected || JSON.stringify(selected.verses) !== JSON.stringify(passages[0].verses)) return null;
  }
  if (url.hash && !/^#p[1-9]\d{0,2}$/.test(url.hash)) return null;
  if (url.hash && passages[0].verses && !passages[0].verses.includes(Number(url.hash.slice(2)))) return null;
  return { workKey: match[1] === "ot" ? "old-testament" : "new-testament", editionKey: "otb", language,
    sourceKey: passages.length === 1 ? `otb:${passages[0].bookKey}:${passages[0].chapter}${passages[0].verses ? `:${passages[0].verses.join(",")}` : ""}` : `otb-set:${passages.map(p => `${p.bookKey}:${p.chapter}${p.verses ? `:${p.verses.join(",")}` : ""}`).join(";")}` };
}
