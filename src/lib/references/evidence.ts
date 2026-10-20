import { createHash } from "node:crypto";
import evidence from "./scripture-evidence.json";
import baseOfficialResources from "./official-resources.json";
import cfmOfficialResources from "./official-resources-cfm.json";
export const officialResources = [
  ...baseOfficialResources,
  ...cfmOfficialResources,
];
type BookEvidence = {
  work: string;
  editionKey: string;
  language: string;
  alias: string;
  sourceFile: string;
  sourceHash: string;
  chapters: Record<string, { verses: number; hash: string }>;
};
export const scriptureEvidence: Readonly<Record<string, BookEvidence>> =
  evidence;
export const referenceEvidenceVersion =
  "reference-v1:" +
  createHash("sha256")
    .update(JSON.stringify({ evidence, officialResources }))
    .digest("hex");
export function chapterEvidenceHash(
  verses: readonly { number: number; text: string }[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify(verses.map((v) => ({ number: v.number, text: v.text }))),
    )
    .digest("hex");
}
/**
 * Alleen de exact geïdentificeerde primaire bron; nooit een tekstlabel parseren. Een samengestelde selectie
 * (`id=p10%2Cp13`, `id=p21-p29%2Cp38-p42`) is een oplopende, niet-overlappende lijst van bereiken; de enige toegestane
 * procentcodering is de komma (`%2C`).
 */
export function parseScriptureUrl(raw: string) {
  if (raw.length > 2048 || /[\u0000-\u0020\\]/.test(raw) || /%(?!2c)/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.churchofjesuschrist.org" ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  const path =
    /^\/study\/scriptures\/(bofm|dc-testament|pgp)\/([a-z0-9-]+)\/([1-9][0-9]{0,2})$/.exec(
      url.pathname,
    );
  if (!path) return null;
  const bookKey = `${path[1]}/${path[2]}`,
    book = scriptureEvidence[bookKey],
    chapter = Number(path[3]);
  const row = book?.chapters[String(chapter)];
  if (!row) return null;
  const keys = [...url.searchParams.keys()];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((k) => !["lang", "id"].includes(k))
  )
    return null;
  const code = url.searchParams.get("lang");
  const language = (
    { nld: "nl", eng: "en", deu: "de", fra: "fr", spa: "es" } as Record<
      string,
      string
    >
  )[code ?? ""];
  if (!language) return null;
  let ranges: Array<[number, number]> = [[1, row.verses]];
  const id = url.searchParams.get("id");
  if (id) {
    const parts = id.split(",");
    if (parts.length > 40) return null;
    ranges = [];
    for (const part of parts) {
      const range = /^p([1-9][0-9]{0,2})(?:-p?([1-9][0-9]{0,2}))?$/.exec(part);
      if (!range) return null;
      const start = Number(range[1]),
        end = Number(range[2] ?? range[1]);
      // Oplopend en zonder overlap: een andere volgorde is geen betrouwbare selectie.
      if (start > end || end > row.verses || (ranges.length && start <= ranges[ranges.length - 1][1])) return null;
      ranges.push([start, end]);
    }
  }
  if (url.hash) {
    if (!/^#p[1-9][0-9]{0,2}$/.test(url.hash)) return null;
    const anchor = Number(url.hash.slice(2));
    if (anchor > row.verses) return null;
    if (id) {
      if (!ranges.some(([start, end]) => anchor >= start && anchor <= end)) return null;
    } else ranges = [[anchor, anchor]];
  }
  const from = ranges[0][0],
    to = ranges[ranges.length - 1][1];
  return { bookKey, book, chapter, from, to, ranges, wholeChapter: !id && !url.hash, language, url: url.href };
}
/** Geen host-only vrijbrief voor redirects, login, trackers of onbekende resources. */
export function verifiedOfficialUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const scripture = parseScriptureUrl(raw)?.url;
  if (scripture) return scripture;
  // Exacte gecontroleerde resource-URL, geen hostname-wildcard of live scraper.
  return officialResources.some((resource) => resource.url === raw)
    ? raw
    : null;
}
