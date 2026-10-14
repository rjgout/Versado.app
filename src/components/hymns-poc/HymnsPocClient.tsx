"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ChevronDown, Mic, MicOff, Music, Play, RefreshCw, Settings2, ShieldCheck, Square } from "lucide-react";
import { POC_LIBRARY, listHymns } from "@/lib/hymns/library";
import { MicListener, decodeAudioFile, type MicState } from "@/lib/hymns/audio/micListener";
import { HymnLiveEngine, type LiveState } from "@/lib/hymns/live";
import type { ResolvedHymn } from "@/lib/hymns/types";
import { useHymnPrefs, type HymnTextSize, type HymnView } from "@/lib/hymnPrefs";
import { focusRing, primaryButton, secondaryButton, surfaceCard, iconButton } from "@/components/versado/styles";
import { COPY, MIC_TEXT, RECOGNITION_TEXT } from "./copy";
import LyricsView from "./LyricsView";
import TechnicalPanel from "./TechnicalPanel";
import { useFollowScroll } from "./useFollowScroll";
import { activeSeq, describeStatus, lyricSequence, type StatusTone } from "./viewModel";

// Lofzangen: een intelligent digitaal zangboek. Eén luistersessie voor herkennen en volgen (HymnLiveEngine),
// de tekst staat klaar tijdens het voorspel en loopt pas mee als de zang begint. De weergave (volledig
// couplet of karaoke per regel) is puur presentatie: ze raakt de microfoon, de herkenning en de positie niet.

const HYMNS = listHymns(POC_LIBRARY);
const UI_FLUSH_MS = 100;
const IDLE_LIVE: LiveState = { stage: "idle", hymn: null, choice: null, recognition: null, snapshot: null, backlog: 0 };

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
  const [chosen, setChosen] = useState<number>(HYMNS[0].number);
  const [idleStanza, setIdleStanza] = useState<number>(1);
  const [orderMode, setOrderMode] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [testProgress, setTestProgress] = useState<number | null>(null);
  const [testAs, setTestAs] = useState<"recognize" | "follow">("recognize");

  // De engine en de microfoon leven in refs: ze veranderen 20 keer per seconde en mogen geen render per frame veroorzaken.
  const engineRef = useRef<HymnLiveEngine | null>(null);
  const micRef = useRef<MicListener | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const cancelTest = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLParagraphElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new HymnLiveEngine(HYMNS);
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

  const hymn: ResolvedHymn = useMemo(() => live.hymn ?? HYMNS.find((h) => h.number === chosen) ?? HYMNS[0], [live.hymn, chosen]);

  const startListening = useCallback(
    async (intent: "recognize" | "follow") => {
      const eng = getEngine();
      eng.restart();
      eng.setStanzaOrder(order);
      if (intent === "recognize") eng.startRecognizing();
      else {
        eng.followHymn(chosen, "manual");
        if (idleStanza !== (HYMNS.find((h) => h.number === chosen)?.text.stanzas[0]?.n ?? 1)) eng.selectStanza(idleStanza);
      }
      setLive(eng.state());
      if (!micRef.current) {
        micRef.current = new MicListener({
          onSamples: handleSamples,
          onState: (state, detail) => {
            setMicState(state);
            setMicDetail(detail);
            if (state !== "listening") schedule(0);
          },
        });
      }
      await micRef.current.start();
    },
    [chosen, getEngine, handleSamples, idleStanza, order, schedule]
  );

  const stopMic = useCallback(() => {
    micRef.current?.stop();
  }, []);

  const selectHymn = useCallback(
    (number: number) => {
      const next = HYMNS.find((h) => h.number === number) ?? HYMNS[0];
      setChosen(next.number);
      setIdleStanza(next.text.stanzas[0]?.n ?? 1);
      setOrder([]);
      const eng = engineRef.current;
      if (eng && eng.currentStage !== "idle") {
        // Midden in een luistersessie: dezelfde microfoon en extractor, het geheugen wordt opnieuw door de volger gehaald.
        eng.setStanzaOrder([]);
        eng.followHymn(next.number, "manual");
        schedule(0);
      }
    },
    [schedule]
  );

  const onStanzaTap = (n: number) => {
    if (orderMode) {
      const next = order.includes(n) ? order.filter((x) => x !== n) : [...order, n].sort((a, b) => a - b);
      setOrder(next);
      engineRef.current?.setStanzaOrder(next);
      return;
    }
    // Handmatige keuze: onmiddellijk tonen, de muziekherkenning loopt ongestoord door.
    setIdleStanza(n);
    engineRef.current?.selectStanza(n);
    schedule(0);
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
      if (testAs === "recognize") eng.startRecognizing();
      else eng.followHymn(chosen, "manual");
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
    [chosen, getEngine, order, testAs]
  );

  const snapshot = live.snapshot;
  const listening = micState === "listening";
  const stage = live.stage;
  const started = stage !== "idle";
  const stanzaNumbers = hymn.text.stanzas.map((s) => s.n);
  const shownStanza = snapshot ? snapshot.stanza : idleStanza;
  const stanza = hymn.text.stanzas.find((s) => s.n === shownStanza) ?? hymn.text.stanzas[0];
  const phase = snapshot?.phase.phase ?? "prelude";
  const status = describeStatus(micState, live);
  const calm = prefs.calm;
  const seq = useMemo(() => lyricSequence(hymn.text, stanza), [hymn, stanza]);
  const activeIdx = activeSeq(seq, snapshot?.cursor);
  const showLyrics = stage !== "recognizing";

  const { detached, resume } = useFollowScroll({
    enabled: prefs.autoScroll && prefs.view === "stanza" && stage === "following",
    resetKey: `${hymn.number}:${shownStanza}`,
    activeIndex: activeIdx,
    containerRef,
    activeRef,
    barRef,
    smooth: !calm,
  });

  const candidates = (live.recognition?.ranking ?? []).filter((c) => c.evidence > 20);
  const title = stage === "recognizing" ? COPY.recognizing : started || listening ? `${hymn.number}. ${hymn.text.title}` : COPY.title;

  return (
    <div className="page-fill mx-auto flex w-full max-w-2xl flex-col gap-4" data-hymns-view={prefs.view} data-hymns-calm={calm ? "true" : "false"}>
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {started ? <p className="text-xs font-bold uppercase tracking-wide text-vs-fg-3">{COPY.hymnLabel}</p> : null}
            <h1 className="vs-wrap text-xl font-bold text-vs-fg">{title}</h1>
          </div>
          <button
            type="button"
            className={iconButton}
            aria-label={settingsOpen ? COPY.settingsClose : COPY.settings}
            aria-expanded={settingsOpen}
            aria-controls="hymn-settings"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {status ? (
            <span
              role="status"
              aria-live="polite"
              data-hymns-status
              className={calm ? "text-sm font-semibold text-vs-fg-2" : `rounded-full px-3 py-1 text-sm font-bold ${TONE[status.tone]}`}
            >
              {status.label}
            </span>
          ) : null}
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-vs-fg-2" data-hymns-mic>
            {listening ? (
              <>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-vs-danger" aria-hidden="true" />
                <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
              </>
            ) : (
              <MicOff className="h-4 w-4 shrink-0 text-vs-fg-3" aria-hidden="true" />
            )}
            <span className="vs-wrap">{MIC_TEXT[micState]}</span>
          </p>
        </div>
        {status?.hint ? <p className="vs-wrap text-sm text-vs-fg-3">{status.hint}</p> : null}
        {micDetail && micState !== "listening" ? <p className="vs-wrap text-sm text-vs-fg-3">{micDetail}</p> : null}
      </header>

      {!started && !listening ? (
        <div className="space-y-3">
          {!calm ? <p className="text-base text-vs-fg-2">{COPY.intro}</p> : null}
          <p className="flex items-start gap-2 rounded-xl bg-vs-accent-soft p-3 text-sm text-vs-fg-2">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-vs-accent" aria-hidden="true" />
            <span>{COPY.privacy}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-semibold text-vs-fg-2" htmlFor="hymn-select">
              {COPY.hymnLabel}
            </label>
            <select
              id="hymn-select"
              className={`min-h-11 w-full min-w-0 max-w-full rounded-xl border border-vs-line-strong bg-vs-surface px-3 text-base text-vs-fg sm:w-auto ${focusRing}`}
              value={hymn.number}
              onChange={(e) => selectHymn(Number(e.target.value))}
            >
              {HYMNS.map((h) => (
                <option key={h.number} value={h.number}>
                  {h.number}. {h.text.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <section id="hymn-settings" aria-label={COPY.settings} className={`${surfaceCard} space-y-4 p-4`}>
          {started || listening ? (
            <div className="space-y-2">
              <label className="block text-sm font-bold text-vs-fg-2" htmlFor="hymn-select-settings">
                {COPY.hymnLabel}
              </label>
              <select
                id="hymn-select-settings"
                className={`min-h-11 w-full min-w-0 max-w-full rounded-xl border border-vs-line-strong bg-vs-surface px-3 text-base text-vs-fg ${focusRing}`}
                value={stage === "recognizing" ? "" : hymn.number}
                onChange={(e) => selectHymn(Number(e.target.value))}
              >
                {stage === "recognizing" ? <option value="">{COPY.recognizing}</option> : null}
                {HYMNS.map((h) => (
                  <option key={h.number} value={h.number}>
                    {h.number}. {h.text.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-vs-fg-2">{COPY.viewTitle}</h2>
            <div role="group" aria-label={COPY.viewTitle} className="flex flex-wrap gap-2">
              {VIEWS.map((v) => (
                <Choice key={v.id} pressed={prefs.view === v.id} onClick={() => setPrefs({ view: v.id })}>
                  {v.label}
                </Choice>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-vs-fg-2">{COPY.sizeTitle}</h2>
            <div role="group" aria-label={COPY.sizeTitle} className="flex flex-wrap gap-2">
              {SIZES.map((s) => (
                <Choice key={s.id} pressed={prefs.size === s.id} onClick={() => setPrefs({ size: s.id })}>
                  {s.label}
                </Choice>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-vs-fg-2">{COPY.displayTitle}</h2>
            <label className="flex min-h-11 items-center gap-3 text-base text-vs-fg">
              <input type="checkbox" className={`h-5 w-5 shrink-0 ${focusRing}`} style={{ accentColor: "rgb(var(--vs-accent))" }} checked={prefs.autoScroll} onChange={(e) => setPrefs({ autoScroll: e.target.checked })} />
              <span className="vs-wrap">{COPY.autoScroll}</span>
            </label>
            <label className="flex min-h-11 items-center gap-3 text-base text-vs-fg">
              <input type="checkbox" className={`h-5 w-5 shrink-0 ${focusRing}`} style={{ accentColor: "rgb(var(--vs-accent))" }} checked={prefs.calm} onChange={(e) => setPrefs({ calm: e.target.checked })} />
              <span className="vs-wrap">{COPY.calm}</span>
            </label>
          </div>
        </section>
      ) : null}

      {stage === "recognizing" ? (
        <section aria-label="Herkenning" className={`${surfaceCard} space-y-3 p-4`}>
          <p className="text-base font-bold text-vs-fg">{RECOGNITION_TEXT[live.recognition?.status ?? "listening"]}</p>
          {candidates.length > 0 ? (
            <>
              <p className="text-sm text-vs-fg-3">{COPY.candidatesHelp}</p>
              <ul className="flex flex-col gap-2">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={`${secondaryButton} w-full justify-start !rounded-xl text-left`} onClick={() => selectHymn(c.number)}>
                      <span className="vs-wrap">
                        {c.number}. {c.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {showLyrics ? (
        <section aria-label={COPY.stanzaLabel} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-vs-fg-2">{COPY.stanzaLabel}</span>
            {stanzaNumbers.map((n) => {
              const selected = order.includes(n);
              const current = n === shownStanza;
              const on = orderMode ? selected : current;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${COPY.stanzaLabel} ${n}`}
                  onClick={() => onStanzaTap(n)}
                  className={`vs-motion inline-flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-base font-bold ${focusRing} ${
                    on ? "border-vs-accent bg-vs-accent text-vs-on-accent" : "border-vs-line-strong bg-vs-surface text-vs-fg"
                  }`}
                >
                  {n}
                </button>
              );
            })}
            {!calm ? (
              <button type="button" className={secondaryButton} onClick={() => setOrderMode((v) => !v)}>
                {orderMode ? COPY.orderDone : COPY.orderToggle}
              </button>
            ) : null}
          </div>
          {!calm || order.length > 0 ? (
            <p className="text-sm text-vs-fg-3">
              {order.length > 0 ? `${COPY.orderPrefix}: ${order.join(" → ")}` : COPY.orderAll}
              {order.length > 0 ? (
                <button type="button" className={`ml-2 underline ${focusRing}`} onClick={clearOrder}>
                  {COPY.orderAll}
                </button>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {showLyrics ? (
        <section aria-label="Tekst" className="flex flex-1 flex-col py-2">
          <LyricsView
            text={hymn.text}
            stanza={stanza}
            cursor={snapshot?.cursor}
            view={prefs.view}
            size={prefs.size}
            containerRef={containerRef}
            activeRef={activeRef}
          />
          {stanza?.linking === "line" && prefs.view === "stanza" ? <p className="mt-3 text-xs text-vs-fg-3">{COPY.lineFallbackNote}</p> : null}
        </section>
      ) : (
        <div className="flex-1" />
      )}

      {isAdmin && !calm ? (
        <section aria-label={COPY.technical} className={`${surfaceCard} p-4`}>
          <button
            type="button"
            className={`flex min-h-11 w-full items-center justify-between gap-3 text-left text-base font-bold text-vs-fg ${focusRing}`}
            aria-expanded={techOpen}
            aria-controls="hymn-technical"
            onClick={() => setTechOpen((v) => !v)}
          >
            <span>{COPY.technical}</span>
            <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${techOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {techOpen ? (
            <div id="hymn-technical" className="mt-3">
              <TechnicalPanel micState={micState} live={live} testProgress={testProgress} testAs={testAs} onTestAs={setTestAs} onFile={(f) => void runTestFile(f)} />
            </div>
          ) : null}
        </section>
      ) : null}

      <div
        ref={barRef}
        data-hymns-bar
        className="sticky bottom-0 z-10 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-vs-line bg-vs-surface/95 p-2 shadow-lg backdrop-blur"
      >
        {detached ? (
          <button type="button" className={secondaryButton} onClick={resume}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            {COPY.resumeFollow}
          </button>
        ) : null}
        {listening && stage === "following" && phase === "prelude" ? (
          <button type="button" className={primaryButton} onClick={confirmSinging} title={COPY.singingStartsHelp}>
            <Play className="h-4 w-4" aria-hidden="true" />
            {COPY.singingStarts}
          </button>
        ) : null}
        {listening && stage === "following" && phase !== "prelude" ? (
          <button type="button" className={secondaryButton} onClick={resync}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {COPY.resync}
          </button>
        ) : null}
        {listening ? (
          <button type="button" className={secondaryButton} onClick={stopMic}>
            <Square className="h-4 w-4" aria-hidden="true" />
            {COPY.stop}
          </button>
        ) : (
          <>
            <button type="button" className={primaryButton} onClick={() => void startListening("recognize")} disabled={micState === "requesting"}>
              <Music className="h-4 w-4" aria-hidden="true" />
              {COPY.recognize}
            </button>
            <button type="button" className={secondaryButton} onClick={() => void startListening("follow")} disabled={micState === "requesting"}>
              <Mic className="h-4 w-4" aria-hidden="true" />
              {COPY.start}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
