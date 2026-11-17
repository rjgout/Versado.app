/* Kandidaat A van de lezer-spike: de hoofdstuktekst als één niet-bewerkbare, native meerregelige `TextInput`.
 * Daarmee krijgt de lezer de échte platformselectie (UITextView op iOS, EditText op Android: loupe, grepen, woord/regel/alles
 * selecteren, systeemmenu) én een `onSelectionChange` met offsets. Gewone `<Text selectable>` geeft geen selectiebereik terug.
 * Markeringen zijn geneste `<Text>`-stijlen (achtergrondkleur) binnen dezelfde tekst, dus de selectie loopt er dwars doorheen.
 *
 * De weergegeven string moet exact `layout.text` zijn (zie selectionModel.buildLayout), anders kloppen de offsets niet. */
import { forwardRef, type ElementRef } from "react";
import { Platform, Text, TextInput } from "react-native";
import type { ChapterLayout } from "./selectionModel";

export const FONT_SIZES = [14, 18, 24, 32] as const;
export const HIGHLIGHT_COLORS: Record<string, string> = { yellow: "#fde68a", green: "#bbf7d0", blue: "#bfdbfe", pink: "#fbcfe8", purple: "#e9d5ff" };

interface Props {
  layout: ChapterLayout;
  highlights: Record<string, string>;
  notes: Record<string, string>;
  fontSize: number;
  onSelect: (selection: { start: number; end: number }) => void;
}

export type ChapterInput = ElementRef<typeof TextInput>;
export const SelectableChapter = forwardRef<ChapterInput, Props>(function SelectableChapter({ layout, highlights, notes, fontSize, onSelect }, ref) {
  return (
    <TextInput
      ref={ref}
      testID="chapter-text"
      accessibilityLabel="Hoofdstuktekst"
      multiline
      scrollEnabled={false}
      // iOS: een niet-bewerkbare UITextView blijft selecteerbaar. Android: `editable={false}` schakelt de view uit (geen selectie),
      // dus daar blijft hij bewerkbaar zonder toetsenbord; de tekst komt uit de kinderen en wordt bij elke render teruggezet.
      editable={Platform.OS === "ios" ? false : true}
      showSoftInputOnFocus={false}
      caretHidden
      contextMenuHidden={false}
      autoCorrect={false}
      spellCheck={false}
      autoCapitalize="none"
      importantForAutofill="no"
      underlineColorAndroid="transparent"
      textAlignVertical="top"
      onSelectionChange={e => onSelect(e.nativeEvent.selection)}
      style={{ fontSize, lineHeight: Math.round(fontSize * 1.5), padding: 0, color: "#111" }}
    >
      {layout.spans.map((span, i) => {
        const color = highlights[span.id];
        return (
          <Text key={span.id}>
            <Text style={{ color: "#1d4ed8", fontWeight: "700" }}>{`${span.number} `}</Text>
            <Text style={[color ? { backgroundColor: HIGHLIGHT_COLORS[color] } : null, notes[span.id] ? { textDecorationLine: "underline" } : null]}>{span.text}</Text>
            {i < layout.spans.length - 1 ? "\n" : ""}
          </Text>
        );
      })}
    </TextInput>
  );
});
