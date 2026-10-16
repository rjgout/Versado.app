"use client";

import Link from "next/link";
import { BookOpen, Check, Lock } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { focusRing } from "@/components/versado/styles";
import { artworkFor } from "@/lib/artwork";

// De gedeelde bouwstenen van de leespaden van Stap voor stap, Hoofdstuk voor hoofdstuk en Vrije keuze: één visuele
// familie, drie samenstellingen. Alleen presentatie; de cursuslogica (volgorde, vergrendeling, afronding) komt van de
// server en van src/lib/readingCourses.ts. Illustraties alleen uit het artworkregister (src/lib/artwork.ts), nooit een
// vrij pad, en nooit een vulbeeld: zonder beeld blijft een kaart een verzorgde neutrale Versado-kaart.

/** Basis van elke hoofdstukkaart. */
export const CARD = "rounded-2xl border bg-vs-surface";
/**
 * Ruimte voor de overlopende miniatuur links; de tekst begint pas waar het beeld al grotendeels is weggefaded. Onder 380 px
 * (kleine telefoons, ook met grote tekst) vervalt de miniatuur: de tekst krijgt dan de volle breedte van de kaart.
 */
export const THUMB_PAD = "min-[380px]:pl-[96px]";

export type VisualState = "done" | "current" | "started" | "open" | "locked";

/**
 * Kleine illustratie links op een compacte kaart die horizontaal in de kaartachtergrond overloopt. Alleen een
 * bestaande koppeling uit het register; zonder beeld rendert de aanroeper deze laag niet. Decoratief en lui geladen
 * op miniatuurformaat, zodat honderden hoofdstukken geen honderden grote beelden ophalen.
 */
export function ChapterThumb({ artworkKeys, fadeTo, dimmed = false }: { artworkKeys: string[]; fadeTo: string; dimmed?: boolean }) {
  return (
    <div aria-hidden data-chapter-thumb className="pointer-events-none absolute inset-y-0 left-0 hidden w-[120px] overflow-hidden rounded-l-2xl min-[380px]:block">
      <MediaArtwork
        kind="reading"
        artworkKey={artworkKeys}
        ratio="1/1"
        sizes="120px"
        className={`vs-decor !absolute inset-0 !aspect-auto h-full w-full ${dimmed ? "opacity-45 saturate-50" : "opacity-90"}`}
      />
      <div className={`absolute inset-0 bg-gradient-to-r from-transparent ${dimmed ? "via-vs-subtle/50" : "via-vs-surface/50"} ${fadeTo}`} />
    </div>
  );
}

/** Heeft deze sleutel een echt beeld in het register? Dan krijgt de kaart een miniatuur, anders niet. */
export function hasArtwork(artworkKeys: string[]): boolean {
  return artworkFor(artworkKeys) !== null;
}

/** Kleur van het verbindingsstuk per overgang: voltooid is gedempt accent, de overgang naar het huidige hoofdstuk krijgt het volle accent, toekomstig is neutraal. */
function connectorTone(from: VisualState, to: VisualState): { line: string; top: string; bottom: string } {
  if (to === "current") return { line: "from-vs-accent/30 to-vs-accent", top: "bg-vs-accent/40", bottom: "bg-vs-accent" };
  if (from === "current") return { line: "from-vs-accent to-vs-line-strong", top: "bg-vs-accent", bottom: "bg-vs-line-strong" };
  if (to === "locked") return { line: "from-vs-line-strong to-vs-line-strong/60", top: "bg-vs-line-strong", bottom: "bg-vs-line-strong/60" };
  return { line: "from-vs-accent/40 to-vs-accent/40", top: "bg-vs-accent/40", bottom: "bg-vs-accent/40" };
}

// 18 px hoog: de kleine punten aan de uiteinden raken de kaarten, de lijn ertussen loopt zacht over.
export function Connector({ from, to }: { from: VisualState; to: VisualState }) {
  const tone = connectorTone(from, to);
  return (
    <li aria-hidden data-connector className="pointer-events-none mx-auto flex h-[18px] w-[6px] shrink-0 list-none flex-col items-center">
      <span className={`h-1 w-1 shrink-0 rounded-full ${tone.top}`} />
      <span className={`w-[2px] flex-1 bg-gradient-to-b ${tone.line}`} />
      <span className={`h-1 w-1 shrink-0 rounded-full ${tone.bottom}`} />
    </li>
  );
}

export function Heading({ label, subtitle, muted = false }: { label: string; subtitle: React.ReactNode; muted?: boolean }) {
  return (
    <span className="relative min-w-0 flex-1">
      <span className={`vs-wrap block text-base font-extrabold leading-snug ${muted ? "text-vs-fg-2" : "text-vs-fg"}`}>{label}</span>
      <span className="block text-xs text-vs-fg-3">{subtitle}</span>
    </span>
  );
}

/** Statusicoon rechts binnen een compacte kaart. */
export function DoneMark() {
  const t = useT();
  return (
    <span className="relative shrink-0 text-vs-success">
      <Check size={18} strokeWidth={3} aria-hidden />
      <span className="sr-only">{t("courseView.path.chapterDone")}</span>
    </span>
  );
}

/** Een vergrendeld hoofdstuk: rustig, niet bedienbaar, met een duidelijk slot rechts. */
export function LockedChapterCard({ label, subtitle, artworkKeys }: { label: string; subtitle: React.ReactNode; artworkKeys: string[] }) {
  const t = useT();
  const thumb = hasArtwork(artworkKeys);
  return (
    <div aria-disabled="true" className={`${CARD} relative flex min-h-12 items-center gap-3 border-vs-line !bg-vs-subtle px-3 py-2 ${thumb ? THUMB_PAD : ""}`}>
      {thumb && <ChapterThumb artworkKeys={artworkKeys} fadeTo="to-vs-subtle" dimmed />}
      <Heading label={label} subtitle={subtitle} muted />
      <span className="relative shrink-0 text-vs-fg-2">
        <Lock size={18} strokeWidth={2.25} aria-hidden />
        <span className="sr-only">{t("courseView.path.chapterLocked")}</span>
      </span>
    </div>
  );
}

/**
 * Een bereikbaar hoofdstuk als compacte kaart die naar de les linkt (Hoofdstuk voor hoofdstuk en Vrije keuze).
 * Afgerond: vinkje rechts; begonnen: herkenbare accentrand; anders neutraal.
 */
export function ChapterLinkCard({ href, label, subtitle, artworkKeys, state }: { href: string; label: string; subtitle: React.ReactNode; artworkKeys: string[]; state: "done" | "started" | "open" }) {
  const thumb = hasArtwork(artworkKeys);
  return (
    <div className={`${CARD} relative ${state === "started" ? "border-vs-accent/50 !bg-vs-accent-soft/30" : "border-vs-line"}`} data-chapter-card-state={state}>
      {thumb && <ChapterThumb artworkKeys={artworkKeys} fadeTo={state === "started" ? "to-vs-accent-soft/30" : "to-vs-surface"} />}
      <Link href={href} className={`relative flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${thumb ? THUMB_PAD : ""} ${focusRing}`}>
        <Heading label={label} subtitle={subtitle} />
        {state === "done" && <DoneMark />}
      </Link>
    </div>
  );
}

/**
 * De grote kaart van het huidige hoofdstuk: hogere illustratie met titel en voortgang erop. De kop heeft een eigen
 * donkere basis en gradient, dus de tekst blijft leesbaar terwijl het beeld laadt, ontbreekt of licht is. Zonder beeld
 * een neutrale, lichte Versado-kop. Dubbele omlijning: een verloopkader van 2 px (accent met een klein warm lichtaccent
 * in de hoek) rond de hele kaart, beeldhoeken inbegrepen, plus een zachte gloed. Alleen semantische tokens.
 */
export function ActiveChapterCard({
  label,
  subtitle,
  artworkKeys,
  progress,
  children,
}: {
  label: string;
  subtitle: string;
  artworkKeys: string[];
  /** Optioneel: een voortgangsbalk (Stap voor stap telt stappen). */
  progress?: { now: number; max: number; percent: number };
  children: React.ReactNode;
}) {
  const hasImage = hasArtwork(artworkKeys);
  return (
    <div className="vs-rise rounded-[1.125rem] bg-gradient-to-br from-vs-accent via-vs-accent to-vs-xp-fill p-[2px] shadow-lg shadow-vs-accent/25 ring-[3px] ring-vs-accent/15">
      <article className="overflow-hidden rounded-2xl bg-vs-surface" aria-label={label}>
        <div className={`relative flex flex-col justify-end ${hasImage ? "min-h-[9.5rem] bg-vs-overlay sm:min-h-[11rem]" : "min-h-[6.5rem] bg-gradient-to-br from-vs-accent-soft to-vs-surface"}`}>
          {hasImage ? (
            <>
              <MediaArtwork kind="reading" artworkKey={artworkKeys} ratio="21/9" sizes="(min-width: 1024px) 640px, 100vw" className="vs-decor !absolute inset-0 !aspect-auto h-full w-full" />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-vs-overlay/90 via-vs-overlay/50 to-transparent" />
            </>
          ) : (
            <BookOpen aria-hidden className="pointer-events-none absolute right-3 top-3 h-14 w-14 text-vs-accent opacity-15" strokeWidth={1.5} />
          )}
          <div className="relative flex flex-col gap-1.5 px-[clamp(0.5rem,3vw,0.75rem)] pb-[clamp(0.5rem,3vw,0.75rem)] pt-10">
            <h2 className={`vs-wrap text-xl font-extrabold leading-snug ${hasImage ? "text-white" : "text-vs-fg"}`}>{label}</h2>
            <p className={`text-xs font-semibold ${hasImage ? "text-white/90" : "text-vs-accent"}`}>{subtitle}</p>
            {progress && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.max}
                aria-valuenow={progress.now}
                aria-label={subtitle}
                className={`h-1.5 overflow-hidden rounded-full ${hasImage ? "bg-white/30" : "bg-vs-accent/15"}`}
              >
                <div className="vs-motion h-full rounded-full bg-vs-accent transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
            )}
          </div>
        </div>
        <div className="bg-gradient-to-b from-vs-accent-soft/60 to-vs-surface p-[clamp(0.5rem,3vw,0.75rem)]">{children}</div>
      </article>
    </div>
  );
}
