import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppSession } from "@poc/core/AppSessionProvider";
import { useLive } from "@poc/core/useLive";
import { FONT_SIZES } from "@poc/reader/SelectableChapter";
import { deleteStudyAnnotation, loadStudy, overlapping, putStudyAnnotation } from "@poc/study/api";
import { LessonView, type ActiveSelection, type RunHandle } from "@poc/study/LessonView";
import { rangesLabel, rangesText, rangesToLessonSelector, selectionToRanges } from "@poc/study/runModel";

const DEBUG = process.env.EXPO_PUBLIC_POC_DEBUG === "1";
const button = (disabled: boolean) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, justifyContent: "center" as const, opacity: disabled ? 0.4 : 1 });

/** Architectuurproef rijke studielessen: een bestaande, gepubliceerde les als native componenten met selectie en annotaties. */
export default function Les() {
  const { session } = useAppSession();
  const { data, error, loading, refresh } = useLive(useCallback(() => loadStudy(session.client), [session]));
  const insets = useSafeAreaInsets();
  const registry = useRef(new Map<string, RunHandle>());
  const ignoreCollapseUntil = useRef(0);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fontSize = FONT_SIZES[sizeIndex]!;
  const rows = data?.annotations.annotations ?? [];

  const ranges = useMemo(() => (selection ? selectionToRanges(selection.run.layout, selection.start, selection.end) : []), [selection]);
  const info = ranges.length === 0 ? "Geen selectie" : (() => { const t = rangesText(ranges); return `Selectie: «${t.length > 80 ? `${t.slice(0, 77)}…` : t}» · ${rangesLabel(ranges)}`; })();
  const live = rows.filter(r => !r.deleted);
  const highlights = live.filter(r => r.kind === "highlight");
  const notes = live.filter(r => r.kind === "note");
  const summary = data ? `Markeringen: ${highlights.length ? highlights.length : "geen"}` : "";
  const noteSummary = notes.map(n => `Notitie: ${n.text}`).join(" | ");

  const run = async (work: () => Promise<string>) => {
    if (!data || busy) return;
    setBusy(true); setStatus(null);
    try { setStatus(await work()); await refresh(); }
    catch { setStatus("Opslaan mislukt. Probeer het opnieuw."); }
    finally { setBusy(false); }
  };
  const selector = () => rangesToLessonSelector(data!.lesson.body, selection!.run.sectionId, data!.lesson.revisionId, ranges);
  const mark = () => run(async () => { await putStudyAnnotation(session.client, data!.lesson, rows, data!.annotations.tombstones, selector(), { kind: "highlight", color: "yellow" }); return `Gemarkeerd: ${rangesLabel(ranges)}`; });
  const unmark = () => run(async () => {
    const hit = overlapping(rows, "highlight", ranges);
    for (const row of hit) await deleteStudyAnnotation(session.client, data!.lesson, row);
    return hit.length ? `Markering gewist: ${hit.length}` : "Geen markering gevonden";
  });
  const saveNote = () => run(async () => {
    await putStudyAnnotation(session.client, data!.lesson, rows, data!.annotations.tombstones, selector(), { kind: "note", text: noteText.trim() });
    setNoteOpen(false); setNoteText("");
    return "Notitie opgeslagen";
  });
  /** Testhulp: een bereik van blok `from` (vanaf offset) tot blok `to` (tot offset), zodat een selectie over meerdere blokken reproduceerbaar is. */
  const selectAcross = (fromId: string, fromOffset: number, toId: string, toOffset: number) => {
    const handle = [...registry.current.values()].find(h => h.layout.spans.some(s => s.unit.id === fromId));
    if (!handle) return;
    const a = handle.layout.spans.find(s => s.unit.id === fromId)!.start + fromOffset;
    const b = handle.layout.spans.find(s => s.unit.id === toId)!.start + toOffset;
    handle.input.current?.focus();
    const apply = () => {
      ignoreCollapseUntil.current = Date.now() + 1500;
      handle.input.current?.setSelection(a, b);
      setSelection({ run: handle, start: a, end: b });
    };
    setTimeout(apply, 250);
    setTimeout(apply, 900);
  };

  const onSelection = useCallback((s: ActiveSelection | null) => {
    if (!s) return setSelection(null);
    if (s.start === s.end) { if (Date.now() >= ignoreCollapseUntil.current) setSelection(cur => (cur && cur.run.key === s.run.key ? null : cur)); }
    else setSelection(s);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView testID="lesson-controls" keyboardShouldPersistTaps="handled" style={{ maxHeight: "65%", flexGrow: 0, flexShrink: 0, borderBottomWidth: 1, borderColor: "#ccc" }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: insets.top + 8, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 12, rowGap: 6 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700" }}>{data ? `Les · ${data.lesson.title}` : "Les"}</Text>
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
            <TextInput testID="note-input" accessibilityLabel="Notitietekst" value={noteText} onChangeText={setNoteText} placeholder="Notitie bij de selectie" style={{ borderWidth: 1, borderRadius: 8, padding: 8, minHeight: 44 }} />
            <Pressable testID="note-save" accessibilityRole="button" accessibilityLabel="Notitie opslaan" disabled={!noteText.trim() || busy} onPress={saveNote} style={button(!noteText.trim() || busy)}><Text>Notitie opslaan</Text></Pressable>
          </View>
        ) : null}
        <Text testID="status-line" accessibilityLiveRegion="polite">{status ?? ""}</Text>
        <Text testID="annotation-summary">{summary}</Text>
        {noteSummary ? <Text testID="note-summary">{noteSummary}</Text> : null}
        {DEBUG ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pressable testID="debug-select-blocks" accessibilityRole="button" accessibilityLabel="Selecteer over twee alinea's (test)" onPress={() => selectAcross("b-p1", 0, "b-p2", 21)} style={button(false)}><Text>Test: twee alinea's</Text></Pressable>
            <Pressable testID="debug-select-cell" accessibilityRole="button" accessibilityLabel="Selecteer een tabelcel (test)" onPress={() => selectAcross("td-b1", 0, "td-b1", 8)} style={button(false)}><Text>Test: tabelcel</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
      <ScrollView testID="lesson-scroll" style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {loading && !data ? <ActivityIndicator accessibilityLabel="Laden" /> : null}
        {error && !data ? <Pressable accessibilityRole="button" onPress={refresh}><Text style={{ color: "#b00020" }}>Laden mislukt. Tik om opnieuw te proberen.</Text></Pressable> : null}
        {data ? <LessonView client={session.client} lesson={data.lesson} annotations={rows} fontSize={fontSize} onSelection={onSelection} registry={registry} /> : null}
      </ScrollView>
    </View>
  );
}
