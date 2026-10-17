import {
  normalizeAnnotationText,
  passageBlocks,
  validatePassageSelector,
  type PassageSelector,
} from "./contract";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";

function boundary(raw: string, utf16: number): number {
  if (
    utf16 > 0 &&
    /[\uD800-\uDBFF]/u.test(raw[utf16 - 1]) &&
    /[\uDC00-\uDFFF]/u.test(raw[utf16] ?? "")
  )
    throw Error("SELECTION");
  const full = normalizeAnnotationText(raw);
  let prefix = raw
    .slice(0, utf16)
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trimStart();
  if (!full.startsWith(prefix) && prefix.trimEnd() === full) prefix = full;
  if (!full.startsWith(prefix)) throw Error("SELECTION"); // Geen grens midden in een NFC-compositie.
  return [...prefix].length;
}
function anchor(node: Node) {
  return (
    node instanceof Element ? node : node.parentElement
  )?.closest<HTMLElement>("[data-study-text]");
}
export function blockSelector(
  document: ReaderDocument,
  revisionId: string,
  sectionAnchor: string,
  blockId: string,
): PassageSelector {
  const block = passageBlocks(document, sectionAnchor).find(
    (b) => b.id === blockId,
  );
  if (!block) throw Error("SELECTION");
  return validatePassageSelector(document, {
    normalizationVersion: 1,
    originalRevisionId: revisionId,
    sectionAnchor,
    ranges: [{ blockId, start: 0, end: [...block.text].length }],
    exact: block.text,
    prefix: "",
    suffix: "",
  });
}
export function selectionToSelector(
  root: HTMLElement,
  document: ReaderDocument,
  revisionId: string,
  range: Range,
): PassageSelector {
  if (range.collapsed) throw Error("SELECTION");
  const first = anchor(range.startContainer),
    last = anchor(range.endContainer);
  const section = first?.closest<HTMLElement>("[data-study-section]");
  if (
    !first ||
    !last ||
    !section ||
    !root.contains(first) ||
    !root.contains(last) ||
    section !== last.closest("[data-study-section]")
  )
    throw Error("SELECTION");
  const sectionAnchor = section.dataset.studySection!,
    blocks = passageBlocks(document, sectionAnchor);
  const ranges: PassageSelector["ranges"] = [],
    pieces: string[] = [];
  for (const element of section.querySelectorAll<HTMLElement>(
    "[data-study-text]",
  )) {
    if (!range.intersectsNode(element)) continue;
    const id = element.dataset.studyText!,
      expected = blocks.find((b) => b.id === id);
    if (
      !expected ||
      section.querySelectorAll(`[data-study-text="${CSS.escape(id)}"]`)
        .length !== 1 ||
      normalizeAnnotationText(element.textContent ?? "") !== expected.text
    )
      throw Error("SELECTION");
    const part = element.ownerDocument.createRange();
    part.selectNodeContents(element);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
      part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
      part.setEnd(range.endContainer, range.endOffset);
    const prefix = element.ownerDocument.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(part.startContainer, part.startOffset);
    const end = prefix.toString().length + part.toString().length;
    const startOffset = boundary(
        element.textContent ?? "",
        prefix.toString().length,
      ),
      endOffset = boundary(element.textContent ?? "", end);
    if (startOffset === endOffset) continue;
    ranges.push({ blockId: id, start: startOffset, end: endOffset });
    pieces.push([...expected.text].slice(startOffset, endOffset).join(""));
  }
  if (!ranges.length) throw Error("SELECTION");
  const start = ranges[0],
    end = ranges.at(-1)!,
    a = blocks.find((b) => b.id === start.blockId)!,
    b = blocks.find((b) => b.id === end.blockId)!;
  return validatePassageSelector(document, {
    normalizationVersion: 1,
    originalRevisionId: revisionId,
    sectionAnchor,
    ranges,
    exact: pieces.join("\n"),
    prefix: [...a.text]
      .slice(Math.max(0, start.start - 32), start.start)
      .join(""),
    suffix: [...b.text].slice(end.end, end.end + 32).join(""),
  });
}
/** CSS Highlights laten de DOM en de native selectie volledig intact. */
export function selectorRanges(
  root: HTMLElement,
  selector: PassageSelector,
): Range[] {
  return selector.ranges.map((selected) => {
    const element = root.querySelector<HTMLElement>(
      `[data-study-section="${CSS.escape(selector.sectionAnchor)}"] [data-study-text="${CSS.escape(selected.blockId)}"]`,
    );
    if (!element) throw Error("SELECTION");
    const raw = element.textContent ?? "",
      points = new Map<number, number>();
    // Eén lineaire grapheemwandeling; geen normalisatie van iedere tekstprefix.
    let count = 0,
      whitespace = false;
    for (const segment of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(raw)) {
      const normalized = segment.segment.normalize("NFC");
      if (/^\s+$/u.test(normalized)) {
        if (count > 0 && !whitespace) {
          points.set(count, segment.index);
          count++;
          whitespace = true;
        }
      } else {
        points.set(count, segment.index);
        if (normalized === segment.segment) {
          let offset = segment.index,
            n = count;
          for (const char of normalized) {
            points.set(n, offset);
            n++;
            offset += char.length;
            points.set(n, offset);
          }
        }
        count += [...normalized].length;
        points.set(count, segment.index + segment.segment.length);
        whitespace = false;
      }
    }
    // De laatste witruimte hoort niet bij de genormaliseerde tekst.
    if (whitespace) count--;
    if (count !== [...normalizeAnnotationText(raw)].length)
      throw Error("SELECTION");
    function locate(offset: number): [Node, number] {
      let remaining = points.get(offset);
      if (remaining === undefined) throw Error("SELECTION");
      const walker = document.createTreeWalker(element!, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (remaining <= node.textContent!.length) return [node, remaining];
        remaining -= node.textContent!.length;
      }
      throw Error("SELECTION");
    }
    const range = document.createRange();
    range.setStart(...locate(selected.start));
    range.setEnd(...locate(selected.end));
    return range;
  });
}
