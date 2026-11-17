/* De studieles als native componenten: runs (selecteerbare tekst), afbeeldingen met bijschrift, tabellen, video-verwijzing en streep.
 * Geen WebView. Selectie, markeringen en verwijzingen lopen via runModel en de bestaande contracten. */
import { createRef, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import type { NativeSessionClient } from "@/lib/native/client";
import type { NativeStudyLesson } from "@/lib/native/studyLessonContract";
import { buildItems, buildRunLayout, marksByBlock, type Item, type RunLayout } from "./runModel";
import { SelectableRun, type RunInput } from "./SelectableRun";
import { loadStudyImage, type StudyAnnotation } from "./api";

export interface RunHandle { key: string; sectionId: string; layout: RunLayout; input: RefObject<RunInput | null> }
export interface ActiveSelection { run: RunHandle; start: number; end: number }

function Figure({ client, item, mediaId, fontSize }: { client: NativeSessionClient; item: Extract<Item, { type: "figure" }>; mediaId: string | null; fontSize: number }) {
  const [state, setState] = useState<{ uri: string } | "loading" | "failed">(mediaId ? "loading" : "failed");
  useEffect(() => {
    let live = true;
    if (!mediaId) { setState("failed"); return; }
    loadStudyImage(client, mediaId).then(i => live && setState({ uri: i.uri })).catch(() => live && setState("failed"));
    return () => { live = false; };
  }, [client, mediaId]);
  return (
    <View testID={`figure-${item.id}`} style={{ width: "100%", maxWidth: item.width, alignSelf: "center", aspectRatio: item.width / item.height, backgroundColor: "#eee", borderRadius: 12, overflow: "hidden", justifyContent: "center" }}>
      {typeof state === "object" ? (
        <Image testID={`image-${item.id}`} source={{ uri: state.uri }} accessibilityLabel={item.alt || "Afbeelding"} accessible resizeMode="contain" style={{ width: "100%", height: "100%" }} />
      ) : (
        <Text accessibilityRole="text" style={{ textAlign: "center", padding: 8, color: "#555", fontSize: Math.max(14, fontSize * 0.85) }}>{state === "loading" ? "Afbeelding laden…" : "Afbeelding niet beschikbaar"}</Text>
      )}
    </View>
  );
}

export function LessonView({ client, lesson, annotations, fontSize, onSelection, registry }: {
  client: NativeSessionClient;
  lesson: NativeStudyLesson;
  annotations: readonly StudyAnnotation[];
  fontSize: number;
  onSelection: (selection: ActiveSelection | null) => void;
  /** Het scherm kan hier runs opzoeken (bijvoorbeeld voor testhulpmiddelen). */
  registry: { current: Map<string, RunHandle> };
}) {
  const sections = useMemo(() => lesson.body.sections.map(s => ({ id: s.id, items: buildItems(lesson.body, s.id) })), [lesson]);
  const refs = useRef(new Map<string, RefObject<RunInput | null>>());
  const inputFor = (key: string) => refs.current.get(key) ?? refs.current.set(key, createRef<RunInput>()).get(key)!;
  registry.current.clear();
  const mediaOf = (key: string) => lesson.media.find(m => m.mediaKey === key)?.mediaId ?? null;

  function run(sectionId: string, key: string, units: Extract<Item, { type: "run" }>["units"]) {
    const layout = buildRunLayout(units);
    const handle: RunHandle = { key, sectionId, layout, input: inputFor(key) };
    registry.current.set(key, handle);
    return (
      <SelectableRun
        key={key}
        ref={handle.input}
        runKey={key}
        layout={layout}
        marks={marksByBlock(units, annotations)}
        fontSize={fontSize}
        onSelect={s => onSelection(s.start === s.end ? { run: handle, start: s.start, end: s.end } : { run: handle, start: s.start, end: s.end })}
      />
    );
  }

  return (
    <View testID="lesson-content" style={{ gap: 18 }}>
      {sections.map(section => section.items.map(item => {
        if (item.type === "run") return run(section.id, item.key, item.units);
        if (item.type === "figure") return <Figure key={item.id} client={client} item={item} mediaId={mediaOf(item.mediaKey)} fontSize={fontSize} />;
        if (item.type === "divider") return <View key={item.id} accessibilityRole="none" style={{ height: 1, backgroundColor: "#ccc" }} />;
        if (item.type === "video") return (
          <Pressable key={item.id} testID={`video-${item.id}`} accessibilityRole="link" accessibilityLabel={`Video: ${item.title}`} onPress={() => Linking.openURL(item.externalUrl)} style={{ minHeight: 44, justifyContent: "center", padding: 12, borderRadius: 10, borderWidth: 1 }}>
            <Text style={{ fontSize }}>{`▶ ${item.title}`}</Text>
          </Pressable>
        );
        return (
          <View key={item.id} testID={`table-${item.id}`} accessibilityRole="none" style={{ borderWidth: 1, borderColor: "#999" }}>
            {item.rows.map(row => (
              <View key={row.id} style={{ flexDirection: "row" }}>
                {row.cells.map(cell => (
                  <View key={cell.id} style={{ flex: cell.colSpan, borderWidth: 0.5, borderColor: "#999", padding: 8, backgroundColor: cell.header ? "#f3f4f6" : undefined }}>
                    {run(section.id, cell.id, [cell.unit])}
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      }))}
    </View>
  );
}
