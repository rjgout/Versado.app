"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Info, Mic, MicOff, Music, Play, RefreshCw, Rows3, Search, Settings2, ShieldCheck, Square, TextQuote, MoreHorizontal } from "lucide-react";
import { MicListener, decodeAudioFile, type MicState } from "@/lib/hymns/audio/micListener";
import { HymnLiveEngine, type LiveState } from "@/lib/hymns/live";
import type { HymnIndexEntry, ReadableHymn, ResolvedHymn } from "@/lib/hymns/types";
import { candidatesFromBundle } from "@/lib/hymns/recognize/candidates";
import { loadHymn, loadHymnIndex, loadRecognitionBundle } from "@/lib/hymnLibraryClient";
import { useHymnPrefs, type HymnTextSize, type HymnView } from "@/lib/hymnPrefs";
import { focusRing, iconButton as baseIconButton, primaryButton, secondaryButton } from "@/components/versado/styles";

// Aanraakdoelen van minstens 44 x 44 px, ook als de tekst groter staat (geen rem: het zijn bedieningselementen).
const iconButton = `${baseIconButton} !h-[44px] !w-[44px]`;
import { COPY, MIC_TEXT, RECOGNITION_TEXT } from "./copy";
import HymnList from "./HymnList";
import LyricsView from "./LyricsView";
import Sheet from "./Sheet";
import TechnicalPanel from "./TechnicalPanel";
import { INITIAL_READING, displayedStanza, focusLine, musicalCursorVisible, navigationTarget, nextSticky, readingReducer, resumeVerdict } from "./reading";
import { useReadingScroll } from "./useReadingScroll";
import { activeSeq, describeStatus, lyricSequence, type StatusTone } from "./viewModel";

// Lofzangen: een intelligent digitaal zangboek. Eén luistersessie voor herkennen en volgen (HymnLiveEngine),
// de tekst staat klaar tijdens het voorspel en loopt pas mee als de zang begint. De weergave (volledig
// couplet of karaoke per regel) is puur presentatie: ze raakt de microfoon, de herkenning en de positie niet.
//
// Indeling (docs/hymns/08-MOBIELE-UX.md): één werkruimte ter hoogte van het scherm onder de terugbalk
// (.hymns-workspace in globals.css) als flex-kolom: een compacte kop, één leesruimte die zelf scrolt en een
// bedieningszone met een eigen gereserveerde plek. Niets ligt over de tekst heen; het document scrolt niet.


function toResolved(h: ReadableHymn): ResolvedHymn | null {
  if (!h.text || !h.composition) return null;
  return { number: h.number, edition: h.edition, text: { ...h.text, compositionId: h.composition.id }, composition: h.composition };
}

const UI_FLUSH_MS = 100;
const IDLE_LIVE: LiveState = { stage: "idle", hymn: null, choice: null, recognition: null, snapshot: null, backlog: 0, needHymn: null };

const TONE: Record<StatusTone, string> = {
  neutral: "bg-vs-subtle text-vs-fg-2",
  ok: "bg-vs-success-soft text-vs-success",
  warn: "bg-vs-warning-soft text-vs-warning",
  danger: "bg-vs-danger-soft text-vs-danger",
  info: "bg-vs-accent-soft text-vs-accent",
};

const VIEWS: { id: HymnView; label: string }[] = [
  { id: "stanza", label: COPY.viewStanza },
  { id: "karaoke", label: COPY.viewKaraoke },
];
const SIZES: { id: HymnTextSize; label: string }[] = [
  { id: "normal", label: COPY.sizeNormal },
  { id: "large", label: COPY.sizeLarge },
  { id: "xlarge", label: COPY.sizeXLarge },
];

type SheetKind = "settings" | "tech" | "order" | null;

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`vs-motion inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-base font-bold ${focusRing} ${
        pressed ? "border-vs-accent bg-vs-accent text-vs-on-accent" : "border-vs-line-strong bg-vs-surface text-vs-fg"
      }`}
    >
      {children}
    </button>
  );
}

export default function HymnsPocClient({ isAdmin = false }: { isAdmin?: boolean }) {
  const [prefs, setPrefs] = useHymnPrefs();
  const [micState, setMicState] = useState<MicState>("idle");
  const [micDetail, setMicDetail] = useState<string | undefined>();
  const [live, setLive] = useState<LiveState>(IDLE_LIVE);
  const [index, setIndex] = useState<HymnIndexEntry[] | null>(null);
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [opened, setOpened] = useState<ReadableHymn | null>(null);
  const [loadingNumber, setLoadingNumber] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [searchSelf, setSearchSelf] = useState(false);
  const [idleStanza, setIdleStanza] = useState<number>(1);
  const [order, setOrder] = useState<number[]>([]);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [testProgress, setTestProgress] = useState<number | null>(null);
  const [testAs, setTestAs] = useState<"recognize" | "follow">("recognize");
  // Twee onafhankelijke posities: de muziek (engine) en de leesplek van de gebruiker (reading.ts).
  const [reading, dispatchReading] = useReducer(readingReducer, INITIAL_READING);
  const [navTick, setNavTick] = useState(0);

  // De engine en de microfoon leven in refs: ze veranderen 20 keer per seconde en mogen geen render per frame veroorzaken.
  const engineRef = useRef<HymnLiveEngine | null>(null);
  const micRef = useRef<MicListener | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const cancelTest = useRef(false);
  const fetchingNeeded = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const settleReadingRef = useRef<() => void>(() => {});

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new HymnLiveEngine([]);
    return engineRef.current;
  }, []);

  const schedule = useCallback((delay: number) => {
    if (flushTimer.current === null) {
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null;
        flushRef.current();
      }, delay);
    }
  }, []);

  useEffect(() => {
    flushRef.current = () => {
      const eng = engineRef.current;
      if (!eng) return;
      // Na een overgang staat het geheugen in de wachtrij: in kleine stukken verwerken zodat de telefoon niet hapert.
      const more = eng.drain(8);
      setLive(eng.state());
      if (more) schedule(0);
    };
  }, [schedule]);

  const handleSamples = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      getEngine().pushAudio(samples, sampleRate, 8);
      schedule(UI_FLUSH_MS);
    },
    [getEngine, schedule]
  );

  const resolved = useMemo(() => (opened ? toResolved(opened) : null), [opened]);
  const hymn: ResolvedHymn | null = live.hymn ?? resolved;
  const displayText = live.hymn?.text ?? opened?.text ?? null;

  useEffect(() => {
    let alive = true;
    loadHymnIndex()
      .then((res) => {
        if (!alive) return;
        setIndex(res.hymns);
        setFromCache(res.fromCache);
        setIndexState("ready");
      })
      .catch(() => {
        if (alive) setIndexState("error");
      });
    return () => {
      alive = false;
    };
  }, [indexAttempt]);

  // Bibliotheekmodus: de herkenning koos een lofzang waarvan de tekst nog niet is geladen. Ophalen en melden aan de engine,
  // die dan vanaf het geheugen volgt (er gaat geen luistertijd verloren en de microfoon blijft gewoon doorlopen).
  useEffect(() => {
    const n = live.needHymn;
    if (n === null || fetchingNeeded.current === n) return;
    fetchingNeeded.current = n;
    loadHymn(n)
      .then((readable) => {
        const res = toResolved(readable);
        if (!res) return;
        setOpened(readable);
        setIdleStanza(readable.text?.stanzas[0]?.n ?? 1);
        getEngine().registerHymn(res);
        schedule(0);
      })
      .catch(() => {})
      .finally(() => {
        fetchingNeeded.current = null;
      });
  }, [live.needHymn, getEngine, schedule]);

  const startListening = useCallback(
    async (intent: "recognize" | "follow") => {
      const eng = getEngine();
      if (intent === "follow" && !hymn) return;
      eng.restart();
      eng.setStanzaOrder(order);
      setSearchSelf(false);
      setMicDetail(undefined);
      dispatchReading({ type: "reset" });
      if (intent === "recognize") {
        // De microfoon start meteen: de herkenningsgegevens komen er tijdens het luisteren bij en de engine loopt dan
        // eerst het geheugen door. Zo gaat het begin van het voorspel niet verloren aan het laden. Tijdens het
        // luisteren gaat er verder geen verzoek meer naar de server.
        const needBundle = !eng.hasCandidates;
        eng.startRecognizing({ awaitCandidates: needBundle });
        if (needBundle) {
          loadRecognitionBundle()
            .then((bundle) => {
              eng.setCandidates(candidatesFromBundle(bundle));
              schedule(0);
            })
            .catch(() => {
              micRef.current?.stop();
              eng.restart();
              setLive(eng.state());
              setMicDetail(COPY.recognitionUnavailable);
            });
        }
      } else if (hymn) {
        // Een zelf gekozen lofzang hoeft niet herkend te worden: direct de muzikale positie volgen.
        eng.registerHymn(hymn);
        eng.followHymn(hymn.number, "manual");
        if (idleStanza !== (hymn.text.stanzas[0]?.n ?? 1)) eng.selectStanza(idleStanza);
      }
      setLive(eng.state());
      if (!micRef.current) {
        micRef.current = new MicListener({
          onSamples: handleSamples,
          onState: (state, detail) => {
            setMicState(state);
            setMicDetail(detail);
            if (state !== "listening") {
              settleReadingRef.current();
              schedule(0);
            }
          },
        });
      }
      await micRef.current.start();
    },
    [getEngine, handleSamples, hymn, idleStanza, order, schedule]
  );

  const stopMic = useCallback(() => {
    micRef.current?.stop();
  }, []);

  /** Terug naar de keuze van een lofzang (alleen als de microfoon uit is). */
  const backToChoose = useCallback(() => {
    const eng = engineRef.current;
    if (eng) {
      eng.restart();
      setLive(eng.state());
    }
    setOpened(null);
    setSearchSelf(false);
    setMicDetail(undefined);
    dispatchReading({ type: "reset" });
  }, []);

  const selectHymn = useCallback(
    async (number: number) => {
      setLoadingNumber(number);
      setOpenError(null);
      try {
        const readable = await loadHymn(number);
        const res = toResolved(readable);
        setOpened(readable);
        setIdleStanza(readable.text?.stanzas[0]?.n ?? 1);
        setOrder([]);
        setSearchSelf(false);
        setSheet(null);
        dispatchReading({ type: "reset" });
        const eng = getEngine();
        if (res) {
          eng.registerHymn(res);
          if (eng.currentStage !== "idle") {
            // Midden in een luistersessie: dezelfde microfoon en extractor, het geheugen wordt opnieuw door de volger gehaald.
            eng.setStanzaOrder([]);
            eng.followHymn(number, "manual");
            schedule(0);
          }
        }
      } catch {
        setOpenError(COPY.hymnError);
      } finally {
        setLoadingNumber(null);
      }
    },
    [getEngine, schedule]
  );

  const onStanzaTap = (n: number) => {
    if (live.stage === "following" && listening && reading.mode === "manual") {
      // Zelf aan het bladeren: alleen de leesplek verandert. De engine houdt zijn eigen couplet en de muziek loopt door.
      dispatchReading({ type: "stanza", stanza: n, following: true });
      return;
    }
    // Handmatige keuze: onmiddellijk tonen, de muziekherkenning loopt ongestoord door.
    dispatchReading({ type: "stanza", stanza: n, following: false });
    setIdleStanza(n);
    engineRef.current?.selectStanza(n);
    schedule(0);
  };

  const toggleOrder = (n: number) => {
    const next = order.includes(n) ? order.filter((x) => x !== n) : [...order, n].sort((a, b) => a - b);
    setOrder(next);
    engineRef.current?.setStanzaOrder(next);
  };

  const clearOrder = () => {
    setOrder([]);
    engineRef.current?.setStanzaOrder([]);
  };

  const confirmSinging = () => {
    engineRef.current?.confirmSingingStart();
    schedule(0);
  };

  const resync = () => {
    engineRef.current?.resync();
    schedule(0);
  };

  // De microfoon stopt bij het verlaten van de pagina en bij het sluiten van dit onderdeel.
  useEffect(() => {
    const stop = () => micRef.current?.stop();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      cancelTest.current = true;
      micRef.current?.stop();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, []);

  const runTestFile = useCallback(
    async (file: File) => {
      cancelTest.current = false;
      const eng = getEngine();
      eng.restart();
      eng.setStanzaOrder(order);
      if (testAs === "recognize") {
        try {
          eng.setCandidates(candidatesFromBundle(await loadRecognitionBundle()));
        } catch {
          return;
        }
        eng.startRecognizing();
      } else if (hymn) {
        eng.registerHymn(hymn);
        eng.followHymn(hymn.number, "manual");
      } else return;
      setLive(eng.state());
      setTestProgress(0);
      try {
        const { samples, sampleRate } = await decodeAudioFile(file);
        const chunk = 4096;
        for (let i = 0; i < samples.length; i += chunk) {
          if (cancelTest.current) break;
          eng.pushAudio(samples.subarray(i, Math.min(samples.length, i + chunk)), sampleRate, Infinity);
          if ((i / chunk) % 24 === 0) {
            setTestProgress(i / samples.length);
            setLive(eng.state());
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      } finally {
        eng.drainAll();
        setLive(eng.state());
        setTestProgress(null);
      }
    },
    [getEngine, hymn, order, testAs]
  );

  const snapshot = live.snapshot;
  const listening = micState === "listening";
  const stage = live.stage;
  const choosing = stage === "idle" && !listening && !opened;
  const stanzaNumbers = (displayText?.stanzas ?? []).map((s) => s.n);
  const following = stage === "following";
  const engineStanza = snapshot ? snapshot.stanza : idleStanza;
  // MusicalPosition (engine) en ReadingPosition (gebruiker) zijn gescheiden: tijdens handmatig lezen bepaalt de gebruiker
  // welk couplet en welke regel getoond worden; de engine gaat intussen gewoon door.
  const shownStanza = displayedStanza(reading, engineStanza, following);
  const stanza = displayText?.stanzas.find((s) => s.n === shownStanza) ?? displayText?.stanzas[0];
  const phase = snapshot?.phase.phase ?? "prelude";
  const status = describeStatus(micState, live);
  const calm = prefs.calm;
  const seq = useMemo(() => (displayText ? lyricSequence(displayText, stanza) : []), [displayText, stanza]);
  const musicCursor = snapshot && musicalCursorVisible(snapshot.stanza, stanza?.n ?? -1) ? snapshot.cursor : undefined;
  const activeIdx = activeSeq(seq, musicCursor);
  const customOrder = order.length > 0 && order.length < stanzaNumbers.length;
  const browsing = following && listening && reading.mode === "manual";
  const hymnKey = `${hymn?.number ?? opened?.number ?? 0}:${stanza?.n ?? 0}`;

  // Verliest de engine tijdelijk zijn regel (onzeker, tussenspel), dan blijft de laatst bekende regel de focus.
  const lastLineKey = `${hymnKey}:${phase === "prelude" ? "voorspel" : "zang"}`;
  const [held, setHeld] = useState({ key: lastLineKey, value: activeIdx });
  const heldNow = nextSticky(held, lastLineKey, activeIdx);
  if (heldNow !== held) setHeld(heldNow);
  const lastLine = heldNow.value;

  const karaoke = prefs.view === "karaoke";
  const focus = karaoke ? focusLine(reading, activeIdx, lastLine, seq.length) : -1;
  const navIndex = navigationTarget(reading, activeIdx, lastLine, seq.length, prefs.view);
  const textShown = !choosing && stage !== "recognizing" && Boolean(displayText);

  useReadingScroll({
    boxRef: scrollRef,
    view: prefs.view,
    active: textShown,
    autoFollow: prefs.autoScroll && following && listening && reading.mode === "auto",
    autoIndex: karaoke ? focus : activeIdx,
    navIndex,
    navTick,
    placeKey: `${hymnKey}:${prefs.view}`,
    smooth: !calm,
    onUserScroll: () => dispatchReading({ type: "scroll", following: following && listening, stanza: shownStanza }),
  });

  const tapLine = (line: number) => {
    dispatchReading({ type: "line", line, following: following && listening, stanza: shownStanza });
    setNavTick((n) => n + 1);
  };
  const stepLine = (dir: 1 | -1) => {
    const from = karaoke ? focus : (reading.line ?? activeIdx);
    dispatchReading({ type: "step", dir, from, count: seq.length, following: following && listening, stanza: shownStanza });
    setNavTick((n) => n + 1);
  };
  const resumeAuto = () => {
    const verdict = resumeVerdict(snapshot, reading.stanza);
    dispatchReading({ type: "resume", verdict });
    if (verdict.ok) setNavTick((n) => n + 1);
  };

  // De melding "nog niet zeker genoeg" verdwijnt vanzelf; de leesplek blijft.
  useEffect(() => {
    if (!reading.note) return;
    const t = setTimeout(() => dispatchReading({ type: "clearNote" }), 6000);
    return () => clearTimeout(t);
  }, [reading.note]);

  // Stopt de microfoon terwijl de gebruiker zelf bladert, dan blijft staan wat hij leest: die keuze wordt van de engine.
  useEffect(() => {
    settleReadingRef.current = () => {
      if (reading.mode !== "manual") return;
      if (reading.stanza !== null) {
        if (snapshot && snapshot.stanza !== reading.stanza) engineRef.current?.selectStanza(reading.stanza);
        setIdleStanza(reading.stanza);
      }
      dispatchReading({ type: "reset" });
    };
  }, [reading.mode, reading.stanza, snapshot]);

  const recog = live.recognition;
  const suggestion = recog?.suggestion ?? null;
  // Dezelfde melodie bij meerdere lofzangen: de muziek kan de tekst niet bepalen, dus laten we kiezen (geen gok).
  const shared = suggestion && suggestion.sharedWith.length > 0 ? [{ number: suggestion.number, title: suggestion.title }, ...suggestion.sharedWith] : null;
  const candidates = suggestion ? [] : (recog?.ranking ?? []).filter((c) => c.z >= 3).sort((a, b) => b.z - a.z).slice(0, 4);
  const slow = (recog?.heardSeconds ?? 0) >= 15 || recog?.status === "unknown";
  const leadNumber = suggestion?.number ?? null;
  // De tekst van de waarschijnlijkste lofzang alvast laden (alleen naar het lokale geheugen): tikken of automatisch volgen toont hem direct.
  useEffect(() => {
    if (leadNumber !== null) void loadHymn(leadNumber).catch(() => {});
  }, [leadNumber]);
  const shownNumber = hymn?.number ?? opened?.number;
  const title = choosing ? COPY.choose : stage === "recognizing" ? COPY.recognizing : `${shownNumber}. ${displayText?.title ?? opened?.title ?? ""}`;
  const canFollow = Boolean(hymn);

  const viewToggle = (
    <button
      type="button"
      className={iconButton}
      data-hymns-view-toggle
      aria-label={prefs.view === "stanza" ? COPY.viewToggleToKaraoke : COPY.viewToggleToStanza}
      title={prefs.view === "stanza" ? COPY.viewKaraoke : COPY.viewStanza}
      onClick={() => setPrefs({ view: prefs.view === "stanza" ? "karaoke" : "stanza" })}
    >
      {prefs.view === "stanza" ? <TextQuote className="h-5 w-5" aria-hidden="true" /> : <Rows3 className="h-5 w-5" aria-hidden="true" />}
    </button>
  );

  return (
    <div className="hymns-workspace" data-hymns-view={prefs.view} data-hymns-calm={calm ? "true" : "false"}>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-2">
        <header className="shrink-0 space-y-1.5 pt-2">
          <div className="flex items-start justify-between gap-2">
            <h1 className="vs-wrap min-w-0 text-xl font-bold leading-tight text-vs-fg">{title}</h1>
            <div className="-mr-2 flex shrink-0 items-center">
              {textShown ? viewToggle : null}
              <button
                type="button"
                className={iconButton}
                data-hymns-settings
                aria-label={COPY.settings}
                aria-haspopup="dialog"
                onClick={() => setSheet("settings")}
              >
                <Settings2 className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {!choosing && (canFollow || stage === "recognizing") ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {status ? (
                <span
                  role="status"
                  aria-live="polite"
                  data-hymns-status
                  className={calm ? "text-sm font-semibold text-vs-fg-2" : `rounded-full px-2.5 py-0.5 text-sm font-bold ${TONE[status.tone]}`}
                >
                  {status.label}
                </span>
              ) : null}
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-vs-fg-2" data-hymns-mic>
                {listening ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-vs-danger" aria-hidden="true" />
                    <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </>
                ) : (
                  <MicOff className="h-4 w-4 shrink-0 text-vs-fg-3" aria-hidden="true" />
                )}
                <span className="vs-wrap">{MIC_TEXT[micState]}</span>
              </p>
            </div>
          ) : null}
          {status?.hint ? <p className="vs-wrap text-sm text-vs-fg-3">{status.hint}</p> : null}
          {micDetail && micState !== "listening" ? <p className="vs-wrap text-sm text-vs-fg-3">{micDetail}</p> : null}

          {!choosing && stage !== "recognizing" && stanzaNumbers.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={COPY.stanzaLabel}>
              <span className="mr-1 hidden text-sm font-semibold text-vs-fg-2 sm:inline" aria-hidden="true">
                {COPY.stanzaLabel}
              </span>
              {stanzaNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={n === shownStanza}
                  aria-label={`${COPY.stanzaLabel} ${n}`}
                  onClick={() => onStanzaTap(n)}
                  className={`vs-motion inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border px-2 text-base font-bold ${focusRing} ${
                    n === shownStanza ? "border-vs-accent bg-vs-accent text-vs-on-accent" : "border-vs-line-strong bg-vs-surface text-vs-fg"
                  }`}
                >
                  {n}
                </button>
              ))}
              {canFollow ? (
                <>
              <button type="button" className={iconButton} data-hymns-order aria-label={COPY.stanzaMore} aria-haspopup="dialog" onClick={() => setSheet("order")}>
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </button>
              {customOrder ? (
                <span className="text-sm text-vs-fg-3" data-hymns-order-label>
                  {order.join(" → ")}
                </span>
              ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </header>

        {choosing ? (
          <section aria-label={COPY.choose} className="min-h-[7rem] flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2" data-hymns-choose>
            {indexState === "loading" ? (
              <p className="text-base text-vs-fg-2" role="status">
                {COPY.libraryLoading}
              </p>
            ) : indexState === "error" || !index ? (
              <div className="space-y-2" role="alert">
                <p className="text-base text-vs-fg-2">{COPY.libraryError}</p>
                <button type="button" className={secondaryButton} onClick={() => {
                    setIndexState("loading");
                    setIndexAttempt((n) => n + 1);
                  }}>
                  {COPY.libraryRetry}
                </button>
              </div>
            ) : (
              <>
                {fromCache ? <p className="text-sm text-vs-fg-3">{COPY.libraryOffline}</p> : null}
                <HymnList entries={index} selected={null} loadingNumber={loadingNumber} onSelect={(n) => void selectHymn(n)} />
              </>
            )}
            {openError ? (
              <p className="text-sm text-vs-danger" role="alert">
                {openError}
              </p>
            ) : null}
            <p className="flex items-start gap-2 text-sm text-vs-fg-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="vs-wrap">
                {COPY.privacyShort} {COPY.chooseShort}{" "}
                <button type="button" className={`font-semibold underline ${focusRing}`} onClick={() => setSheet("settings")}>
                  {COPY.info}
                </button>
              </span>
            </p>
          </section>
        ) : (
          <div className="relative min-h-[7rem] flex-1">
            <div
              ref={scrollRef}
              role="region"
              aria-label={COPY.lyricsRegion}
              tabIndex={0}
              data-hymns-scroll
              className={`h-full overflow-y-auto overscroll-contain ${focusRing}`}
            >
              {stage === "recognizing" ? (
                <section aria-label={COPY.recognizing} className="space-y-4 py-3" data-hymns-recognition>
                  <div className="flex items-center gap-3">
                    <span className="hymn-listening-dot h-3 w-3 shrink-0 rounded-full bg-vs-accent" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-vs-fg" role="status" aria-live="polite" data-hymns-recognition-status>
                        {RECOGNITION_TEXT[live.recognition?.status ?? "listening"]}
                      </p>
                      <p className="text-sm text-vs-fg-3">{COPY.recognizingHint}</p>
                    </div>
                  </div>
                  {shared ? (
                    <div className="space-y-2" data-hymns-shared>
                      <p className="text-sm text-vs-fg-2">{COPY.sharedMelody}</p>
                      <ul className="flex flex-col gap-2">
                        {shared.map((c) => (
                          <li key={c.number}>
                            <button type="button" className={`${secondaryButton} w-full justify-start !rounded-xl text-left`} onClick={() => void selectHymn(c.number)}>
                              <span className="vs-wrap">
                                {c.number}. {c.title}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : suggestion && recog?.status === "suggested" ? (
                    <div className="space-y-2" data-hymns-suggestion>
                      <p className="text-sm text-vs-fg-3">{COPY.suggestionHelp}</p>
                      <button type="button" className={`${primaryButton} w-full justify-start !rounded-xl text-left`} onClick={() => void selectHymn(suggestion.number)}>
                        <span className="vs-wrap">
                          {suggestion.number}. {suggestion.title}
                        </span>
                      </button>
                    </div>
                  ) : candidates.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-vs-fg-3">{COPY.candidatesHelp}</p>
                      <ul className="flex flex-col gap-2">
                        {candidates.map((c) => (
                          <li key={c.id}>
                            <button type="button" className={`${secondaryButton} w-full justify-start !rounded-xl text-left`} onClick={() => void selectHymn(c.number)}>
                              <span className="vs-wrap">
                                {c.number}. {c.title}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {!searchSelf ? (
                    <div className="space-y-2" data-hymns-slow={slow ? "true" : undefined}>
                      {slow ? <p className="text-sm text-vs-fg-2">{COPY.recognizingSlow}</p> : null}
                      <button type="button" className={secondaryButton} data-hymns-search-self onClick={() => setSearchSelf(true)}>
                        <Search className="h-4 w-4" aria-hidden="true" />
                        {COPY.searchSelf}
                      </button>
                    </div>
                  ) : null}
                  {searchSelf && index ? <HymnList entries={index} selected={null} loadingNumber={loadingNumber} onSelect={(n) => void selectHymn(n)} autoFocus /> : null}
                </section>
              ) : displayText ? (
                <>
                  {opened && !canFollow ? <p className="mb-3 rounded-xl bg-vs-subtle p-3 text-sm text-vs-fg-2" data-hymns-text-only>{COPY.textOnlyNote}</p> : null}
                  <LyricsView text={displayText} stanza={stanza} cursor={musicCursor} view={prefs.view} size={prefs.size} focus={focus} reading={reading.line} onLineTap={tapLine} />
                  {stanza?.linking === "line" && prefs.view === "stanza" && canFollow ? <p className="mt-3 text-xs text-vs-fg-3">{COPY.lineFallbackNote}</p> : null}
                  {displayText.musicCredit || displayText.textCredit ? (
                    <p className="mt-6 text-xs text-vs-fg-3" data-hymns-credits>
                      {displayText.textCredit ? `Tekst: ${displayText.textCredit}` : ""}
                      {displayText.textCredit && displayText.musicCredit ? " · " : ""}
                      {displayText.musicCredit ? `Muziek: ${displayText.musicCredit}` : ""}
                    </p>
                  ) : null}
                </>
              ) : opened ? (
                <p className="rounded-xl bg-vs-subtle p-3 text-base text-vs-fg-2" role="status" data-hymns-license>
                  {opened.unavailableReason === "license" ? COPY.licenseNote : COPY.hymnError}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <div data-hymns-controls className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-vs-line pt-2">
          {textShown && (karaoke || browsing) ? (
            <div data-hymns-reading className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <div role="group" aria-label={COPY.readingNav} className="-ml-2 flex items-center">
                <button type="button" className={iconButton} data-hymns-prev aria-label={COPY.previousLine} title={COPY.previousLine} onClick={() => stepLine(-1)}>
                  <ChevronUp className="h-5 w-5" aria-hidden="true" />
                </button>
                <button type="button" className={iconButton} data-hymns-next aria-label={COPY.nextLine} title={COPY.nextLine} onClick={() => stepLine(1)}>
                  <ChevronDown className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              {browsing ? (
                <>
                  <span className="text-sm font-semibold text-vs-fg-2" data-hymns-browsing>
                    {COPY.browsing}
                  </span>
                  {snapshot && snapshot.stanza !== shownStanza ? (
                    <span className="text-sm text-vs-fg-3" data-hymns-music-stanza>
                      {COPY.musicInStanza} {snapshot.stanza}
                    </span>
                  ) : null}
                  <button type="button" className={`${secondaryButton} !min-h-[44px]`} data-hymns-resume onClick={resumeAuto}>
                    {COPY.resumeAuto}
                  </button>
                </>
              ) : null}
              {reading.note ? (
                <p className="vs-wrap basis-full text-sm text-vs-fg-3" role="status" data-hymns-resume-note>
                  {reading.note === "lost" ? COPY.resumeLost : reading.note === "waiting" ? COPY.resumeWaiting : COPY.resumeUnsure}
                </p>
              ) : null}
            </div>
          ) : null}
          <div data-hymns-bar className="ml-auto flex flex-wrap items-center justify-end gap-2 [&_button]:!min-h-[44px]">
          {listening ? (
            <>
              {stage === "following" && phase === "prelude" ? (
                <button type="button" className={primaryButton} onClick={confirmSinging} title={COPY.singingStartsHelp}>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {COPY.singingStarts}
                </button>
              ) : null}
              {stage === "following" && phase !== "prelude" ? (
                <button type="button" className={secondaryButton} onClick={resync}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {COPY.resync}
                </button>
              ) : null}
              <button type="button" className={secondaryButton} onClick={stopMic}>
                <Square className="h-4 w-4" aria-hidden="true" />
                {COPY.stop}
              </button>
            </>
          ) : choosing ? (
            <button type="button" className={primaryButton} onClick={() => void startListening("recognize")} disabled={micState === "requesting" || indexState !== "ready"}>
              <Music className="h-4 w-4" aria-hidden="true" />
              {COPY.recognize}
            </button>
          ) : (
            <>
              <button type="button" className={secondaryButton} onClick={backToChoose}>
                {COPY.otherHymn}
              </button>
              {stage === "recognizing" || canFollow ? (
                <button
                  type="button"
                  className={primaryButton}
                  onClick={() => void startListening(stage === "recognizing" ? "recognize" : "follow")}
                  disabled={micState === "requesting"}
                >
                  <Mic className="h-4 w-4" aria-hidden="true" />
                  {COPY.start}
                </button>
              ) : null}
            </>
          )}
          </div>
        </div>
      </div>

      {sheet === "settings" ? (
        <Sheet title={COPY.settings} onClose={() => setSheet(null)}>
          {!choosing && index ? (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-vs-fg-2">{COPY.hymnLabel}</h3>
              <div className="max-h-[40dvh] overflow-y-auto overscroll-contain">
                <HymnList entries={index} selected={hymn?.number ?? opened?.number ?? null} loadingNumber={loadingNumber} onSelect={(n) => void selectHymn(n)} />
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-vs-fg-2">{COPY.viewTitle}</h3>
            <div role="group" aria-label={COPY.viewTitle} className="flex flex-wrap gap-2">
              {VIEWS.map((v) => (
                <Choice key={v.id} pressed={prefs.view === v.id} onClick={() => setPrefs({ view: v.id })}>
                  {v.label}
                </Choice>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-vs-fg-2">{COPY.sizeTitle}</h3>
            <div role="group" aria-label={COPY.sizeTitle} className="flex flex-wrap gap-2">
              {SIZES.map((s) => (
                <Choice key={s.id} pressed={prefs.size === s.id} onClick={() => setPrefs({ size: s.id })}>
                  {s.label}
                </Choice>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-vs-fg-2">{COPY.displayTitle}</h3>
            <label className="flex min-h-11 items-center gap-3 text-base text-vs-fg">
              <input type="checkbox" className={`h-5 w-5 shrink-0 ${focusRing}`} style={{ accentColor: "rgb(var(--vs-accent))" }} checked={prefs.autoScroll} onChange={(e) => setPrefs({ autoScroll: e.target.checked })} />
              <span className="vs-wrap">{COPY.autoScroll}</span>
            </label>
            <label className="flex min-h-11 items-center gap-3 text-base text-vs-fg">
              <input type="checkbox" className={`h-5 w-5 shrink-0 ${focusRing}`} style={{ accentColor: "rgb(var(--vs-accent))" }} checked={prefs.calm} onChange={(e) => setPrefs({ calm: e.target.checked })} />
              <span className="vs-wrap">{COPY.calm}</span>
            </label>
          </div>
          <details className="rounded-xl border border-vs-line px-3" data-hymns-privacy>
            <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-bold text-vs-fg-2 ${focusRing}`}>
              <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
              {COPY.infoTitle}
            </summary>
            <div className="space-y-2 pb-3">
              <p className="vs-wrap text-sm text-vs-fg-2">{COPY.intro}</p>
              <p className="vs-wrap flex items-start gap-2 rounded-xl bg-vs-accent-soft p-3 text-sm text-vs-fg-2">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-vs-accent" aria-hidden="true" />
                <span>{COPY.privacy}</span>
              </p>
            </div>
          </details>
          {isAdmin ? (
            <button type="button" className={`${secondaryButton} w-full`} data-hymns-technical-open onClick={() => setSheet("tech")}>
              {COPY.technical}
            </button>
          ) : null}
        </Sheet>
      ) : null}

      {sheet === "order" ? (
        <Sheet title={COPY.orderTitle} onClose={() => setSheet(null)}>
          <p className="text-sm text-vs-fg-2">{COPY.orderHelp}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={COPY.orderTitle}>
            {stanzaNumbers.map((n) => (
              <Choice key={n} pressed={order.includes(n)} onClick={() => toggleOrder(n)}>
                {n}
              </Choice>
            ))}
          </div>
          <p className="text-sm font-semibold text-vs-fg">{order.length > 0 ? `${COPY.orderPrefix}: ${order.join(" → ")}` : COPY.orderAll}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={clearOrder} disabled={order.length === 0}>
              {COPY.orderAll}
            </button>
            <button type="button" className={primaryButton} onClick={() => setSheet(null)}>
              {COPY.orderDone}
            </button>
          </div>
        </Sheet>
      ) : null}

      {sheet === "tech" && isAdmin ? (
        <Sheet title={COPY.technical} tall onClose={() => setSheet(null)}>
          <TechnicalPanel micState={micState} live={live} testProgress={testProgress} testAs={testAs} onTestAs={setTestAs} onFile={(f) => void runTestFile(f)} />
        </Sheet>
      ) : null}
    </div>
  );
}
