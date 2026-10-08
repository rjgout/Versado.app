"use client";

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
  size = "large",
}: {
  /** Naam van de radiogroep (uniek per pagina). */
  name: string;
  legend: string;
  value: PersonalMascotCharacter | null;
  onSelect: (character: PersonalMascotCharacter) => void;
  disabled?: boolean;
  /** large: onboarding, compact: profiel. Beide groot genoeg om gezicht en houding te zien. */
  size?: "large" | "compact";
}) {
  const t = useT();
  const mascotWidth = size === "large" ? "w-[clamp(120px,32vw,9rem)] sm:w-36 lg:w-40" : "w-[clamp(120px,32vw,8.5rem)] sm:w-32 lg:w-36";
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {PERSONAL_MASCOTS.map((character) => {
          const selected = value === character;
          const target = { character, state: "greeting" } as MascotTarget;
          return (
            <label
              key={character}
              className={`vs-motion relative flex cursor-pointer items-center gap-4 rounded-2xl border-2 p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vs-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-vs-app sm:flex-col sm:gap-2 sm:p-4 sm:text-center ${
                selected ? "border-vs-accent bg-vs-accent-soft" : "border-vs-line bg-vs-surface hover:border-vs-line-strong"
              } ${disabled ? "cursor-default opacity-70" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={character}
                checked={selected}
                onChange={() => onSelect(character)}
                className="sr-only"
              />
              <span className={`aspect-square shrink-0 ${mascotWidth}`}>
                <MascotSlot {...target} size={160} fill />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-lg font-extrabold text-vs-fg">{NAMES[character]}</span>
                {/* Eén eigenschap per regel, net als op de homepagina. */}
                {t(`home.mascots.${character}`).split(" · ").map((trait) => (
                  <span key={trait} className="text-sm leading-snug text-vs-fg-2">
                    {trait}
                  </span>
                ))}
              </span>
              {selected && (
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
