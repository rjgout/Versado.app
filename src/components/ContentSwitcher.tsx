"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { getLanguage } from "@/lib/languages";
import { useT } from "@/components/I18nProvider";
import ContentIcon from "@/components/versado/ContentIcon";
import { contentAbbreviation } from "@/lib/contentMetadata";

interface Collection {
  id: string;
  slug: string;
  name: string;
  icon: string;
  order: number;
  visibleToUsers: boolean;
  work: string | null;
  editionKey: string;
  language: string;
}

type LabelMode = "full" | "short" | "icon";

// Eén regel per werk (Boek van Mormon, Leer en Verbonden, ...), niet per
// uitgave: anders staat elk werk er in elke taal apart in. De taal kies je
// eronder, met knoppen voor de talen waarin het actieve werk bestaat.
export default function ContentSwitcher({
  enabled,
  active,
  works,
  activeEditions,
  showLanguage,
}: {
  enabled: boolean;
  active: Collection;
  works: { work: string; edition: Collection }[];
  activeEditions: Collection[];
  /** Er is meer dan één contenttaal te kiezen: toon dan overal de taal. */
  showLanguage: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const chevronRef = useRef<SVGSVGElement>(null);
  const fullLabelRef = useRef<HTMLSpanElement>(null);
  const shortLabelRef = useRef<HTMLSpanElement>(null);
  const [labelMode, setLabelMode] = useState<LabelMode>("full");
  // Breedte die de knop met de volledige naam nodig heeft; vanaf desktop de
  // basisbreedte van de kiezer (zie hieronder).
  const [fullTriggerWidth, setFullTriggerWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const shortName = contentAbbreviation(active, active.language);

  useLayoutEffect(() => {
    const root = ref.current;
    const button = buttonRef.current;
    if (!root || !button) return;

    const updateLabelMode = () => {
      const iconWidth = iconRef.current?.getBoundingClientRect().width ?? 20;
      const chevronWidth = chevronRef.current?.getBoundingClientRect().width ?? 16;
      // De button gebruikt px-2 en gap-1.5: trek de vaste ruimte af en laat
      // daarna de gemeten tekstbreedtes beslissen welke representatie past.
      // De wrapper krijgt de resterende headerbreedte; de knop zelf blijft
      // bewust content-sized zodat de vrije ruimte geen klikvlak wordt.
      const available = root.clientWidth - iconWidth - chevronWidth - 28;
      // getBoundingClientRect op block-spans: scrollWidth is voor inline-
      // elementen altijd 0, en dan "paste" de volledige naam altijd.
      const fullWidth = Math.ceil(fullLabelRef.current?.getBoundingClientRect().width ?? Infinity);
      const shortWidth = Math.ceil(shortLabelRef.current?.getBoundingClientRect().width ?? Infinity);
      const next: LabelMode = fullWidth <= available ? "full" : shortName && shortWidth <= available ? "short" : "icon";
      setLabelMode((current) => current === next ? current : next);
      const needed = fullWidth + iconWidth + chevronWidth + 28;
      if (Number.isFinite(needed)) setFullTriggerWidth((current) => current === needed ? current : needed);
    };

    updateLabelMode();
    // Ook de verborgen meetlabels volgen: die worden breder zodra het
    // webfont geladen is, terwijl de beschikbare ruimte gelijk blijft.
    const observer = new ResizeObserver(updateLabelMode);
    observer.observe(root);
    if (fullLabelRef.current) observer.observe(fullLabelRef.current);
    if (shortLabelRef.current) observer.observe(shortLabelRef.current);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) updateLabelMode();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [active.id, active.name, active.language, shortName]);

  if (!enabled) return null;

  async function selectCollection(collection: Collection) {
    if (collection.id === active.id) {
      setOpen(false);
      return;
    }
    await save({ contentCollectionId: collection.id });
  }

  // Een taalknop wisselt de contenttaal zelf (ook voor de andere werken), niet
  // alleen deze ene uitgave.
  async function selectLanguage(edition: Collection) {
    if (edition.id === active.id) return;
    // Bij meerdere vertalingen in dezelfde taal moet een taalknop ook de
    // gekozen uitgavefamilie kunnen vastleggen; met één collectie per taal
    // blijft de bestaande contentLanguage-flow ongewijzigd.
    if (edition.language === active.language && edition.editionKey !== active.editionKey) {
      await save({ contentCollectionId: edition.id });
    } else {
      await save({ contentLanguage: edition.language });
    }
  }

  async function save(body: { contentCollectionId: string } | { contentLanguage: string }) {
    setBusy(true);
    try {
      const response = await fetch("/api/content-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) return;
      setOpen(false);
      // Een volledige reload zorgt dat ook client components hun content opnieuw ophalen.
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const activeWork = active.work ?? active.id;
  const ordered = [
    ...works.filter((option) => option.work === activeWork),
    ...works.filter((option) => option.work !== activeWork),
  ];
  const languageCounts = new Map<string, number>();
  for (const edition of activeEditions) languageCounts.set(edition.language, (languageCounts.get(edition.language) ?? 0) + 1);
  return (
    // Het menu blijft links staan op ieder scherm; de items rechts worden
    // nooit weggedrukt. Telefoon en tablet: alle ruimte tot de items rechts. Desktop: de
    // breedte van de volledige naam als basis, zodat de navigatie in het
    // midden de kiezer niet half opeet; is er te weinig, dan krimpt de kiezer
    // (de navigatie houdt haar eigen minimale breedte) en volgt de afkorting.
    <div
      ref={ref}
      className="relative -ml-2 self-stretch flex min-w-0 max-w-full flex-1 lg:max-w-[18rem] lg:flex-[0_1_var(--vs-switcher-full,18rem)]"
      style={fullTriggerWidth ? ({ "--vs-switcher-full": `${fullTriggerWidth}px` } as CSSProperties) : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={active.name}
        aria-label={t("contentSwitcher.activeAria", {
          name: active.name + (showLanguage ? ` (${getLanguage(active.language).nativeName})` : ""),
        })}
        className="h-full w-fit max-w-full min-w-0 inline-flex items-center justify-start gap-1.5 px-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-300"
      >
        <span ref={iconRef} className="shrink-0"><ContentIcon collection={active} className="h-5 w-5" /></span>
        <span className="pointer-events-none absolute -left-[9999px] whitespace-nowrap" aria-hidden>
          <span ref={fullLabelRef} className="block w-max">{active.name}</span>
          {shortName && <span ref={shortLabelRef} className="block w-max">{shortName}</span>}
        </span>
        {labelMode !== "icon" && <span className="block shrink-0 whitespace-nowrap">{labelMode === "short" && shortName ? shortName : active.name}</span>}
        <ChevronDown ref={chevronRef} className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="absolute top-full left-0 w-[min(32rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-b-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 z-50">
          <div className="mx-auto max-w-2xl px-4 py-2" role="listbox" aria-label={t("contentSwitcher.available")}>
            {ordered.map(({ work, edition: collection }, index) => {
              const selected = work === activeWork;
              return (
                <button
                  key={work}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={busy}
                  onClick={() => selectCollection(collection)}
                  className={[
                    "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition",
                    selected
                      ? "bg-brand-50 text-brand-800 dark:!bg-brand-900 dark:!text-brand-100"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800",
                    index === 0 ? "font-extrabold" : "font-semibold",
                  ].join(" ")}
                >
                  <span className="w-7 shrink-0 text-center" aria-hidden>{selected ? "✓" : ""}</span>
                  <ContentIcon collection={collection} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 truncate">{collection.name}</span>
                  {showLanguage && (
                    <span className="shrink-0 text-[10px] font-extrabold text-slate-400 dark:text-slate-500">
                      {getLanguage(collection.language).badge}
                    </span>
                  )}
                  {/* Alleen beheerders krijgen verborgen content in dit menu. */}
                  {!collection.visibleToUsers && (
                    <span className="ml-auto shrink-0 text-[10px] font-bold uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 rounded-full px-2 py-0.5">
                      {t("contentSwitcher.hidden")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {activeEditions.length > 1 && (
            <div className="mx-auto max-w-2xl px-4 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 pt-2 pb-1.5">
                {t("contentSwitcher.textLanguage")}
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("contentSwitcher.textLanguage")}>
                {activeEditions.map((edition) => {
                  const language = getLanguage(edition.language);
                  const selected = edition.id === active.id;
                  const duplicateLanguage = (languageCounts.get(edition.language) ?? 0) > 1;
                  return (
                    <button
                      key={edition.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={language.nativeName}
                      disabled={busy}
                      onClick={() => selectLanguage(edition)}
                      title={edition.visibleToUsers ? undefined : t("contentSwitcher.hiddenTitle")}
                      className={[
                        "rounded-full px-3 py-1.5 text-sm font-bold border-2 transition",
                        selected
                          ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900 dark:text-brand-100"
                          : "border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300",
                        edition.visibleToUsers ? "" : "border-dashed",
                      ].join(" ")}
                    >
                      {/* Smal scherm: alleen de code; breder: alleen de naam. Allebei
                          tegelijk zonder ruimte ertussen gaf "NLNederlands". */}
                      <span className="sm:hidden">{language.badge}</span>
                      <span className="hidden sm:inline">{duplicateLanguage ? edition.name : language.nativeName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
