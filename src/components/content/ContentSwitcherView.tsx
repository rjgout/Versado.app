"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AppLink } from "@/components/navigation/AppNavigation";
import { ChevronDown } from "lucide-react";
import { getLanguage } from "@/lib/languages";
import { useT } from "@/components/I18nProvider";
import ContentIcon from "@/components/versado/ContentIcon";
import { contentAbbreviation } from "@/lib/contentMetadata";
import type { ContentCollectionView } from "@/lib/contentCollections";

type LabelMode = "full" | "short" | "icon";

/** De publieke kiezer is een gewone Focus-route; alleen de triggerbreedte meten. */
export default function ContentSwitcherView({ enabled, active, showLanguage, onNavigate }: {
  enabled: boolean; active: ContentCollectionView; showLanguage: boolean; onNavigate: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLAnchorElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const chevronRef = useRef<SVGSVGElement>(null);
  const fullLabelRef = useRef<HTMLSpanElement>(null);
  const shortLabelRef = useRef<HTMLSpanElement>(null);
  const [labelMode, setLabelMode] = useState<LabelMode>("full");
  const [fullTriggerWidth, setFullTriggerWidth] = useState<number | null>(null);
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
  }, [enabled, active.id, active.name, active.language, shortName]);

  if (!enabled) return null;
  return (
    <div ref={ref} data-kompas-target="content-switcher"
      className="relative -ml-2 self-stretch flex min-w-[4.5rem] max-w-full flex-1 lg:max-w-[18rem] lg:flex-[0_1_var(--vs-switcher-full,18rem)]"
      style={fullTriggerWidth ? ({ "--vs-switcher-full": `${fullTriggerWidth}px` } as CSSProperties) : undefined}>
      <AppLink ref={buttonRef} href="/content" prefetch={false}
        onNavigate={onNavigate}
        title={active.name}
        aria-label={t("contentSwitcher.activeAria", { name: active.name + (showLanguage ? ` (${getLanguage(active.language).nativeName})` : "") })}
        className="h-full w-fit max-w-full min-w-0 inline-flex items-center justify-start gap-1.5 rounded-xl px-2 text-sm font-bold text-vs-fg-2 hover:text-vs-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">
        <span ref={iconRef} className="shrink-0"><ContentIcon collection={active} className="h-7 w-7" /></span>
        <span className="pointer-events-none absolute -left-[9999px] whitespace-nowrap" aria-hidden>
          <span ref={fullLabelRef} className="block w-max">{active.name}</span>
          {shortName && <span ref={shortLabelRef} className="block w-max">{shortName}</span>}
        </span>
        {labelMode !== "icon" && <span className="block shrink-0 whitespace-nowrap">{labelMode === "short" && shortName ? shortName : active.name}</span>}
        <ChevronDown ref={chevronRef} className="h-4 w-4 shrink-0" aria-hidden />
      </AppLink>
    </div>
  );
}
