"use client";

import { useLayoutEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MascotSlot from "@/components/versado/MascotSlot";
import { PERSONAL_MASCOTS, type MascotTarget, type PersonalMascotCharacter } from "@/lib/mascots";

// Keuze van de persoonlijke gids (onboarding en profiel). Echte radioknoppen
// in een fieldset: pijltjestoetsen, focus en "geselecteerd" werken voor
// toetsenbord en schermlezer zonder eigen logica. De drie staan gelijkwaardig
// naast elkaar, zonder volgorde van "beste" keuze; de eigenschappen
// informeren alleen.

// Namen worden nooit vertaald; de eigenschappen staan in home.mascots.* (dezelfde canon als de homepagina).
const NAMES: Record<PersonalMascotCharacter, string> = { novi: "Novi", varo: "Varo", vera: "Vera" };

export function companionName(character: PersonalMascotCharacter): string {
  return NAMES[character];
}

export default function CompanionPicker({
  name,
  legend,
  value,
  onSelect,
  disabled = false,
  busy = false,
  size = "large",
}: {
  /** Naam van de radiogroep (uniek per pagina). */
  name: string;
  legend: string;
  value: PersonalMascotCharacter | null;
  onSelect: (character: PersonalMascotCharacter) => void;
  disabled?: boolean;
  /**
   * Opslaan bezig: de bediening blijft focusbaar (een uitgeschakelde radio laat de toetsenbordfocus los
   * bij een pijltjestoets), de aanroeper negeert nieuwe keuzes zolang het opslaan duurt.
   */
  busy?: boolean;
  /**
   * large: onboarding, compact: kleine keuze, carousel: profielpagina "Jouw gids" (op een telefoon
   * een met de vinger bladerbare rij met scroll-snap, vanaf sm drie gelijke kaarten naast elkaar).
   * Alle varianten zijn groot genoeg om gezicht en houding te zien.
   */
  size?: "large" | "compact" | "carousel";
}) {
  const t = useT();
  const rail = useRef<HTMLDivElement>(null);
  const carousel = size === "carousel";

  // Alleen horizontaal binnen de rij scrollen (nooit scrollIntoView): de pagina springt dan niet verticaal.
  function reveal(character: PersonalMascotCharacter, smooth: boolean, onlyIfHidden: boolean) {
    const box = rail.current;
    const card = box?.querySelector<HTMLElement>(`[data-companion="${character}"]`);
    if (!box || !card || box.scrollWidth <= box.clientWidth + 1) return;
    const hidden = card.offsetLeft < box.scrollLeft || card.offsetLeft + card.offsetWidth > box.scrollLeft + box.clientWidth;
    if (onlyIfHidden && !hidden) return;
    const left = card.offsetLeft - (box.clientWidth - card.offsetWidth) / 2;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ left: Math.max(0, left), behavior: smooth && !reduced ? "smooth" : "auto" });
  }
  // Bij openen staat de gekozen gids in beeld; een latere keuze verplaatst de rij niet.
  const initial = useRef(value);
  useLayoutEffect(() => {
    if (carousel && initial.current) reveal(initial.current, false, false);
  }, [carousel]);
  const mascotWidth = carousel ? "w-[clamp(9rem,44vw,11rem)] max-w-full sm:w-[clamp(7rem,16vw,9rem)]" : size === "large" ? "w-[clamp(120px,32vw,9rem)] sm:w-36 lg:w-40" : "w-[clamp(120px,32vw,8.5rem)] sm:w-32 lg:w-36";
  return (
    <fieldset className={`min-w-0 ${busy ? "opacity-70" : ""}`} disabled={disabled} aria-busy={busy || undefined}>
      <legend className="sr-only">{legend}</legend>
      <div
        ref={rail}
        className={carousel
          ? "-mx-4 flex pt-2 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 [scroll-padding-inline:1rem] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0"
          : "grid gap-3 sm:grid-cols-3"}
      >
        {PERSONAL_MASCOTS.map((character) => {
          const selected = value === character;
          const target = { character, state: "greeting" } as MascotTarget;
          return (
            <label
              key={character}
              data-companion={character}
              className={`vs-motion relative flex cursor-pointer rounded-2xl border-2 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vs-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-vs-app ${
                carousel
                  ? "w-[min(78vw,17rem)] shrink-0 snap-center flex-col items-center gap-2 p-4 text-center sm:w-auto sm:shrink"
                  : "items-center gap-4 p-3 sm:flex-col sm:gap-2 sm:p-4 sm:text-center"
              } ${
                selected ? "border-vs-accent bg-vs-accent-soft" : "border-vs-line bg-vs-surface hover:border-vs-line-strong"
              } ${disabled ? "cursor-default opacity-70" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={character}
                checked={selected}
                onChange={() => onSelect(character)}
                onFocus={carousel ? () => reveal(character, true, true) : undefined}
                className="sr-only"
              />
              {carousel && (
                // Vaste hoogte: de kaarten blijven gelijk, en "Gekozen" ligt nooit over de naam of eigenschappen.
                <span className="flex min-h-6 items-center">
                  {selected && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-vs-accent px-2 py-0.5 text-xs font-bold text-vs-on-accent">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                      {t("companion.selected")}
                    </span>
                  )}
                </span>
              )}
              <span className={`aspect-square shrink-0 ${mascotWidth}`}>
                <MascotSlot {...target} size={160} fill />
              </span>
              <span className={`flex min-w-0 max-w-full flex-col gap-0.5 ${carousel ? "break-words hyphens-auto" : ""}`}>
                <span className="text-lg font-extrabold text-vs-fg">{NAMES[character]}</span>
                {/* Eén eigenschap per regel, net als op de homepagina. */}
                {t(`home.mascots.${character}`).split(" · ").map((trait) => (
                  <span key={trait} className="text-sm leading-snug text-vs-fg-2">
                    {trait}
                  </span>
                ))}
              </span>
              {selected && !carousel && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-vs-accent px-2 py-0.5 text-xs font-bold text-vs-on-accent">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  {t("companion.selected")}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
