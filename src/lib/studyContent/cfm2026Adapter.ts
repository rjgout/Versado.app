/** Eén gepinde officiële Nederlandse adapter. Geen scraper of publicatieactie. */
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { createHash } from "node:crypto";
import { parseStudyDocument, type StudyDocument } from "./schema";
import { studyDocumentInventory, type SnapshotItem } from "./fixtureAdapter";
import {
  parseOtbPassage,
  parseOtbPassageSet,
  type OtbPassage,
} from "@/lib/references/otb";
import { verifiedOfficialUrl } from "@/lib/references/evidence";
import { passageKey } from "./cfmScripture";
import { CFM_VIDEO_HOSTS } from "./cfmReferencePolicy";
import { CFM_SOURCE_2026, type CfmMedia, type CfmSource, type CfmVolumeSource } from "./cfmSources";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Block = StudyDocument["sections"][number]["blocks"][number];
type Inline = Extract<Block, { type: "paragraph" }>["content"][number];
export type { CfmMedia, CfmSource };
export const CFM_ADAPTER = "cfm-2026-nl-v1" as const;
export const CFM_RIGHTS = {
  holder: "The Church of Jesus Christ of Latter-day Saints",
  permission:
    "Volledig gebruik van officiële teksten en media door de Versado-eigenaar bevestigd; toestemming administratief buiten de repository bewaard.",
};
function element(n: Node): n is Element {
  return "tagName" in n;
}
function children(n: Node): Node[] {
  return "childNodes" in n ? n.childNodes : [];
}
function attr(n: Element, name: string) {
  return n.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase())
    ?.value;
}
function plain(n: Node): string {
  return "value" in n ? n.value : children(n).map(plain).join("");
}
function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}
function descendants(n: Node, tag: string): Element[] {
  return children(n).flatMap((c) =>
    element(c) && c.tagName === tag ? [c] : descendants(c, tag),
  );
}
export function cfmSourceHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
export function cfmSourceUrl(href: string, lessonUrl: string, churchLang = "nld") {
  const u = new URL(href, lessonUrl);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw Error("CFM_UNSAFE_URL");
  u.pathname = u.pathname.replace(/\.html$/, "");
  if (u.pathname.startsWith("/study/")) u.searchParams.set("lang", churchLang);
  return u.href;
}
/** Originele URL bepaalt boek/hoofdstuk. Een label met een hoofdstukbereik mag
 * nooit stilzwijgend worden gereduceerd tot het eerste URL-hoofdstuk. */
export function cfmReferenceTarget(
  href: string,
  label: string,
  lessonUrl: string,
  volume: CfmVolumeSource = CFM_SOURCE_2026,
): Extract<Inline, { type: "reference" }>["target"] {
  const url = cfmSourceUrl(href, lessonUrl, volume.churchLang),
    u = new URL(url);
  // Zonder schriftuurprofiel (bv. Nieuwe Testament) leggen we nooit een interne link: de bron-URL blijft de enige identiteit.
  const profile = volume.scripture;
  const match = profile ? new RegExp(`^/study/scriptures/${profile.pathSegment}/([^/]+)/(\\d+)$`).exec(u.pathname) : null;
  if (
    profile &&
    u.hostname === "www.churchofjesuschrist.org" &&
    match &&
    profile.bookCodes[match[1]] &&
    !/\bBJS\b/i.test(label)
  ) {
    const otbIndex = profile.index;
    const book = profile.bookCodes[match[1]],
      chapter = Number(match[2]);
    const identity = {
      workKey: profile.workKey,
      editionKey: profile.editionKey,
      language: volume.manifest.language,
      externalUrl: url,
    };
    const uriKey = `otb:${book}:${chapter}${
      u.searchParams.get("id")
        ? ":" +
          u.searchParams
            .get("id")!
            .split(",")
            .map((v) => v.replace(/^p/, "").replace(/-p/g, "-"))
            .join(",")
        : ""
    }`;
    const uriPassage = parseOtbPassage(uriKey);
    const numbered = (p: OtbPassage | null) =>
      p &&
      (!uriPassage?.verses ||
        JSON.stringify(p.verses) === JSON.stringify(uriPassage.verses));
    if (
      /^ver(?:s|zen)\s+/i.test(label) ||
      (u.searchParams.has("id") && /^[0-9, –-]+$/.test(label))
    ) {
      const p = parseOtbPassage(
        `otb:${book}:${chapter}:${label.replace(/^ver(?:s|zen)\s+/i, "").replace(/\s+en\s+/gi, ",")}`,
      );
      const key = numbered(p) && p ? passageKey([p]) : null;
      return { ...identity, sourceKey: key ?? `unverified-numbering:${url}` };
    }
    if (parseOtbPassage(`${label} 1`)?.bookKey === book) {
      const key = passageKey(
        otbIndex.chapters
          .filter((c) => c.bookKey === book)
          .map((c) => ({ bookKey: book, chapter: c.chapter, verses: null })),
      );
      return { ...identity, sourceKey: key ?? `otb:${book}` };
    }
    const cross =
      /^(.*?)\s*(\d{1,3}):(\d{1,3})\s*[-–]\s*(\d{1,3}):(\d{1,3})$/.exec(label);
    if (cross) {
      const [, name, fc, fv, tc, tv] = cross,
        first = Number(fc),
        last = Number(tc);
      if (
        first === chapter &&
        last >= first &&
        last - first < 40 &&
        (!name.trim() ||
          parseOtbPassage(`${name} ${first}`)?.bookKey === book) &&
        (!uriPassage?.verses || uriPassage.verses[0] === Number(fv))
      ) {
        const parts: OtbPassage[] = [];
        for (let c = first; c <= last; c++) {
          const row = otbIndex.chapters.find(
            (r) => r.bookKey === book && r.chapter === c,
          );
          if (!row) break;
          parts.push({
            bookKey: book,
            chapter: c,
            verses: row.verses.filter(
              (v) =>
                (c !== first || v >= Number(fv)) &&
                (c !== last || v <= Number(tv)),
            ),
          });
        }
        if (
          parts.length === last - first + 1 &&
          parts[0].verses?.[0] === Number(fv) &&
          parts.at(-1)?.verses?.at(-1) === Number(tv)
        ) {
          const key = passageKey(parts);
          if (key) return { ...identity, sourceKey: key };
        }
      }
      return { ...identity, sourceKey: `unverified-range:${url}` };
    }
    const chapters = !label.includes(":")
      ? /^(.*?)\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/.exec(label)
      : null;
    if (chapters) {
      const [, name, fc, tc] = chapters,
        first = Number(fc),
        last = Number(tc);
      const local = /^(hoofdstuk(?:ken)?|)$/i.test(name.trim());
      if (
        first === chapter &&
        last >= first &&
        last - first < 40 &&
        (local || parseOtbPassage(`${name} ${first}`)?.bookKey === book)
      ) {
        const key = passageKey(
          Array.from({ length: last - first + 1 }, (_, i) => ({
            bookKey: book,
            chapter: first + i,
            verses: null,
          })),
        );
        if (key) return { ...identity, sourceKey: key };
      }
      return { ...identity, sourceKey: `unverified-range:${url}` };
    }
    const ids = u.searchParams.get("id");
    const verses = ids
      ?.split(",")
      .map((part) => part.replace(/^p/, "").replace(/-p/g, "-"))
      .join(",");
    let sourceKey = `otb:${book}:${chapter}${verses ? `:${verses}` : ""}`;
    const uri = parseOtbPassage(sourceKey);
    const printed =
      parseOtbPassage(label) ??
      (label.includes(":") ? parseOtbPassage(`${book} ${label}`) : null);
    if (uri && printed) {
      // Nummeringsverschillen zijn geen toestemming om een offset te raden.
      // Een URL zonder versselectie kan wel een preciezer gedrukt bereik bevatten.
      if (
        printed.bookKey !== book ||
        printed.chapter !== chapter ||
        (uri.verses !== null &&
          JSON.stringify(uri.verses) !== JSON.stringify(printed.verses))
      )
        return { ...identity, sourceKey: `unverified-numbering:${url}` };
      if (uri.verses === null && printed.verses !== null)
        sourceKey = `otb:${book}:${chapter}:${printed.verses.join(",")}`;
    }
    if (uri) {
      const selected = parseOtbPassage(sourceKey);
      return {
        ...identity,
        sourceKey: selected
          ? (passageKey([selected]) ?? sourceKey)
          : `unverified-range:${url}`,
      };
    }
  }
  // Behoud de echte bron-URL. Alleen de bestaande centrale resolver mag een
  // reeds bewezen officiële externe fallback herkennen; geen host-wildcard.
  return { sourceKey: url, externalUrl: url };
}
export function parseCfmLesson(
  key: string,
  source: CfmSource,
  media: readonly CfmMedia[],
  volume: CfmVolumeSource = CFM_SOURCE_2026,
) {
  const found = volume.manifest.lessons.find((l) => l.sourceKey === key);
  if (
    !found ||
    source.restricted ||
    source.attributes.lang !== volume.churchLang ||
    source.attributes["data-uri"] !== `/manual/${volume.manualSlug}/${key}` ||
    !source.body ||
    !source.title
  )
    throw Error("CFM_SOURCE_IDENTITY");
  const lesson = found;
  const root = parseFragment(source.body);
  let blocks: Block[] = [];
  const assets: Array<CfmMedia & { mediaKey: string }> = [],
    diagnostics: Array<{ anchor: string; code: string; target?: string }> = [];
  const used = new Set<string>();
  function id(prefix: string, n: Element, fallback: string) {
    const inherited = ["ul", "ol", "table"].includes(n.tagName)
      ? descendants(n, "p")
          .map((p) => attr(p, "id"))
          .find(Boolean)
      : undefined;
    const base = `${prefix}-${attr(n, "id") ?? inherited ?? fallback}`
      .replace(/[^A-Za-z0-9._:-]/g, "-")
      .slice(0, 120);
    if (used.has(base)) throw Error(`CFM_DUPLICATE_ANCHOR:${key}:${base}`);
    used.add(base);
    return base;
  }
  function refs(n: Element, scope: string): Inline {
    const label = clean(plain(n)),
      href = attr(n, "href") ?? attr(n, "data-legacy-href");
    if (!label || !href) throw Error("CFM_REFERENCE_EMPTY");
    const anchor = id("ref", n, scope),
      target = cfmReferenceTarget(href, label, lesson.sourceUrl, volume);
    if (
      !parseOtbPassage(target.sourceKey) &&
      !parseOtbPassageSet(target.sourceKey) &&
      !verifiedOfficialUrl(target.sourceKey)
    )
      diagnostics.push({
        anchor,
        code: target.sourceKey.startsWith("otb:")
          ? "MULTI_CHAPTER"
          : "UNSUPPORTED_TARGET",
        target: target.externalUrl,
      });
    return { type: "reference", id: anchor, label, target };
  }
  function inline(
    n: Node,
    scope: string,
    marks: Array<"strong" | "emphasis"> = [],
  ): Inline[] {
    if ("value" in n)
      return n.value
        ? [
            {
              type: "text",
              text: n.value.trim() ? n.value : " ",
              ...(marks.length ? { marks } : {}),
            },
          ]
        : [];
    if (!element(n)) return [];
    if (n.tagName === "img") {
      image(n, scope);
      return [];
    }
    if (n.tagName === "figure") {
      visit(n, scope);
      return [];
    }
    if (n.tagName === "a" || attr(n, "data-legacy-href"))
      return [refs(n, scope)];
    if (["strong", "em", "i", "cite"].includes(n.tagName))
      marks = [
        ...new Set([...marks, n.tagName === "strong" ? "strong" : "emphasis"]),
      ] as typeof marks;
    if (
      ![
        "div",
        "p",
        "span",
        "strong",
        "em",
        "i",
        "cite",
        "li",
        "figcaption",
        "header",
        "td",
        "th",
      ].includes(n.tagName)
    )
      throw Error(`CFM_UNKNOWN_INLINE:${n.tagName}`);
    return children(n).flatMap((c, i) => inline(c, `${scope}-${i}`, marks));
  }
  function content(n: Element, scope: string) {
    return children(n).flatMap((c, i) => inline(c, `${scope}-${i}`));
  }
  function image(n: Element, scope: string, caption?: Inline[]) {
    const url = cfmSourceUrl(attr(n, "src")!, lesson.sourceUrl, volume.churchLang),
      metadata = media.find((m) => m.url === url);
    if (!metadata) throw Error(`CFM_MEDIA_MISSING:${url}`);
    const anchor = id("img", n, scope),
      mediaKey = `media-${anchor}`;
    assets.push({ ...metadata, mediaKey });
    // Handmatig bekeken op de gepinde checksum: informatiebanner met zichtbare tekst.
    const alt =
      attr(n, "alt") ||
      attr(n, "data-public-title") ||
      (metadata.checksum ===
      "9e9f60cd6b12ef4b069d6ae3eb07829bd8736aacd6ab5c869f60dce192b1e88c"
        ? "Meer voor onderwijs aan kinderen — Nu bekijken."
        : undefined);
    if (!alt?.trim())
      diagnostics.push({ anchor, code: "MISSING_SOURCE_ALT", target: url });
    blocks.push({
      type: "figure",
      id: anchor,
      mediaKey,
      // De officiële bron geeft sommige (decoratieve) afbeeldingen geen beschrijving. We verzinnen er geen inhoud bij: een
      // neutrale, eerlijke aanduiding houdt de les toegankelijk en publiceerbaar; het ontbreken staat in de diagnostiek.
      alt: alt?.trim() ? alt : `Illustratie bij ${lesson.title}`,
      width: metadata.width,
      height: metadata.height,
      ...(caption?.length ? { caption } : {}),
    });
  }
  function visit(n: Node, scope: string) {
    if (!element(n)) {
      if ("value" in n && n.value.trim())
        throw Error(`CFM_UNWRAPPED_TEXT:${scope}`);
      return;
    }
    if (n.tagName === "img") {
      image(n, scope);
      return;
    }
    if (n.tagName === "a") {
      for (const img of descendants(n, "img")) image(img, `${scope}-linked`);
      const label =
        clean(plain(n)) ||
        descendants(n, "img")
          .map((img) => attr(img, "alt"))
          .filter(Boolean)
          .join(" ");
      const safeLabel =
        label || cfmSourceUrl(attr(n, "href")!, lesson.sourceUrl, volume.churchLang);
      const anchor = id("ref", n, scope),
        target = cfmReferenceTarget(
          attr(n, "href")!,
          safeLabel,
          lesson.sourceUrl,
          volume,
        );
      blocks.push({ type: "reference", id: anchor, label: safeLabel, target });
      return;
    }
    if (n.tagName === "video") {
      const poster = attr(n, "poster");
      if (poster)
        image(
          {
            ...n,
            tagName: "img",
            attrs: [
              { name: "src", value: poster },
              {
                name: "alt",
                value: attr(n, "data-video-title") ?? source.title,
              },
            ],
          },
          `${scope}-poster`,
        );
      // Alleen officiële MP4-bronnen van exact toegestane hosts worden een ingebedde video (schema.ts: studyVideoUrlSchema); de
      // HLS-stroom (m3u8) en alle andere bronnen worden genegeerd. Geen iframe en geen willekeurige URL.
      const mp4 = children(n).filter((c): c is Element => element(c) && c.tagName === "source" && attr(c, "type") === "video/mp4");
      if (!mp4.length) throw Error("CFM_VIDEO_SOURCE");
      const anchor = id("video", n, scope);
      const sources = mp4.map((c) => {
        const u = new URL(attr(c, "src")!);
        if (u.protocol !== "https:" || u.username || u.password || u.port || !CFM_VIDEO_HOSTS.includes(u.hostname))
          throw Error("CFM_VIDEO_URL");
        return { url: u.href, width: Number(attr(c, "data-width")) || 1280, height: Number(attr(c, "data-height")) || 720 };
      });
      // Eén standaardbron: de kleinste bron van minstens 1280 pixels breed (720p: scherp genoeg, niet onnodig zwaar), anders de grootste.
      const sorted = [...sources].sort((x, y) => x.width - y.width);
      const preferred = sorted.find((x) => x.width >= 1280) ?? sorted.at(-1)!;
      const ordered = [preferred, ...sorted.filter((x) => x !== preferred)].slice(0, 4);
      const description = clean(attr(n, "data-video-description") ?? "");
      blocks.push({
        type: "video",
        id: anchor,
        title: attr(n, "data-video-title") ?? source.title,
        ...(description && !/<\/?[a-z][^>]*>/i.test(description) ? { description } : {}),
        sources: ordered,
        externalUrl: preferred.url,
      } as Block);
      diagnostics.push({ anchor, code: "VIDEO_EMBEDDED", target: preferred.url });
      return;
    }
    if (
      n.tagName === "figure" &&
      descendants(n, "img").length === 1 &&
      !descendants(n, "video").length
    ) {
      const img = descendants(n, "img")[0],
        cap = descendants(n, "figcaption")[0];
      if (cap) {
        image(img, scope, content(cap, `${scope}-caption`));
        // Een tekstlink naast de afbeelding in dezelfde figure (bv. "PDF openen") hoort bij de bron en mag niet verloren gaan.
        for (const [i, link] of children(n).entries())
          if (element(link) && link.tagName === "a" && !descendants(link, "img").length) visit(link, `${scope}-link${i}`);
        return;
      }
    }
    if (
      /^h[1-6]$/.test(n.tagName) ||
      n.tagName === "p" ||
      n.tagName === "span"
    ) {
      const anchor = id("b", n, scope),
        parts = content(n, anchor);
      if (parts.length)
        blocks.push(
          /^h/.test(n.tagName)
            ? {
                type: "heading",
                id: anchor,
                level: Math.max(2, Number(n.tagName[1])),
                content: parts,
              }
            : { type: "paragraph", id: anchor, content: parts },
        );
      return;
    }
    if (n.tagName === "ul" || n.tagName === "ol") {
      const anchor = id("list", n, scope);
      const items = children(n)
        .filter(element)
        .map((li, i) => {
          if (li.tagName !== "li") throw Error("CFM_LIST");
          const outer = blocks;
          blocks = [];
          children(li).forEach((child, j) =>
            visit(child, `${anchor}-${i}-${j}`),
          );
          const captured = blocks;
          blocks = outer;
          if (
            captured.some(
              (b) =>
                !["paragraph", "figure", "reference", "video", "list"].includes(b.type),
            )
          )
            throw Error("CFM_LIST_STRUCTURE");
          const first = captured[0];
          const content =
            first?.type === "paragraph"
              ? first.content
              : [{ type: "text" as const, text: " " }];
          const rest =
            first?.type === "paragraph" ? captured.slice(1) : captured;
          return {
            id: id(
              "item",
              li,
              attr(descendants(li, "p")[0] ?? li, "id") ?? `${anchor}-${i}`,
            ),
            content,
            ...(rest.length ? { blocks: rest } : {}),
          };
        });
      blocks.push({
        type: "list",
        id: anchor,
        ordered: n.tagName === "ol",
        items,
      } as Block);
      return;
    }
    if (n.tagName === "table") {
      const anchor = id("table", n, scope);
      const rows = descendants(n, "tr").map((row, i) => ({
        id: `${anchor}-r${i}`,
        cells: children(row)
          .filter(element)
          .map((cell, j) => {
            if (!["td", "th"].includes(cell.tagName)) throw Error("CFM_TABLE");
            const cellId = `${anchor}-r${i}-c${j}`;
            return {
              id: cellId,
              header: cell.tagName === "th",
              content: content(cell, cellId),
              colSpan: Number(attr(cell, "colspan") ?? 1),
              rowSpan: Number(attr(cell, "rowspan") ?? 1),
            };
          }),
      }));
      blocks.push({ type: "table", id: anchor, rows });
      return;
    }
    if (
      !["header", "section", "div", "figure", "figcaption"].includes(n.tagName)
    )
      throw Error(`CFM_UNKNOWN_BLOCK:${n.tagName}`);
    children(n).forEach((c, i) => visit(c, `${scope}-${i}`));
  }
  children(root).forEach((n, i) => visit(n, `source-${i}`));
  const document = parseStudyDocument({
      schemaVersion: 1,
      sections: [{ id: `lesson-${key}`, blocks }],
    }),
    inventory = studyDocumentInventory(document);
  // Aantoonbare tekstvolledigheid, inclusief verwijzingslabels en opdrachten.
  const sourceText = clean(plain(root));
  function rendered(v: unknown): string {
    if (!v || typeof v !== "object") return "";
    if (Array.isArray(v)) return v.map(rendered).join("");
    const r = v as Record<string, unknown>;
    if (r.type === "text") return String(r.text);
    if (r.type === "reference") return String(r.label);
    return [
      r.sections,
      r.content,
      r.items,
      r.children,
      r.caption,
      r.rows,
      r.cells,
      r.blocks,
    ]
      .map(rendered)
      .join("");
  }
  const documentText = clean(rendered(document));
  // Videotitels zijn bronattributen; een figcaption bevat dezelfde titel en
  // blijft bovendien als gewone bronalinea bewaard. Vergelijk tokenvolgorde.

  const sourceCharacters = [...sourceText.replace(/\s/g, "")],
    resultCharacters = documentText.replace(/\s/g, "");
  let cursor = 0;
  for (const character of sourceCharacters) {
    cursor = resultCharacters.indexOf(character, cursor);
    if (cursor < 0) throw Error(`CFM_TEXT_LOSS:${key}:${character}`);
    cursor++;
  }
  return {
    lesson,
    volume,
    title: source.title,
    document,
    assets,
    diagnostics,
    inventory,
    sourceText,
    documentText,
  };
}
export function cfmSnapshotItem(
  parsed: ReturnType<typeof parseCfmLesson>,
  bytes: (asset: CfmMedia) => Buffer,
): SnapshotItem {
  const { lesson, volume, document, assets, inventory } = parsed;
  return {
    schemaVersion: 1,
    title: parsed.title,
    body: document,
    sourceKey: lesson.sourceKey,
    slug: `cfm-${volume.volume.year}-${lesson.sourceKey}`,
    order: lesson.order,
    sourceMetadata: {
      sourceKey: lesson.sourceKey,
      name: volume.collectionName,
      url: lesson.sourceUrl,
    },
    rightsMetadata: CFM_RIGHTS,
    media: assets
      .map((a) => ({
        ...a,
        base64: bytes(a).toString("base64"),
        sourceKey: a.url,
        rights: CFM_RIGHTS,
      }))
      .map(({ mediaKey, base64, mimeType, checksum, sourceKey, rights }) => ({
        mediaKey,
        base64,
        mimeType,
        checksum,
        sourceKey,
        rights,
      })),
    expectedAnchors: inventory.anchors,
    expectedMedia: assets.map((a) => a.mediaKey),
    expectedReferences: inventory.references.map((r) => r.occurrenceKey),
    evidence: [],
  };
}
