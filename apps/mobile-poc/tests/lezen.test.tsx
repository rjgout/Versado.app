import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import fixture from "../fixtures/proefboek.json";
import { buildLayout } from "../src/reader/selectionModel";

const verses = fixture[0]!.chapters[0]!.verses.map((text, i) => ({ id: `v${i + 1}`, number: i + 1, text }));
const mockReader = { bookName: "Proefboek", chapterNumber: 1, verses, chapterId: "c1" };
let mockRows: unknown[] = [];
const mockPut = jest.fn(async () => ({}));
const mockDelete = jest.fn(async () => ({}));
jest.mock("@poc/core/AppSessionProvider", () => ({ useAppSession: () => ({ session: { client: {} } }) }));
jest.mock("@poc/reader/api", () => ({
  ...jest.requireActual("@poc/reader/api"),
  loadBundle: async () => ({ reader: mockReader, annotations: { annotations: mockRows } }),
  putAnnotation: (...args: unknown[]) => (mockPut as (...a: unknown[]) => unknown)(...args),
  deleteAnnotation: (...args: unknown[]) => (mockDelete as (...a: unknown[]) => unknown)(...args),
}));
import Lezen from "../src/app/(tabs)/lezen";

const layout = buildLayout(verses);
const row = (kind: string, verseId: string, extra: object = {}) => ({ id: `${kind}-${verseId}`, kind, target: { type: "verse", verseId }, targetKey: `verse:${verseId}`, mutationVersion: 1, deleted: false, anchorStatus: "ok", ...extra });
const select = (start: number, end: number) => fireEvent(screen.getByTestId("chapter-text"), "selectionChange", { nativeEvent: { selection: { start, end } } });
const at = (needle: string) => layout.text.indexOf(needle);
/** Alle tekst in de weergegeven boom, in volgorde: zo controleren we dat de weergave exact de layout-string is. */
function renderedText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const n = node as { children?: unknown[] | null };
  return (n.children ?? []).map(renderedText).join("");
}

// RNTL stuurt geen events naar een niet-bewerkbare TextInput (iOS-variant); de interacties lopen daarom als Android, de props per platform worden apart getest.
beforeEach(() => { mockRows = []; mockPut.mockClear(); mockDelete.mockClear(); jest.replaceProperty(Platform, "OS", "android"); });
afterEach(() => { jest.restoreAllMocks(); });

test("de weergegeven tekst is exact de layout-string: daarop berusten alle selectie-offsets", async () => {
  await render(<Lezen />);
  const input = await screen.findByTestId("chapter-text");
  expect(renderedText(screen.toJSON() && findByTestId(screen.toJSON(), "chapter-text"))).toBe(layout.text);
  expect(input).toBeTruthy();
});

function findByTestId(node: unknown, id: string): unknown {
  if (!node || typeof node !== "object") return null;
  const n = node as { props?: { testID?: string }; children?: unknown[] | null };
  if (n.props?.testID === id) return n;
  for (const c of n.children ?? []) { const f = findByTestId(c, id); if (f) return f; }
  return null;
}

test("een geselecteerd woord toont de tekst en het vers; zonder selectie zijn de acties uitgeschakeld", async () => {
  await render(<Lezen />);
  await screen.findByTestId("chapter-text");
  expect(screen.getByTestId("selection-info")).toHaveTextContent("Geen selectie");
  expect(screen.getByTestId("mark-button").props.accessibilityState?.disabled ?? screen.getByTestId("mark-button").props.disabled).toBeTruthy();
  const i = at("proefwoord");
  await select(i, i + 10);
  expect(screen.getByTestId("selection-info")).toHaveTextContent("Selectie: «proefwoord» · vers 3");
  await select(i, i); // ingeklapte selectie = geen selectie
  expect(screen.getByTestId("selection-info")).toHaveTextContent("Geen selectie");
});

test("een selectie over meerdere verzen markeert elk geraakt vers via het bestaande contract (geel)", async () => {
  await render(<Lezen />);
  await screen.findByTestId("chapter-text");
  await select(layout.spans[4]!.textStart + 8, layout.spans[6]!.textStart + 10);
  expect(screen.getByTestId("selection-info")).toHaveTextContent(/· vers 5–7$/);
  await fireEvent.press(screen.getByTestId("mark-button"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(3));
  expect(mockPut.mock.calls.map(c => (c as unknown as unknown[])[3])).toEqual([5, 6, 7].map(n => ({ kind: "highlight", verseId: `v${n}`, color: "yellow" })));
  await waitFor(() => expect(screen.getByTestId("status-line")).toHaveTextContent("Gemarkeerd: vers 5–7"));
});

test("een notitie hoort bij het eerste geselecteerde vers", async () => {
  await render(<Lezen />);
  await screen.findByTestId("chapter-text");
  await select(layout.spans[7]!.textStart, layout.spans[8]!.textStart + 5);
  await fireEvent.press(screen.getByTestId("note-open"));
  await fireEvent.changeText(screen.getByTestId("note-input"), "  Proefnotitie  ");
  await fireEvent.press(screen.getByTestId("note-save"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
  expect((mockPut.mock.calls[0] as unknown as unknown[])[3]).toEqual({ kind: "note", verseId: "v8", text: "Proefnotitie" });
});

test("bestaande markeringen en notities worden getoond en zijn te wissen", async () => {
  mockRows = [row("highlight", "v5", { color: "yellow" }), row("highlight", "v6", { color: "yellow" }), row("note", "v8", { text: "Mijn notitie" })];
  await render(<Lezen />);
  await screen.findByTestId("chapter-text");
  await waitFor(() => expect(screen.getByTestId("annotation-summary")).toHaveTextContent("Markeringen: vers 5, 6"));
  expect(screen.getByTestId("note-summary")).toHaveTextContent("Notitie vers 8: Mijn notitie");
  await select(layout.spans[4]!.textStart, layout.spans[5]!.textEnd);
  await fireEvent.press(screen.getByTestId("unmark-button"));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(2));
});

test("lettergrootte: A+ en A− wijzigen de grootte van de hoofdstuktekst, binnen de grenzen", async () => {
  await render(<Lezen />);
  const input = await screen.findByTestId("chapter-text");
  const size = () => { const s = ([] as object[]).concat(screen.getByTestId("chapter-text").props.style) as { fontSize?: number }[]; return s.find(x => x?.fontSize)?.fontSize; };
  expect(size()).toBe(18);
  await fireEvent.press(screen.getByTestId("font-larger"));
  await fireEvent.press(screen.getByTestId("font-larger"));
  expect(size()).toBe(32);
  expect(screen.getByTestId("font-size-label")).toHaveTextContent("Lettergrootte 32");
  await fireEvent.press(screen.getByTestId("font-larger"));
  expect(size()).toBe(32);
  for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByTestId("font-smaller"));
  expect(size()).toBe(14);
  expect(input).toBeTruthy();
});

test("een mislukte opslag toont een melding en laat de tekst staan", async () => {
  mockPut.mockRejectedValueOnce(new Error("409"));
  await render(<Lezen />);
  await screen.findByTestId("chapter-text");
  const i = at("proefwoord");
  await select(i, i + 10);
  await fireEvent.press(screen.getByTestId("mark-button"));
  await waitFor(() => expect(screen.getByTestId("status-line")).toHaveTextContent(/^Opslaan mislukt/));
  expect(screen.getByTestId("selection-info")).toHaveTextContent(/«proefwoord»/);
});

test("platformgedrag: iOS niet bewerkbaar (UITextView blijft selecteerbaar), Android bewerkbaar zonder toetsenbord", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const ios = await render(<Lezen />);
  expect((await screen.findByTestId("chapter-text")).props.editable).toBe(false);
  ios.unmount();
  jest.replaceProperty(Platform, "OS", "android");
  await render(<Lezen />);
  const android = await screen.findByTestId("chapter-text");
  expect(android.props.editable).toBe(true);
  expect(android.props.showSoftInputOnFocus).toBe(false);
  expect(android.props.scrollEnabled).toBe(false);
});
