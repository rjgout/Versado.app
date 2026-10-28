"use client";

import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useEffect, useState, type RefObject } from "react";
import { getLanguage } from "@/lib/languages";
import { useReadAloudPlayer, type ReadAloudSource, type ReadAloudVerse } from "@/lib/readAloudPlayerContext";

interface Props {
  sourceId: string;
  title: string;
  verses: ReadAloudVerse[];
  audio?: ReadAloudSource["audio"];
  startVerse?: number;
  subtitle?: string;
  /** Taal van de tekst, voor de computerstem (zie ReadAloudSource). */
  language?: string;
  /** Laat de pagina bewust vanaf een vers starten, met de taal en bron die hier gekozen zijn. */
  controlRef?: RefObject<ReadAloudControl | null>;
  /** Laden, gereed of mislukt: alleen "ready" garandeert dat een gerichte start de juiste audiotaal en bron kent. */
  onStatusChange?: (status: ReadAloudStatus) => void;
}

export type ReadAloudStatus = "loading" | "ready" | "error";

export interface ReadAloudControl {
  /** Moet synchroon vanuit een echte klik worden aangeroepen; false als het vers niet voorleesbaar is. */
  startAtVerse(number: number): boolean;
  /** Dezelfde nieuwe poging als de knop in de speler. */
  retry(): void;
}

interface AudioEdition {
  language: string;
  url: string | null;
  legacyFallback?: {url:string;starts:{number:number;audioStart:number|null}[]} | null;
  verses: ReadAloudVerse[];
}

const LANGUAGE_KEY = "jehovaapp-read-aloud-language";

export default function ReadAloudPlayer({ sourceId, title, verses, audio, startVerse = 0, subtitle, language, controlRef, onStatusChange }: Props) {
  const t = useT();
  const { source, start, stop, currentIndex } = useReadAloudPlayer();
  const [editions, setEditions] = useState<{ id: string; items: AudioEdition[] } | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    try { setPreferredLanguage(localStorage.getItem(LANGUAGE_KEY) ?? ""); } catch { /* Opslag kan geblokkeerd zijn. */ }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch(`/api/chapters/${encodeURIComponent(sourceId)}/audio-languages`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Audiotalen laden mislukt.");
        const data = await response.json() as { editions: AudioEdition[] };
        if (!controller.signal.aborted) setEditions({ id: sourceId, items: data.editions });
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [sourceId, attempt]);

  const available = editions?.id === sourceId ? editions.items.filter((edition) =>
    verses.every((verse) => edition.verses.some((item) => item.number === verse.number))
  ) : [];
  const textLanguage = language ?? "nl";
  const selected = available.find((edition) => edition.language === preferredLanguage)
    ?? available.find((edition) => edition.language === textLanguage);
  const selectedLanguage = selected?.language ?? textLanguage;
  const spokenVerses = selected
    ? verses.map((verse) => selected.verses.find((item) => item.number === verse.number)!)
    : verses;
  const verseAfter = selected?.verses.find((verse) => verse.number === (verses.at(-1)?.number ?? 0) + 1);
  // Zonder eindtijd zou een korte leesles doorlopen naar de volgende les.
  const selectedAudio = selected
    ? selected.url && (!verseAfter || verseAfter.audioStart != null)
      ? { url: selected.url, end: verseAfter?.audioStart ?? null, fallback:selected.legacyFallback&&(!verseAfter||selected.legacyFallback.starts.find(v=>v.number===verseAfter.number)?.audioStart!=null) ? {
        url:selected.legacyFallback.url,
        end:verseAfter ? selected.legacyFallback.starts.find(v=>v.number===verseAfter.number)?.audioStart??null : null,
        verses:spokenVerses.map(v=>({...v,audioStart:selected.legacyFallback!.starts.find(s=>s.number===v.number)?.audioStart??null})),
      } : null } : null
    : audio;
  const active = source?.id === sourceId
    && source.language === selectedLanguage
    && source.verses[0]?.number === verses[0]?.number
    && source.verses.at(-1)?.number === verses.at(-1)?.number;

  // Een mislukte opvraag is geen "gereed": anders zou een gekozen audiotaal stilzwijgend door de tekstlaag vervangen worden.
  const status: ReadAloudStatus = editions?.id === sourceId ? "ready" : failed ? "error" : "loading";
  useEffect(() => {
    onStatusChange?.(status);
    return () => onStatusChange?.("loading");
  }, [status, onStatusChange]);

  // Elke commit ververst de koppeling, zodat een klik altijd de actuele taal en bron ziet.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      startAtVerse(number) {
        if (status !== "ready") return false;
        const index = spokenVerses.findIndex((verse) => verse.number === number);
        if (index < 0) return false;
        start({ id: sourceId, title, verses: spokenVerses, audio: selectedAudio, language: selectedLanguage }, index);
        return true;
      },
      retry() {
        setAttempt((value) => value + 1);
      },
    };
  });
  useEffect(() => () => { if (controlRef) controlRef.current = null; }, [controlRef]);

  function changeLanguage(value: string) {
    if (source?.id === sourceId) stop();
    setPreferredLanguage(value);
    try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* De keuze blijft voor deze pagina bruikbaar. */ }
  }

  return (
    <div className="space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {t("player.audioLanguage")}
        <AppSelect className="input w-auto" value={selectedLanguage} onChange={changeLanguage} ariaLabel={t("player.audioLanguage")} options={[{ value: textLanguage, label: getLanguage(textLanguage).nativeName }, ...available.filter((edition) => edition.language !== textLanguage).map((edition) => ({ value: edition.language, label: getLanguage(edition.language).nativeName }))]} />
      </label>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("player.audioLanguageHint")}</p>
      {failed && <button className="text-sm underline" onClick={() => setAttempt((value) => value + 1)}>{t("player.retryLanguages")}</button>}
      {!failed && editions?.id !== sourceId && <p role="status" className="text-xs text-slate-500">{t("misc.loadingEllipsis")}</p>}
      {!active && <button
      disabled={!failed && editions?.id !== sourceId}
      onClick={() => {
        const currentNumber = source?.id === sourceId ? source.verses[currentIndex]?.number : undefined;
        const index = spokenVerses.findIndex((verse) => verse.number === currentNumber);
        start({ id: sourceId, title, verses: spokenVerses, audio: selectedAudio, language: selectedLanguage }, index >= 0 ? index : startVerse);
      }}
      className="w-full rounded-2xl bg-brand-50 dark:bg-slate-800 border border-brand-100 dark:border-slate-700 px-4 py-3 flex items-center gap-3 text-left disabled:opacity-50"
    >
      <span className="shrink-0 w-9 h-9 rounded-full bg-brand-500 text-white flex items-center justify-center text-lg" aria-hidden>
        ▶
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-brand-700 dark:text-brand-300">{t("player.readAloud")}</span>
        <span className="block text-xs text-slate-400 dark:text-slate-500">{subtitle ?? t("player.listenChapter")}</span>
      </span>
    </button>}
    </div>
  );
}
