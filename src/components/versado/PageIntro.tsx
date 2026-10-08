import type { ReactNode } from "react";

/**
 * Kop van een hulpmiddel: één titel, één rustige ondertitel en eventueel een
 * kleine bovenregel (bv. het aantal woorden). De terugbalk komt uit
 * SubpageBackBar; dit is dus nooit een tweede titel naast de balk, maar de
 * inhoudelijke kop van de pagina zelf.
 */
export default function PageIntro({ title, text, eyebrow }: { title: string; text?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      {eyebrow && <p className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{eyebrow}</p>}
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-vs-fg [overflow-wrap:anywhere]">{title}</h1>
      {text && <p className="max-w-prose text-sm leading-relaxed text-vs-fg-3">{text}</p>}
    </header>
  );
}
