import { lookup } from "node:dns/promises";
import { promises as fs, constants } from "node:fs";
import { isIP } from "node:net";
import { parseFragment } from "parse5";
import { abortable, publicStudyAddress, studyDownloadUrl, studyHttpsTransport, type StudyDownloadOptions } from "@/lib/studyContent/download";
import { objectHash } from "./contract";
import type { OfficialSource } from "./officialCatalogue";

export type OfficialNetwork = Pick<StudyDownloadOptions, "resolve" | "transport">;
const pageHosts = ["www.churchofjesuschrist.org"], audioHosts = ["assets.churchofjesuschrist.org", "media2.ldscdn.org"];
/** Alleen interne testinjectie; nooit URL, resolver of transport vanuit een beheerpayload. */
export async function downloadOfficial(url: string, signal: AbortSignal, options: OfficialNetwork = {}, file?: string, expectedBytes?: number, progress: (bytes: number) => Promise<void> = async () => {}) {
  const timeout = AbortSignal.timeout(120000), bounded = AbortSignal.any([signal, timeout]);
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    bounded.throwIfAborted();
    const target = studyDownloadUrl(current, file ? audioHosts : pageHosts);
    if (file && !target.pathname.endsWith(".mp3")) throw Error("SOURCE_URL");
    const addresses = await abortable((options.resolve ?? ((host) => lookup(host, { all: true, verbatim: true })))(target.hostname), bounded);
    if (!addresses.length || addresses.some((a) => !publicStudyAddress(a.address) || a.family !== isIP(a.address))) throw Error("SOURCE_ADDRESS");
    const response = await abortable((options.transport ?? studyHttpsTransport)(target, addresses[0], bounded), bounded);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      if ([301,302,303,307,308].includes(response.status)) {
        if (hop === 3 || typeof response.headers.location !== "string") throw Error("SOURCE_REDIRECT");
        current = new URL(response.headers.location, target).href; continue;
      }
      if (response.status !== 200) throw Error("SOURCE_HTTP");
      const limit = file ? expectedBytes! : 2 * 1024 * 1024;
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 256 * 1024 * 1024) throw Error("SOURCE_SIZE");
      const length = response.headers["content-length"];
      if (length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > limit || (file && Number(length) !== limit))) throw Error("SOURCE_SIZE");
      const mime = response.headers["content-type"];
      if (typeof mime !== "string" || !(file ? /^(audio\/|application\/octet-stream)/.test(mime) : /^application\/json/.test(mime))) throw Error("SOURCE_TYPE");
      if (file) handle = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      const chunks: Buffer[] = []; let size = 0, lastProgress = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      for (;;) {
        const step = await abortable(iterator.next(), bounded); if (step.done) break;
        const chunk = step.value;
        bounded.throwIfAborted(); size += chunk.length;
        if (size > limit) throw Error("SOURCE_SIZE");
        if (handle) await handle.writeFile(chunk); else chunks.push(chunk);
        if (Date.now() - lastProgress >= 1000) { await progress(size); lastProgress = Date.now(); }
      }
      bounded.throwIfAborted();
      if (!size || (file && size !== limit) || (length !== undefined && Number(length) !== size)) throw Error("SOURCE_SIZE");
      await handle?.sync(); await progress(size);
      return file ? Buffer.alloc(0) : Buffer.concat(chunks);
    } finally { response.close(); await handle?.close(); }
  }
  throw Error("SOURCE_REDIRECT");
}
interface HtmlNode { nodeName: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] }
function hasClass(node: HtmlNode, value: string) { return node.attrs?.some((a) => a.name === "class" && a.value.split(/\s+/).includes(value)); }
function text(node: HtmlNode): string { return (hasClass(node,"line") ? " " : "") + (node.nodeName === "#text" ? node.value ?? "" : (node.childNodes ?? []).map(text).join("")); }
const clean = (value: string) => value.replace(/\s+/g," ").trim();
export function validateOfficialPage(bytes: Buffer, source: OfficialSource) {
  const page = JSON.parse(bytes.toString("utf8"));
  const attrs = page.meta?.pageAttributes;
  if (attrs?.["data-bcp47-lang"] !== source.language || attrs?.["data-uri"] !== `/scriptures/${source.bookKey}/${source.chapterNumber}` || typeof page.content?.body !== "string") throw Error("SOURCE_IDENTITY");
  const verses: string[] = []; let heading: string | null = null;
  function visit(node: HtmlNode) {
    if (node.nodeName === "p" && hasClass(node,"verse")) verses.push(clean(text(node)).replace(/^\d+\s*/,""));
    if (node.nodeName === "p" && hasClass(node,"study-summary") && heading === null) heading = clean(text(node));
    (node.childNodes ?? []).forEach(visit);
  }
  visit(parseFragment(page.content.body) as unknown as HtmlNode);
  if (verses.length !== source.verses || objectHash({ heading, verses: verses.map((value, i) => ({ number: i+1, text: value })) }) !== source.sourceHash) throw Error("SOURCE_MISMATCH");
  if (!Array.isArray(page.meta.audio) || !page.meta.audio.some((r: { mediaUrl?: string; variant?: string }) => r.mediaUrl === source.url && r.variant === source.voice)) throw Error("SOURCE_AUDIO_IDENTITY");
}
