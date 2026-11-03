"use client";

import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useEffect, useState, type RefObject } from "react";
import { getLanguage } from "@/lib/languages";
import { useReadAloudPlayer, type ReadAloudSource, type ReadAloudVerse } from "@/lib/readAloudPlayerContext";

interface Props {
  adapter?: ReadAloudAdapter;
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

export interface AudioEdition {
  language: string;
  url: string | null;
  legacyFallback?: {url:string;starts:{number:number;audioStart:number|null}[]} | null;
  verses: ReadAloudVerse[];
  native?: ReadAloudSource["native"];
}
export interface ReadAloudAdapter {
  editions: AudioEdition[];
  voices: {id:string;name:string;language:string}[];
  native: NonNullable<ReadAloudSource["native"]>;
  status: ReadAloudStatus;
  retry():void;
}

const LANGUAGE_KEY = "jehovaapp-read-aloud-language";

export default function ReadAloudPlayer({ sourceId, title, verses, audio, startVerse = 0, subtitle, language, controlRef, onStatusChange, adapter }: Props) {
  const t = useT();
  const textLanguage = language ?? "nl";
  const { source, start, stop, currentIndex } = useReadAloudPlayer();
  const [editions, setEditions] = useState<{ id: string; items: AudioEdition[] } | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mode,setMode]=useState("recording"),[voiceId,setVoiceId]=useState("");

  useEffect(() => {
    try { if(!adapter)setPreferredLanguage(localStorage.getItem(LANGUAGE_KEY) ?? ""); if(adapter)setVoiceId(localStorage.getItem(`jehovaapp-read-aloud-device-voice-${textLanguage}`)??(textLanguage==="nl"?localStorage.getItem("jehovaapp-read-aloud-voice"):null)??""); } catch { /* Opslag kan geblokkeerd zijn. */ }
  }, [!!adapter,textLanguage]);

  useEffect(() => {
    if(adapter)return;
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
  }, [sourceId, attempt, adapter]);

  const available = (adapter?.editions ?? (editions?.id === sourceId ? editions.items : [])).filter((edition) =>
    verses.every((verse) => edition.verses.some((item) => item.number === verse.number))
  );
  const recording = available.find((edition) => edition.language === preferredLanguage)
    ?? available.find((edition) => edition.language === textLanguage);
  const deviceVoices=adapter?.voices.filter(voice=>voice.language.split(/[-_]/)[0]===textLanguage)??[];
  const voice=deviceVoices.find(voice=>voice.id===voiceId)??deviceVoices[0];
  const useTts=!!adapter&&(mode==="tts"||!recording);
  const selected=useTts?undefined:recording;
  const selectedNative=adapter ? {...(selected?.native??adapter.native),...(useTts&&voice?{voiceId:voice.id}:{})} : undefined;
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
  const status: ReadAloudStatus = adapter ? adapter.status!=="ready"?adapter.status:(!selected&&!voice)?"error":"ready" : editions?.id === sourceId ? "ready" : failed ? "error" : "loading";
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
        start({ id: sourceId, title, verses: spokenVerses, audio: selectedAudio, language: selectedLanguage, native:selectedNative }, index);
        return true;
      },
      retry() {
        if(adapter)adapter.retry();else setAttempt((value) => value + 1);
      },
    };
  });
  useEffect(() => () => { if (controlRef) controlRef.current = null; }, [controlRef]);

  function changeLanguage(value: string) {
    if (source?.id === sourceId) stop();
    setPreferredLanguage(value);
    if(adapter)setMode("recording");
    try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* De keuze blijft voor deze pagina bruikbaar. */ }
  }

  return (
    <div className="space-y-2" data-read-aloud-controls>
      {adapter&&<><label className="flex flex-wrap gap-2 text-sm font-semibold">{t("player.nativeOutput")}<AppSelect value={useTts?"tts":"recording"} onChange={value=>{stop();setMode(value);}} ariaLabel={t("player.nativeOutput")} options={[...(recording?[{value:"recording",label:t("player.nativeRecording")}]:[]),...(voice?[{value:"tts",label:t("player.nativeDeviceVoice")}]:[])]}/></label>{useTts&&voice&&<label className="flex flex-wrap gap-2 text-sm">{t("player.nativeDeviceVoice")}<AppSelect value={voice.id} onChange={value=>{stop();setVoiceId(value);try{localStorage.setItem(`jehovaapp-read-aloud-device-voice-${textLanguage}`,value);}catch{}}} ariaLabel={t("player.nativeDeviceVoice")} options={deviceVoices.map(item=>({value:item.id,label:item.name}))}/></label>}</>}
      <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {t("player.audioLanguage")}
        <AppSelect className="input w-auto" value={selectedLanguage} onChange={changeLanguage} ariaLabel={t("player.audioLanguage")} options={[{ value: textLanguage, label: getLanguage(textLanguage).nativeName }, ...available.filter((edition) => edition.language !== textLanguage).map((edition) => ({ value: edition.language, label: getLanguage(edition.language).nativeName }))]} />
      </label>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("player.audioLanguageHint")}</p>
      {(failed||adapter?.status==="error") && <button className="text-sm underline" onClick={() => adapter?adapter.retry():setAttempt((value) => value + 1)}>{t("player.retryLanguages")}</button>}
      {status==="loading" && <p role="status" className="text-xs text-slate-500">{t("misc.loadingEllipsis")}</p>}
      {adapter&&status==="error"&&<p role="status">{t("player.nativeUnavailable")}</p>}
      {!active && <button
      disabled={adapter?status!=="ready":!failed && editions?.id !== sourceId}
      onClick={() => {
        const currentNumber = source?.id === sourceId ? source.verses[currentIndex]?.number : undefined;
        const index = spokenVerses.findIndex((verse) => verse.number === currentNumber);
        start({ id: sourceId, title, verses: spokenVerses, audio: selectedAudio, language: selectedLanguage, native:selectedNative }, index >= 0 ? index : startVerse);
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
