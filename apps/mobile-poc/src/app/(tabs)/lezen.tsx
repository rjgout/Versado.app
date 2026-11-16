import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppSession } from "@poc/core/AppSessionProvider";
import { useLive } from "@poc/core/useLive";
import { deleteAnnotation, highlightsByVerse, liveAnnotation, loadBundle, notesByVerse, putAnnotation } from "@poc/reader/api";
import { FONT_SIZES, SelectableChapter, type ChapterInput } from "@poc/reader/SelectableChapter";
import { buildLayout, selectedText, selectionToVerseRanges, verseLabel } from "@poc/reader/selectionModel";

const DEBUG = process.env.EXPO_PUBLIC_POC_DEBUG === "1";
const button = (disabled: boolean) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, justifyContent: "center" as const, opacity: disabled ? 0.4 : 1 });

/** Lezer-spike: hoofdstuk via de bestaande routes, native selectie, markeren en notitie per vers via het bestaande annotatiecontract. */
export default function Lezen() {
  const { session } = useAppSession();
  const { data, error, loading, refresh } = useLive(useCallback(() => loadBundle(session.client), [session]));
  const inputRef = useRef<ChapterInput>(null);
  const insets = useSafeAreaInsets();
  // Testhook: het systeem klapt een selectie nog één keer in terwijl zijn selectiebalk sluit; die gebeurtenis negeren we kort.
  const ignoreCollapseUntil = useRef(0);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const layout = useMemo(() => (data ? buildLayout(data.reader.verses) : null), [data]);
  const rows = data?.annotations.annotations ?? [];
  const highlights = useMemo(() => highlightsByVerse(rows), [rows]);
  const notes = useMemo(() => notesByVerse(rows), [rows]);
  const ranges = useMemo(() => (layout && selection ? selectionToVerseRanges(layout, selection.start, selection.end) : []), [layout, selection]);
  const fontSize = FONT_SIZES[sizeIndex]!;

  const info = ranges.length === 0 ? "Geen selectie" : (() => { const t = selectedText(ranges); return `Selectie: «${t.length > 80 ? `${t.slice(0, 77)}…` : t}» · ${verseLabel(ranges)}`; })();
  const numbers = (map: Record<string, string>) => data!.reader.verses.filter(v => map[v.id]).map(v => v.number);
  const summary = data ? `Markeringen: ${numbers(highlights).length ? `vers ${numbers(highlights).join(", ")}` : "geen"}` : "";
  const noteSummary = data ? numbers(notes).map(n => `Notitie vers ${n}: ${notes[data.reader.verses[n - 1]!.id]}`).join(" | ") : "";

  const run = async (work: () => Promise<string>) => {
    if (!data || busy) return;
    setBusy(true); setStatus(null);
    try { setStatus(await work()); await refresh(); }
    catch { setStatus("Opslaan mislukt. Probeer het opnieuw."); }
    finally { setBusy(false); }
  };
  const mark = () => run(async () => {
    for (const r of ranges) await putAnnotation(session.client, data!.reader, rows, { kind: "highlight", verseId: r.verseId, color: "yellow" });
    return `Gemarkeerd: ${verseLabel(ranges)}`;
  });
  const unmark = () => run(async () => {
    let count = 0;
    for (const r of ranges) { const row = liveAnnotation(rows, "highlight", r.verseId); if (row) { await deleteAnnotation(session.client, data!.reader, row); count++; } }
    return count ? `Markering gewist: ${verseLabel(ranges)}` : "Geen markering gevonden";
  });
  const saveNote = () => run(async () => {
    const first = ranges[0]!;
    await putAnnotation(session.client, data!.reader, rows, { kind: "note", verseId: first.verseId, text: noteText.trim() });
    setNoteOpen(false); setNoteText("");
    return `Notitie opgeslagen bij vers ${first.number}`;
  });
  const selectVerses = (from: number, to: number) => {
    if (!layout) return;
    const a = layout.spans[from - 1]!.textStart, b = layout.spans[to - 1]!.textEnd;
    inputRef.current?.focus();
    // Een aanwezige systeemselectie (loupe/menu) sluit zich net na de tik en klapt dan in; pas daarna het bereik zetten.
    const apply = () => {
      ignoreCollapseUntil.current = Date.now() + 1500;
      inputRef.current?.setSelection(a, b);
      // iOS stuurt bij een programmatische selectie geen onSelectionChange (wel bij een gebruikersselectie): zet de staat zelf.
      setSelection({ start: a, end: b });
    };
    setTimeout(apply, 250);
    setTimeout(apply, 900);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* De bediening is hoogstens 65% van het inhoudsgebied en scrolt zelf: bij een grote systeemtekstgrootte blijft de hoofdstuktekst zichtbaar. */}
      <ScrollView testID="reader-controls" keyboardShouldPersistTaps="handled" style={{ maxHeight: "65%", flexGrow: 0, flexShrink: 0, borderBottomWidth: 1, borderColor: "#ccc" }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: insets.top + 8, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 12, rowGap: 6 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700" }}>{data ? `Lezen · ${data.reader.bookName} ${data.reader.chapterNumber}` : "Lezen"}</Text>
          <Pressable testID="font-smaller" accessibilityRole="button" accessibilityLabel="Kleinere letters" disabled={sizeIndex === 0} onPress={() => setSizeIndex(i => Math.max(0, i - 1))} style={button(sizeIndex === 0)}><Text>A−</Text></Pressable>
          <Text testID="font-size-label" accessibilityLabel={`Lettergrootte ${fontSize}`}>{`Lettergrootte ${fontSize}`}</Text>
          <Pressable testID="font-larger" accessibilityRole="button" accessibilityLabel="Grotere letters" disabled={sizeIndex === FONT_SIZES.length - 1} onPress={() => setSizeIndex(i => Math.min(FONT_SIZES.length - 1, i + 1))} style={button(sizeIndex === FONT_SIZES.length - 1)}><Text>A+</Text></Pressable>
        </View>
        <Text testID="selection-info" accessibilityLiveRegion="polite">{info}</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Pressable testID="mark-button" accessibilityRole="button" accessibilityLabel="Markeren" disabled={!ranges.length || busy} onPress={mark} style={button(!ranges.length || busy)}><Text>Markeren</Text></Pressable>
          <Pressable testID="unmark-button" accessibilityRole="button" accessibilityLabel="Markering wissen" disabled={!ranges.length || busy} onPress={unmark} style={button(!ranges.length || busy)}><Text>Markering wissen</Text></Pressable>
          <Pressable testID="note-open" accessibilityRole="button" accessibilityLabel="Notitie" disabled={!ranges.length || busy} onPress={() => setNoteOpen(true)} style={button(!ranges.length || busy)}><Text>Notitie</Text></Pressable>
        </View>
        {noteOpen && ranges.length ? (
          <View style={{ gap: 8 }}>
            <TextInput testID="note-input" accessibilityLabel="Notitietekst" value={noteText} onChangeText={setNoteText} placeholder="Notitie bij het eerste geselecteerde vers" style={{ borderWidth: 1, borderRadius: 8, padding: 8, minHeight: 44 }} />
            <Pressable testID="note-save" accessibilityRole="button" accessibilityLabel="Notitie opslaan" disabled={!noteText.trim() || busy} onPress={saveNote} style={button(!noteText.trim() || busy)}><Text>Notitie opslaan</Text></Pressable>
          </View>
        ) : null}
        <Text testID="status-line" accessibilityLiveRegion="polite">{status ?? ""}</Text>
        <Text testID="annotation-summary">{summary}</Text>
        {noteSummary ? <Text testID="note-summary">{noteSummary}</Text> : null}
        {DEBUG ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pressable testID="debug-select-5-7" accessibilityRole="button" accessibilityLabel="Selecteer vers 5 tot en met 7 (test)" onPress={() => selectVerses(5, 7)} style={button(false)}><Text>Test: vers 5–7</Text></Pressable>
            <Pressable testID="debug-select-8" accessibilityRole="button" accessibilityLabel="Selecteer vers 8 (test)" onPress={() => selectVerses(8, 8)} style={button(false)}><Text>Test: vers 8</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {loading && !data ? <ActivityIndicator accessibilityLabel="Laden" /> : null}
        {error && !data ? <Pressable accessibilityRole="button" onPress={refresh}><Text style={{ color: "#b00020" }}>Laden mislukt. Tik om opnieuw te proberen.</Text></Pressable> : null}
        {data && layout ? (
          <SelectableChapter
            ref={inputRef}
            layout={layout}
            highlights={highlights}
            notes={notes}
            fontSize={fontSize}
            onSelect={s => { if (s.start === s.end) { if (Date.now() >= ignoreCollapseUntil.current) setSelection(null); } else setSelection(s); }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
