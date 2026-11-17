import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { richLessonBody } from "../fixtures/rijkeles";
import { buildItems, buildRunLayout, rangesToLessonSelector, type LessonRange } from "../src/study/runModel";

const doc = richLessonBody();
let mockRows: unknown[] = [];
const mockPut = jest.fn(async () => ({}));
const mockDelete = jest.fn(async () => ({}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock("@poc/core/AppSessionProvider", () => ({ useAppSession: () => ({ session: { client: {} } }) }));
jest.mock("@poc/study/api", () => ({
  ...jest.requireActual("@poc/study/api"),
  loadStudy: async () => {
    const { richLessonBody } = jest.requireActual("../fixtures/rijkeles");
    const lesson = { version: 1, userId: "u1", activeCollectionId: "c1", selectionVersion: 0, language: "nl", courseId: "course1", editionId: "ed1", lessonId: "l1", collectionId: "c1", revisionId: "rev1", title: "Synthetische rijke proeflezing", body: richLessonBody(), media: [{ mediaKey: "media-painting", mediaId: "m1" }] };
    return { lesson, annotations: { annotations: mockRows, tombstones: [] } };
  },
  loadStudyImage: async () => ({ uri: "data:image/webp;base64,AAAA", width: 400, height: 300 }),
  putStudyAnnotation: (...args: unknown[]) => (mockPut as (...a: unknown[]) => unknown)(...args),
  deleteStudyAnnotation: (...args: unknown[]) => (mockDelete as (...a: unknown[]) => unknown)(...args),
}));
import Les from "../src/app/(tabs)/les";

const items = buildItems(doc, "section-main");
const firstRun = items[0] as Extract<(typeof items)[number], { type: "run" }>;
const layout = buildRunLayout(firstRun.units);
const select = (id: string, start: number, end: number) => fireEvent(screen.getByTestId(`run-${id}`), "selectionChange", { nativeEvent: { selection: { start, end } } });
const at = (needle: string) => layout.text.indexOf(needle);
function find(node: unknown, id: string): unknown {
  if (!node || typeof node !== "object") return null;
  const n = node as { props?: { testID?: string }; children?: unknown[] | null };
  if (n.props?.testID === id) return n;
  for (const c of n.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}
function renderedText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return ((node as { children?: unknown[] | null }).children ?? []).map(renderedText).join("");
}
const flatStyles = (node: unknown): { backgroundColor?: string }[] => {
  const out: { backgroundColor?: string }[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const x = n as { props?: { style?: unknown }; children?: unknown[] | null };
    const st = ([] as unknown[]).concat(x.props?.style ?? []).flat(5).filter(Boolean) as { backgroundColor?: string }[];
    out.push(...st);
    (x.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
};

// RNTL stuurt geen events naar een niet-bewerkbare TextInput (iOS-variant); de interacties lopen daarom als Android.
beforeEach(() => { mockRows = []; mockPut.mockClear(); mockDelete.mockClear(); jest.replaceProperty(Platform, "OS", "android"); });
afterEach(() => { jest.restoreAllMocks(); });

const key = firstRun.key;

test("de weergegeven tekst van een run is exact de layout-string: daarop berusten alle selectie-offsets", async () => {
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  expect(renderedText(find(screen.toJSON(), `run-${key}`))).toBe(layout.text);
});

test("alle blokttypen van de les zijn aanwezig als native onderdelen: koppen, alinea's, opsommingen, citaat, tabel, afbeelding met bijschrift, verwijzingen", async () => {
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  const all = JSON.stringify(screen.toJSON());
  for (const needle of ["Proeflezing: de weg naar het beloofde land", "Eerste opsommingspunt", "Genest subpunt", "Testauteur, 2026", "Kolom A", "Cel B1", "Synthetisch schilderij, testkunstenaar", "• ", "1. "]) expect(all).toContain(needle);
  expect(screen.getByTestId("figure-img-img2")).toBeTruthy();
  expect(await screen.findByTestId("image-img-img2")).toHaveProp("accessibilityLabel", "Synthetisch schilderij");
  expect(screen.getByTestId("table-b-table")).toBeTruthy();
  expect(screen.getByTestId("ref-ref-inline")).toHaveProp("accessibilityRole", "link");
  expect(screen.getByTestId("ref-ref-block")).toHaveProp("accessibilityLabel", "Verwijzing 1 Nephi 3:7");
});

test("een woord selecteren toont tekst en aantal blokken; markeren slaat één highlight op met een geldige selector", async () => {
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  const i = at("Eerste alinea");
  await select(key, i, i + 6);
  expect(screen.getByTestId("selection-info")).toHaveTextContent("Selectie: «Eerste» · 1 blok");
  await fireEvent.press(screen.getByTestId("mark-button"));
  expect(mockPut).toHaveBeenCalledTimes(1);
  const [, , , , selector, input] = mockPut.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown, { ranges: unknown[]; exact: string; sectionAnchor: string }, { kind: string; color: string }];
  expect(input).toEqual({ kind: "highlight", color: "yellow" });
  expect(selector.sectionAnchor).toBe("section-main");
  expect(selector.ranges).toEqual([{ blockId: "b-p1", start: 0, end: 6 }]);
  expect(selector.exact).toBe("Eerste");
});

test("een selectie over een kop en twee alinea's is één annotatie met drie bereiken in documentvolgorde", async () => {
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  const a = layout.spans.find(s => s.unit.id === "b-topic1")!.start + 4, b = layout.spans.find(s => s.unit.id === "b-p2")!.start + 6;
  await select(key, a, b);
  expect(screen.getByTestId("selection-info")).toHaveTextContent(/· 3 blokken$/);
  await fireEvent.press(screen.getByTestId("note-open"));
  await fireEvent.changeText(screen.getByTestId("note-input"), "  Mijn notitie  ");
  await fireEvent.press(screen.getByTestId("note-save"));
  expect(mockPut).toHaveBeenCalledTimes(1);
  const call = mockPut.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown, { ranges: { blockId: string }[] }, { kind: string; text: string }];
  expect(call[5]).toEqual({ kind: "note", text: "Mijn notitie" });
  expect(call[4].ranges.map(r => r.blockId)).toEqual(["b-topic1", "b-p1", "b-p2"]);
});

test("een tabelcel is een eigen selecteerbare run; een selectie bij een andere run vervangt de vorige", async () => {
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  await select("td-b1", 0, 5);
  expect(screen.getByTestId("selection-info")).toHaveTextContent("Selectie: «Cel B» · 1 blok");
  const i = at("Eerste alinea");
  await select(key, i, i + 6);
  expect(screen.getByTestId("selection-info")).toHaveTextContent("Selectie: «Eerste» · 1 blok");
});

test("bestaande markeringen en notities worden getoond op de door de server geplaatste bereiken", async () => {
  const ranges: LessonRange[] = [{ blockId: "b-p1", from: 0, to: 6, start: 0, end: 6, exact: "Eerste" }];
  const selector = rangesToLessonSelector(doc, "section-main", "rev1", ranges);
  mockRows = [
    { id: "h1", kind: "highlight", color: "yellow", deleted: false, mutationVersion: 1, anchorStatus: "ok", target: { type: "lesson", lessonEditionId: "ed1", revisionId: "rev1", selector }, placement: { status: "EXACT", selector } },
    { id: "n1", kind: "note", text: "Een notitie", deleted: false, mutationVersion: 1, anchorStatus: "ok", target: { type: "lesson", lessonEditionId: "ed1", revisionId: "rev1", selector }, placement: { status: "EXACT", selector } },
    { id: "h2", kind: "highlight", color: "pink", deleted: false, mutationVersion: 1, anchorStatus: "orphaned", target: { type: "lesson", lessonEditionId: "ed1", revisionId: "rev1", selector }, placement: { status: "ORPHANED" } },
  ];
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  expect(screen.getByTestId("annotation-summary")).toHaveTextContent("Markeringen: 2");
  expect(screen.getByTestId("note-summary")).toHaveTextContent("Notitie: Een notitie");
  const styles = flatStyles(find(screen.toJSON(), `run-${key}`));
  expect(styles.some(s => s.backgroundColor === "#fde68a")).toBe(true);
  expect(styles.some(s => s.backgroundColor === "#fbcfe8")).toBe(false); // niet-geplaatst (orphaned) wordt niet op een gok getoond
  // Markering wissen verwijdert de rij die de selectie raakt.
  const i = at("Eerste alinea");
  await select(key, i + 1, i + 4);
  await fireEvent.press(screen.getByTestId("unmark-button"));
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

test("lettergrootte wijzigt de tekstgrootte van de run; bediening scrolt zelf en houdt tikken bij open toetsenbord", async () => {
  await render(<Les />);
  await screen.findByTestId(`run-${key}`);
  const before = JSON.stringify(find(screen.toJSON(), `run-${key}`));
  await fireEvent.press(screen.getByTestId("font-larger"));
  expect(screen.getByTestId("font-size-label")).toHaveTextContent("Lettergrootte 24");
  expect(JSON.stringify(find(screen.toJSON(), `run-${key}`))).not.toBe(before);
  expect(screen.getByTestId("lesson-controls")).toHaveProp("keyboardShouldPersistTaps", "handled");
  expect(screen.getByTestId("lesson-scroll")).toHaveProp("keyboardShouldPersistTaps", "handled");
  expect(screen.getByTestId("lesson-controls").props.style).toMatchObject({ maxHeight: "65%", flexShrink: 0 });
});

test("platformprops van de run: iOS niet bewerkbaar, Android bewerkbaar zonder toetsenbord (laatste test: wijzigt Platform.OS)", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  await render(<Les />);
  const input = await screen.findByTestId(`run-${key}`);
  expect(input.props.editable).toBe(false);
  jest.replaceProperty(Platform, "OS", "android");
  await render(<Les />);
  expect((await screen.findAllByTestId(`run-${key}`)).at(-1)!.props.editable).toBe(true);
});
