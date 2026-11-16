import { passageBlocks, normalizeAnnotationText, validatePassageSelector } from "@/lib/annotations/contract";
import { richLessonBody } from "../fixtures/rijkeles";
import { buildItems, buildRunLayout, marksByBlock, normalizedRangeToRaw, rangesToLessonSelector, segments, selectionToRanges, type TextUnit } from "../src/study/runModel";

const doc = richLessonBody();
const SECTION = "section-main";
const items = buildItems(doc, SECTION);
const units = (): TextUnit[] => items.flatMap(i => i.type === "run" ? i.units : i.type === "table" ? i.rows.flatMap(r => r.cells.map(c => c.unit)) : []);
const run = (id: string) => items.find(i => i.type === "run" && i.units.some(u => u.id === id)) as Extract<(typeof items)[number], { type: "run" }>;

test("elk blok van het document komt in dezelfde volgorde en met dezelfde genormaliseerde tekst terug als in het contract (passageBlocks)", () => {
  const contract = passageBlocks(doc, SECTION);
  // Tafelcellen en bijschriften staan als eenheid in een item; de volgorde is die van het contract.
  const mine = units().map(u => ({ id: u.id, text: normalizeAnnotationText(u.raw) }));
  expect(mine).toEqual(contract);
});

test("aaneengesloten tekstblokken zijn één run; figuur, tabel en streep onderbreken; een bijschrift is eigen selecteerbare tekst", () => {
  const kinds = items.map(i => i.type);
  expect(kinds).toContain("figure"); expect(kinds).toContain("table"); expect(kinds).toContain("divider");
  const caption = items.find(i => i.type === "run" && i.key.endsWith(":caption"));
  expect(caption).toBeTruthy();
  const first = items[0]!;
  expect(first.type).toBe("run");
  // titel, intro, spaties, onderwerp, twee alinea's vormen samen één run
  expect((first as { units: TextUnit[] }).units.map(u => u.id)).toEqual(["b-title1", "b-intro", "b-spaces", "b-topic1", "b-p1", "b-p2"]);
});

test("de weergegeven string bestaat uit voorvoegsel + ruwe tekst per blok, gescheiden door een lege regel (opsomming: één regeleinde)", () => {
  const r = run("b-p1"), layout = buildRunLayout(r.units);
  for (const span of layout.spans) expect(layout.text.slice(span.start, span.end)).toBe(span.unit.raw);
  const list = buildRunLayout(run("li-1").units);
  const li1 = list.spans.find(s => s.unit.id === "li-1")!, li2 = list.spans.find(s => s.unit.id === "li-2")!;
  expect(list.text.slice(li1.end, li2.start - 2)).toBe("\n");
  expect(list.text.slice(li1.start - 2, li1.start)).toBe("• ");
});

test("een woord selecteren geeft één bereik dat de bestaande selectorvalidatie doorstaat", () => {
  const layout = buildRunLayout(run("b-p1").units), span = layout.spans.find(s => s.unit.id === "b-p1")!;
  const word = "Eerste", a = span.start + span.unit.raw.indexOf(word);
  const ranges = selectionToRanges(layout, a, a + word.length);
  expect(ranges).toHaveLength(1);
  expect(ranges[0]).toMatchObject({ blockId: "b-p1", start: 0, end: 6, exact: "Eerste" });
  expect(() => rangesToLessonSelector(doc, SECTION, "rev1", ranges)).not.toThrow();
});

test("tekst over meerdere blokken (kop → alinea's) geeft meerdere bereiken in documentvolgorde, één geldige selector", () => {
  const layout = buildRunLayout(run("b-p1").units);
  const from = layout.spans.find(s => s.unit.id === "b-topic1")!.start + 4;
  const to = layout.spans.find(s => s.unit.id === "b-p2")!.start + 6;
  const ranges = selectionToRanges(layout, from, to);
  expect(ranges.map(r => r.blockId)).toEqual(["b-topic1", "b-p1", "b-p2"]);
  const selector = rangesToLessonSelector(doc, SECTION, "rev1", ranges);
  expect(selector.ranges).toHaveLength(3);
  expect(validatePassageSelector(doc, selector)).toEqual(selector);
});

test("emoji (surrogaatpaar), diakrieten en dubbele spatie/tab: offsets blijven kloppen en een grens midden in een paar schuift naar buiten", () => {
  const layout = buildRunLayout(run("b-intro").units), span = layout.spans.find(s => s.unit.id === "b-intro")!;
  const emoji = span.unit.raw.indexOf("😊");
  // Selectie die halverwege het surrogaatpaar eindigt: het hele teken wordt meegenomen.
  const r = selectionToRanges(layout, span.start + emoji - 3, span.start + emoji + 1);
  expect(r).toHaveLength(1);
  expect(() => rangesToLessonSelector(doc, SECTION, "rev1", r)).not.toThrow();
  expect(r[0]!.exact.endsWith("😊")).toBe(true);
  const sp = buildRunLayout(run("b-spaces").units), s2 = sp.spans.find(s => s.unit.id === "b-spaces")!;
  const word = selectionToRanges(sp, s2.start + s2.unit.raw.indexOf("tab"), s2.start + s2.unit.raw.indexOf("tab") + 3);
  expect(word[0]!.exact).toBe("tab");
  expect(() => rangesToLessonSelector(doc, SECTION, "rev1", word)).not.toThrow();
});

test("selectie → selector → (door de server geplaatst) → weer UTF-16-bereik is een rondgang zonder verschuiving", () => {
  const layout = buildRunLayout(run("b-intro").units), span = layout.spans.find(s => s.unit.id === "b-intro")!;
  for (const [a, b] of [[0, 5], [10, 30], [span.unit.raw.length - 10, span.unit.raw.length]] as const) {
    const ranges = selectionToRanges(layout, span.start + a, span.start + b);
    const back = normalizedRangeToRaw(span.unit.raw, ranges[0]!.start, ranges[0]!.end)!;
    expect(span.unit.raw.slice(back.from, back.to)).toBe(span.unit.raw.slice(ranges[0]!.from, ranges[0]!.to));
  }
});

test("markeringen en opmaak: de segmenten samen zijn exact de brontekst en markeringen liggen op het goede bereik", () => {
  const u = units().find(x => x.id === "b-intro")!;
  const sel = rangesToLessonSelector(doc, SECTION, "rev1", [{ blockId: "b-intro", from: 5, to: 20, start: 5, end: 20, exact: normalizeAnnotationText(u.raw).slice(5, 20) }]);
  const marks = marksByBlock([u], [{ kind: "highlight", deleted: false, color: "yellow", placement: { status: "EXACT", selector: sel } }, { kind: "note", deleted: false, placement: { status: "EXACT", selector: sel } }, { kind: "highlight", deleted: true, color: "green", placement: { status: "EXACT", selector: sel } }, { kind: "highlight", deleted: false, color: "pink", placement: { status: "ORPHANED" } }]);
  expect(marks.get("b-intro")).toHaveLength(2);
  const segs = segments(u, marks.get("b-intro"));
  expect(segs.map(s => s.text).join("")).toBe(u.raw);
  expect(segs.filter(s => s.color === "yellow").map(s => s.text).join("")).toBe(u.raw.slice(5, 20));
  expect(segs.some(s => s.part.strong)).toBe(true);
  expect(segs.some(s => s.part.ref)).toBe(true);
});
