/** Bestaande versweergave uit de schriftpreview, ook voor de expliciete CFM-schriftlezing. */
export default function ScriptureVerses({
  verses,
  language,
}: {
  verses: ReadonlyArray<{ number: number; text: string }>;
  language: string;
}) {
  return (
    <div className="space-y-3" lang={language}>
      {verses.map((v) => (
        <p
          key={v.number}
          data-scripture-verse={v.number}
          className="leading-relaxed"
        >
          <sup className="mr-2 font-bold text-vs-accent">{v.number}</sup>
          {v.text}
        </p>
      ))}
    </div>
  );
}
