"use client";

import { useEffect, useRef, type ReactNode } from "react";
import NextImage from "next/image";
import FocusLayout from "@/components/versado/FocusLayout";
import PersonalMascot from "@/components/versado/PersonalMascot";

/**
 * De ene voltooiingskaart van Legpuzzel 2.0 (Solo, Tegen elkaar en Samen) en de uitslagkaart na de vraag.
 * Presentatie van door de server vastgelegde gegevens: geen tijdberekening, geen records en geen eigen regels.
 *
 * Rustig en feestelijk: de gekozen gids (PersonalMascot, statische afbeelding, geen eigen animatie), de tijd, de details en
 * eventuele recordinformatie. Het belangrijkste doet de knop onderaan, zoals bij de overige focusschermen.
 * De kaart verplaatst bij verschijnen de focus naar de kop (het bord verdwijnt net), zodat schermlezers hem voorlezen
 * en toetsenbordgebruikers vanaf daar met Tab bij de knop komen.
 */
export interface CompletionCardProps {
  image: string;
  imageAlt: string;
  title: string;
  /** De gids in een passende toestand; `celebrate` voor de voltooiing, `encourage` als de vraag niet goed was. */
  mascot?: "celebrate" | "success" | "encourage";
  time?: { label: string; value: string; note?: string } | null;
  /** Korte details zoals niveau, aantal stukjes en hintcategorie. */
  facts?: string[];
  factsLabel?: string;
  /** Records, deelnemers en andere toelichting; elk kind is een eigen blokje. */
  children?: ReactNode;
  /** Duidelijk dat er nog een vervolg volgt (de verplichte vraag). */
  followUp?: string | null;
  action: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void } | null;
}

export default function CompletionCard({ image, imageAlt, title, mascot = "celebrate", time, facts = [], factsLabel, children, followUp, action, secondary }: CompletionCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Eén keer bij verschijnen (de kaart blijft bij herhaalde serverupdates gewoon dezelfde); geen scroll.
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return (
    <FocusLayout className="page-fill max-w-none gap-4 py-3">
      <section aria-labelledby="puzzle-completion-title" data-completion-card className="mx-auto grid w-full max-w-4xl flex-1 content-center items-center gap-4 [@media(orientation:landscape)_and_(max-height:520px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:520px)]:gap-6">
        <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-vs-surface shadow-lg [@media(orientation:portrait)_and_(max-height:640px)]:hidden">
          <NextImage src={image} alt={imageAlt} width={1440} height={960} unoptimized priority className="h-auto max-h-[30dvh] w-full object-contain [@media(orientation:landscape)_and_(max-height:520px)]:max-h-[70dvh]" />
        </div>
        <div className="flex min-w-0 flex-col items-center gap-3 text-center [@media(max-height:700px)]:gap-2">
          <PersonalMascot state={mascot} size={104} className="h-[104px] w-[104px] shrink-0 [@media(max-height:760px)]:h-[80px] [@media(max-height:760px)]:w-[80px]" />
          <h1 id="puzzle-completion-title" ref={heading} tabIndex={-1} className="vs-wrap text-2xl font-extrabold text-vs-fg outline-none [@media(max-height:700px)]:text-xl">{title}</h1>
          {time && (
            <p className="text-vs-fg" data-official-time>
              <span className="block text-sm text-vs-fg-2">{time.label}</span>
              <span className="block font-mono text-4xl font-extrabold tabular-nums [@media(max-height:700px)]:text-3xl">{time.value}</span>
              {time.note && <span className="mt-1 block text-sm text-vs-fg-2 [@media(max-height:640px)]:sr-only">{time.note}</span>}
            </p>
          )}
          {facts.length > 0 && <ul aria-label={factsLabel} className="flex flex-wrap justify-center gap-2">{facts.map((fact) => <li key={fact} className="vs-wrap rounded-full border border-vs-line px-3 py-1 text-sm font-semibold text-vs-fg-2 [@media(max-height:700px)]:px-2.5 [@media(max-height:700px)]:py-0.5">{fact}</li>)}</ul>}
          {children}
          {followUp && <p className="vs-wrap max-w-[440px] text-sm font-semibold text-vs-fg" data-completion-followup>{followUp}</p>}
        </div>
      </section>
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-2">
        <button type="button" className="btn-primary min-h-12 w-full" onClick={action.onClick}>{action.label}</button>
        {secondary && <button type="button" className="btn-secondary min-h-12 w-full" onClick={secondary.onClick}>{secondary.label}</button>}
      </div>
    </FocusLayout>
  );
}

/** Een rustig blokje voor een recordregel; een bevestigd nieuw record krijgt subtiel extra nadruk (zelfde stijl als `RecordNotice`). */
export function CompletionRecord({ title, text, emphasis = false }: { title?: string; text: string; emphasis?: boolean }) {
  return (
    <div role="status" className={`vs-wrap w-full max-w-[440px] rounded-2xl border p-3 text-left ${emphasis ? "border-vs-xp/40 bg-vs-xp/10" : "border-vs-line"}`} data-completion-record={emphasis ? "new" : "existing"}>
      {title && <p className="font-extrabold text-vs-fg">{title}</p>}
      <p className="text-sm text-vs-fg-2 [@media(max-height:700px)]:text-xs">{text}</p>
    </div>
  );
}
