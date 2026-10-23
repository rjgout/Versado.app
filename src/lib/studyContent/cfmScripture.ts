import { parseOtbPassageSet, type OtbPassage } from "@/lib/references/otb";
import otbIndex from "../../../data/study-content/cfm-2026-nl/otb-index.json";

/**
 * De schriftuurprofielen waarmee een jaargang haar verwijzingen naar een interne schrifteditie kan leggen. Alleen het Oude
 * Testament (OTB) heeft een bewezen hoofdstuk- en verzenindex; een jaargang zonder profiel houdt haar verwijzingen als
 * officiële bron-URL en volgt daarna de gewone verwijzingsregels (onoplosbaar = veilige, niet-klikbare tekst).
 */
export interface CfmScriptureProfile {
  /** Het padsegment in de officiële URL, bv. "ot" in /study/scriptures/ot/gen/1. */
  pathSegment: string;
  workKey: string;
  editionKey: string;
  bookCodes: Readonly<Record<string, string>>;
  index: { chapters: ReadonlyArray<{ bookKey: string; chapter: number; verses: readonly number[] }> };
}

const otBookCodes: Record<string, string> = {
  gen: "gen",
  ex: "exo",
  lev: "lev",
  num: "num",
  deut: "deu",
  josh: "jos",
  judg: "jdg",
  ruth: "rut",
  "1-sam": "1sa",
  "2-sam": "2sa",
  "1-kgs": "1ki",
  "2-kgs": "2ki",
  "1-chr": "1ch",
  "2-chr": "2ch",
  ezra: "ezr",
  neh: "neh",
  esth: "est",
  job: "job",
  ps: "psa",
  prov: "pro",
  eccl: "ecc",
  song: "sng",
  isa: "isa",
  jer: "jer",
  lam: "lam",
  ezek: "ezk",
  dan: "dan",
  hosea: "hos",
  joel: "joe",
  amos: "amo",
  obad: "oba",
  jonah: "jon",
  micah: "mic",
  nahum: "nah",
  hab: "hab",
  zeph: "zep",
  hag: "hag",
  zech: "zac",
  mal: "mal",
};
/** Alleen bestaande hoofdstukken en expliciete verzen; grote bereiken worden
 * in echte selecties van maximaal 40 verzen verdeeld, nooit ingekort. */
export function passageKey(parts: OtbPassage[]): string | null {
  const keys: string[] = [];
  for (const p of parts) {
    const row = otbIndex.chapters.find(
      (c) => c.bookKey === p.bookKey && c.chapter === p.chapter,
    );
    if (!row || p.verses?.some((v) => !row.verses.includes(v))) return null;
    if (!p.verses) keys.push(`${p.bookKey}:${p.chapter}`);
    else
      for (let i = 0; i < p.verses.length; i += 40)
        keys.push(
          `${p.bookKey}:${p.chapter}:${p.verses.slice(i, i + 40).join(",")}`,
        );
  }
  if (keys.length === 1) return `otb:${keys[0]}`;
  const key = `otb-set:${keys.join(";")}`;
  return parseOtbPassageSet(key) ? key : null;
}

export const OT_SCRIPTURE: CfmScriptureProfile = {
  pathSegment: "ot",
  workKey: "old-testament",
  editionKey: "otb",
  bookCodes: otBookCodes,
  index: otbIndex,
};
