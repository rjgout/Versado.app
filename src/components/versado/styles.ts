// Gedeelde klassen voor de Versado-onderdelen (tokens uit globals.css).
// Bewust geen nieuwe CSS-componentlaag zoals .card/.btn: die gelden voor de
// rest van de app en blijven ongewijzigd tot die pagina's aan de beurt zijn.
// Knoppen hebben een minimale, geen vaste hoogte en mogen afbreken: bij grotere
// tekst of een lange vertaling groeit de knop mee in plaats van over te lopen
// (docs/LAYOUT.md).

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-vs-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vs-app";

export const surfaceCard =
  "rounded-2xl border border-vs-line bg-vs-surface shadow-[0_1px_2px_rgb(var(--vs-shadow)/0.05)] dark:shadow-none";

/** Kaart die als geheel klikbaar is: subtiele reactie op hover en indrukken. */
export const interactiveCard = `${surfaceCard} vs-motion transition duration-200 hover:border-vs-line-strong hover:shadow-[0_6px_20px_-8px_rgb(var(--vs-shadow)/0.18)] active:scale-[0.985] ${focusRing}`;

export const primaryButton = `vs-motion inline-flex min-h-10 max-w-full shrink-0 items-center justify-center gap-1.5 rounded-full py-1.5 text-center bg-vs-accent px-4 text-sm font-bold text-vs-on-accent transition hover:brightness-110 active:scale-[0.97] disabled:opacity-50 ${focusRing}`;

export const secondaryButton = `vs-motion inline-flex min-h-10 max-w-full shrink-0 items-center justify-center gap-1.5 rounded-full py-1.5 text-center border border-vs-line-strong bg-vs-surface px-4 text-sm font-bold text-vs-fg transition hover:bg-vs-subtle active:scale-[0.97] disabled:opacity-50 ${focusRing}`;

export const iconButton = `vs-motion inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-vs-fg-3 transition hover:bg-vs-subtle hover:text-vs-fg active:scale-[0.95] disabled:opacity-50 ${focusRing}`;
