import { validatePassageSelector } from "@/lib/annotations/contract";
import fixture from "../fixtures/proefboek.json";
import { buildLayout, chapterDocument, normalizedOffset, rangesToSelector, selectedText, selectionToVerseRanges, verseLabel, type ReaderVerse } from "../src/reader/selectionModel";

const verses: ReaderVerse[] = fixture[0]!.chapters[0]!.verses.map((text, i) => ({ id: `${i % 2 ? "9" : "a"}${i}-id`, number: i + 1, text }));
const layout = buildLayout(verses);
const at = (needle: string, from = 0) => { const i = layout.text.indexOf(needle, from); if (i < 0) throw Error(needle); return i; };

test("de hoofdstuktekst is nummer + tekst per alinea en de spans wijzen exact naar de verstekst", () => {
  for (const s of layout.spans) {
    expect(layout.text.slice(s.numberStart, s.textStart)).toBe(`${s.number} `);
    expect(layout.text.slice(s.textStart, s.textEnd)).toBe(s.text);
  }
  expect(layout.text.split("\n")).toHaveLength(verses.length);
});

test("een woord midden in een vers geeft één bereik met de juiste offsets", () => {
  const i = at("proefwoord");
  const r = selectionToVerseRanges(layout, i, i + "proefwoord".length);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ number: 3, exact: "proefwoord", wholeVerse: false });
  expect(verseLabel(r)).toBe("vers 3");
  expect(verses[2]!.text.slice(r[0]!.from, r[0]!.to)).toBe("proefwoord");
});

test("een deel van een vers (meerdere woorden) is geen heel vers", () => {
  const i = at("bladeren en terugkeren");
  const r = selectionToVerseRanges(layout, i, i + "bladeren en terugkeren".length);
  expect(r[0]!.exact).toBe("bladeren en terugkeren");
  expect(r[0]!.wholeVerse).toBe(false);
});

test("een selectie over meerdere verzen geeft per vers een bereik, nummers en alinea-einden tellen niet mee", () => {
  const start = layout.spans[4]!.textStart + 8; // midden in vers 5
  const end = layout.spans[6]!.textStart + 10;   // midden in vers 7
  const r = selectionToVerseRanges(layout, start, end);
  expect(r.map(x => x.number)).toEqual([5, 6, 7]);
  expect(r[1]!.wholeVerse).toBe(true);
  expect(r[0]!.wholeVerse).toBe(false);
  expect(verseLabel(r)).toBe("vers 5–7");
  expect(selectedText(r)).not.toMatch(/\n|^\d/);
});

test("alleen een versnummer of alinea-einde geselecteerd levert geen bereik op; de selectierichting maakt niet uit", () => {
  expect(selectionToVerseRanges(layout, 0, 2)).toEqual([]);
  const nl = layout.spans[0]!.textEnd;
  expect(selectionToVerseRanges(layout, nl, nl + 1)).toEqual([]);
  const i = at("proefwoord");
  expect(selectionToVerseRanges(layout, i + 10, i)[0]!.exact).toBe("proefwoord");
  expect(selectionToVerseRanges(layout, 5, 5)).toEqual([]);
});

test("witruimte wordt samengevouwen zoals in het contract: offsets na een dubbele spatie en tab kloppen", () => {
  const span = layout.spans[5]!; // bevat een dubbele spatie en een tab
  const raw = span.text;
  const i = raw.indexOf("midden");
  const r = selectionToVerseRanges(layout, span.textStart + i, span.textStart + i + "midden".length);
  expect(r[0]!.exact).toBe("midden");
  // genormaliseerd is de dubbele spatie één spatie, dus de offset is kleiner dan de ruwe positie
  expect(r[0]!.start).toBeLessThan(i);
  expect(normalizedOffset(raw, i)).toBe(r[0]!.start);
});

test("een grens midden in een surrogaatpaar schuift naar buiten; er komt nooit een half teken in de selectie", () => {
  const v: ReaderVerse[] = [{ id: "x1", number: 1, text: "ab😀cd" }];
  const l = buildLayout(v);
  const s = l.spans[0]!;
  const r = selectionToVerseRanges(l, s.textStart + 3, s.textStart + 5); // begint tussen de twee helften van 😀
  expect(r[0]!.exact).toBe("😀c");
  expect(() => normalizedOffset("ab😀cd", 3)).toThrow("SELECTION");
});

test("elk bereik uit een native selectie wordt door het bestaande validatePassageSelector goedgekeurd", () => {
  const doc = chapterDocument(verses);
  const cases: [number, number][] = [];
  const w = at("proefwoord"); cases.push([w, w + 10]);
  cases.push([layout.spans[4]!.textStart + 8, layout.spans[6]!.textStart + 10]);
  cases.push([layout.spans[0]!.textStart, layout.spans[0]!.textEnd]);
  const q = at("typografische aanhalingstekens"); cases.push([q, q + 30]);
  const d = layout.spans[5]!.textStart + verses[5]!.text.indexOf("spatie"); cases.push([d, d + 20]);
  for (const [a, b] of cases) {
    const ranges = selectionToVerseRanges(layout, a, b);
    const selector = rangesToSelector(verses, ranges, "rev-poc-1");
    expect(() => validatePassageSelector(doc, selector)).not.toThrow();
  }
});

test("een selector die niet bij de brontekst past wordt door het contract geweigerd (geen eigen regels in de spike)", () => {
  const doc = chapterDocument(verses);
  const w = at("proefwoord");
  const selector = rangesToSelector(verses, selectionToVerseRanges(layout, w, w + 10), "rev-poc-1");
  expect(() => validatePassageSelector(doc, { ...selector, exact: "ander woord" })).toThrow("ANNOTATION_SELECTOR");
});
