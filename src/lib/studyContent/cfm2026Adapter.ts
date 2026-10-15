/** Eén gepinde officiële Nederlandse adapter. Geen scraper of publicatieactie. */
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { createHash } from "node:crypto";
import { parseStudyDocument, type StudyDocument } from "./schema";
import { studyDocumentInventory, type SnapshotItem } from "./fixtureAdapter";
import { cfmOldTestament2026NlManifest as manifest } from "./cfm2026Manifest";
import { parseOtbPassage } from "@/lib/references/otb";
import { verifiedOfficialUrl } from "@/lib/references/evidence";
import otbIndex from "../../../data/study-content/cfm-2026-nl/otb-index.json";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Block = StudyDocument["sections"][number]["blocks"][number];
type Inline = Extract<Block, { type: "paragraph" }>["content"][number];
export interface CfmSource {
  uri: string;
  restricted: boolean;
  title: string;
  attributes: Record<string, string>;
  body: string;
}
export interface CfmMedia {
  url: string;
  checksum: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  file: string;
}
export const CFM_ADAPTER = "cfm-2026-nl-v1" as const;
export const CFM_RIGHTS = {
  holder: "The Church of Jesus Christ of Latter-day Saints",
  permission:
    "Volledig gebruik van officiële teksten en media door de Versado-eigenaar bevestigd; toestemming administratief buiten de repository bewaard.",
};
const bookCodes: Record<string, string> = {
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
export function cfmSourceUrl(href: string, lessonUrl: string) {
  const u = new URL(href, lessonUrl);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw Error("CFM_UNSAFE_URL");
  u.pathname = u.pathname.replace(/\.html$/, "");
  if (u.pathname.startsWith("/study/")) u.searchParams.set("lang", "nld");
  return u.href;
}
/** Originele URL bepaalt boek/hoofdstuk. Een label met een hoofdstukbereik mag
 * nooit stilzwijgend worden gereduceerd tot het eerste URL-hoofdstuk. */
export function cfmReferenceTarget(
  href: string,
  label: string,
  lessonUrl: string,
): Extract<Inline, { type: "reference" }>["target"] {
  const url = cfmSourceUrl(href, lessonUrl),
    u = new URL(url);
  const match = /^\/study\/scriptures\/ot\/([^/]+)\/(\d+)$/.exec(u.pathname);
  if (
    u.hostname === "www.churchofjesuschrist.org" &&
    match &&
    bookCodes[match[1]] &&
    !/\bBJS\b/i.test(label)
  ) {
    const book = bookCodes[match[1]],
      chapter = Number(match[2]);
    const identity = {
      workKey: "old-testament",
      editionKey: "otb",
      language: manifest.language,
      externalUrl: url,
    };
    if (
      parseOtbPassage(`${label} 1`)?.bookKey === book &&
      otbIndex.chapters.filter((c) => c.bookKey === book).length !== 1
    )
      return { ...identity, sourceKey: `otb:${book}` };
    if ((label.match(/:/g)?.length ?? 0) > 1) {
      const range = /([0-9]{1,3}:[0-9].*)$/.exec(label)?.[1] ?? label;
      return {
        ...identity,
        sourceKey: `otb:${book}:${range.replace(/\s/g, "")}`,
      };
    }
    const chapters = !label.includes(":")
      ? /(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/.exec(label)
      : null;
    if (chapters)
      return {
        ...identity,
        sourceKey: `otb:${book}:${chapters[1]}-${chapters[2]}`,
      };
    if (
      !label.includes(":") &&
      (label.match(/\d+/g)?.length ?? 0) > 1 &&
      !parseOtbPassage(label)
    )
      return { ...identity, sourceKey: `unverified-range:${url}` };
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
    if (uri) return { ...identity, sourceKey };
  }
  // Behoud de echte bron-URL. Alleen de bestaande centrale resolver mag een
  // reeds bewezen officiële externe fallback herkennen; geen host-wildcard.
  return { sourceKey: url, externalUrl: url };
}
export function parseCfmLesson(
  key: string,
  source: CfmSource,
  media: readonly CfmMedia[],
) {
  const found = manifest.lessons.find((l) => l.sourceKey === key);
  if (
    !found ||
    source.restricted ||
    source.attributes.lang !== "nld" ||
    source.attributes["data-uri"] !==
      `/manual/come-follow-me-for-home-and-church-old-testament-2026/${key}` ||
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
      target = cfmReferenceTarget(href, label, lesson.sourceUrl);
    if (
      !parseOtbPassage(target.sourceKey) &&
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
    const url = cfmSourceUrl(attr(n, "src")!, lesson.sourceUrl),
      metadata = media.find((m) => m.url === url);
    if (!metadata) throw Error(`CFM_MEDIA_MISSING:${url}`);
    const anchor = id("img", n, scope),
      mediaKey = `media-${anchor}`;
    assets.push({ ...metadata, mediaKey });
    const alt = attr(n, "alt") || attr(n, "data-public-title");
    if (!alt?.trim())
      diagnostics.push({ anchor, code: "MISSING_SOURCE_ALT", target: url });
    blocks.push({
      type: "figure",
      id: anchor,
      mediaKey,
      alt: alt ?? "",
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
        label || cfmSourceUrl(attr(n, "href")!, lesson.sourceUrl);
      const anchor = id("ref", n, scope),
        target = cfmReferenceTarget(
          attr(n, "href")!,
          safeLabel,
          lesson.sourceUrl,
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
      const video = children(n).find(
        (c) =>
          element(c) &&
          c.tagName === "source" &&
          attr(c, "type") === "video/mp4",
      );
      if (!video || !element(video)) throw Error("CFM_VIDEO_SOURCE");
      const anchor = id("video", n, scope),
        url = attr(video, "src")!;
      // Bewaar de werkelijk aangeboden media-URL; geen speler of verzonnen resource-link.
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.hostname !== "assets.churchofjesuschrist.org"
      )
        throw Error("CFM_VIDEO_URL");
      blocks.push({
        type: "reference",
        id: anchor,
        label: attr(n, "data-video-title") ?? source.title,
        target: { sourceKey: url, externalUrl: url },
      });
      diagnostics.push({ anchor, code: "VIDEO_EXTERNAL_REVIEW", target: url });
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
                !["paragraph", "figure", "reference", "list"].includes(b.type),
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
  const { lesson, document, assets, inventory } = parsed;
  return {
    schemaVersion: 1,
    title: parsed.title,
    body: document,
    sourceKey: lesson.sourceKey,
    slug: `cfm-2026-${lesson.sourceKey}`,
    order: lesson.order,
    sourceMetadata: {
      sourceKey: lesson.sourceKey,
      name: "Kom dan en volg Mij 2026 — Oude Testament",
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
