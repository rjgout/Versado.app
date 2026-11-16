/* Eén run van aaneengesloten tekstblokken als niet-bewerkbare, native meerregelige `TextInput` (UITextView / EditText): echte
 * platformselectie met `onSelectionChange`, zoals de lezer-spike. Opmaak (kop, vet, cursief, verwijzing) en markeringen zijn
 * geneste `<Text>`-stijlen; de weergegeven string is exact `layout.text` (zie runModel.buildRunLayout). */
import { forwardRef, type ElementRef } from "react";
import { Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { HIGHLIGHT_COLORS } from "@poc/reader/SelectableChapter";
import { segments, type Mark, type RunLayout, type TextUnit } from "./runModel";

export type RunInput = ElementRef<typeof TextInput>;
interface Props {
  runKey: string;
  layout: RunLayout;
  marks: ReadonlyMap<string, readonly Mark[]>;
  fontSize: number;
  onSelect: (selection: { start: number; end: number }) => void;
}

const scale = (unit: TextUnit) => unit.role === "heading" ? (unit.level === 2 ? 1.3 : unit.level === 3 ? 1.15 : 1.05) : unit.role === "caption" ? 0.85 : 1;

function UnitText({ unit, marks, fontSize }: { unit: TextUnit; marks: readonly Mark[]; fontSize: number }) {
  const size = Math.round(fontSize * scale(unit));
  const base = {
    fontSize: size,
    lineHeight: Math.round(size * 1.5),
    fontWeight: unit.role === "heading" || unit.header ? ("700" as const) : undefined,
    fontStyle: unit.role === "quote" || unit.role === "caption" ? ("italic" as const) : undefined,
    color: unit.role === "caption" ? "#555" : "#111",
  };
  return (
    <Text style={base}>
      {unit.prefix ? <Text style={{ color: "#1d4ed8" }}>{unit.prefix}</Text> : null}
      {segments(unit, marks).map((s, i) => (
        <Text
          key={i}
          style={[
            s.part.strong ? { fontWeight: "700" } : null,
            s.part.emphasis || s.part.attribution ? { fontStyle: "italic" } : null,
            s.part.ref ? { color: "#1d4ed8", textDecorationLine: "underline" } : s.note ? { textDecorationLine: "underline" } : null,
            s.color ? { backgroundColor: HIGHLIGHT_COLORS[s.color] } : null,
          ]}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  );
}

export const SelectableRun = forwardRef<RunInput, Props>(function SelectableRun({ runKey, layout, marks, fontSize, onSelect }, ref) {
  const refs = layout.spans.flatMap(s => s.unit.parts.filter(p => p.ref).map(p => ({ id: p.ref!.id, url: p.ref!.url, label: p.text })));
  const caption = layout.spans.length === 1 && layout.spans[0]!.unit.role === "caption";
  return (
    <View>
      <TextInput
        ref={ref}
        testID={`run-${runKey}`}
        accessibilityLabel="Lestekst"
        multiline
        scrollEnabled={false}
        // iOS: een niet-bewerkbare UITextView blijft selecteerbaar. Android: `editable={false}` schakelt de view uit (geen selectie),
        // dus daar blijft hij bewerkbaar zonder toetsenbord; de tekst komt uit de kinderen en wordt bij elke render teruggezet.
        editable={Platform.OS === "ios" ? false : true}
        showSoftInputOnFocus={false}
        caretHidden
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize="none"
        importantForAutofill="no"
        underlineColorAndroid="transparent"
        textAlignVertical="top"
        textAlign={caption ? "center" : "left"}
        onSelectionChange={e => onSelect(e.nativeEvent.selection)}
        style={{ padding: 0, color: "#111", fontSize }}
      >
        {layout.spans.map((span, i) => (
          <Text key={span.unit.id}>
            {i > 0 ? layout.text.slice(layout.spans[i - 1]!.end, span.start - span.unit.prefix.length) : ""}
            <UnitText unit={span.unit} marks={marks.get(span.unit.id) ?? []} fontSize={fontSize} />
          </Text>
        ))}
      </TextInput>
      {/* Tikken op tekst in een selecteerbaar veld activeert geen inline link; verwijzingen staan daarom ook als eigen, toegankelijke links. */}
      {refs.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {refs.map(r => (
            <Pressable key={r.id} testID={`ref-${r.id}`} accessibilityRole="link" accessibilityLabel={`Verwijzing ${r.label}`} disabled={!r.url} onPress={() => r.url && Linking.openURL(r.url)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "#1d4ed8", opacity: r.url ? 1 : 0.5 }}>
              <Text style={{ color: "#1d4ed8", fontSize: Math.max(14, fontSize * 0.85) }}>{`↗ ${r.label}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});
