"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileAudio, Mic, MicOff, Music, ShieldCheck, Square } from "lucide-react";
import { POC_LIBRARY, listHymns } from "@/lib/hymns/library";
import { ChromaExtractor } from "@/lib/hymns/audio/features";
import { MicListener, decodeAudioFile, type MicState } from "@/lib/hymns/audio/micListener";
import { HymnFollowSession, type FollowSnapshot } from "@/lib/hymns/follow/session";
import { HymnRecognizer, type RecognitionState } from "@/lib/hymns/recognize/recognizer";
import type { HymnLine, ResolvedHymn } from "@/lib/hymns/types";
import { focusRing, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import { COPY, MIC_TEXT, RECOGNITION_TEXT, SYNC_TEXT } from "./copy";

type Mode = "follow" | "recognize";

const STATUS_TONE: Record<FollowSnapshot["status"], string> = {
  idle: "bg-vs-subtle text-vs-fg-2",
  acquiring: "bg-vs-subtle text-vs-fg-2",
  locked: "bg-vs-success-soft text-vs-success",
  uncertain: "bg-vs-warning-soft text-vs-warning",
  lost: "bg-vs-danger-soft text-vs-danger",
  recovered: "bg-vs-accent-soft text-vs-accent",
};

const HYMNS = listHymns(POC_LIBRARY);
const UI_FLUSH_MS = 100;

export default function HymnsPocClient() {
  const [hymnNumber, setHymnNumber] = useState<number>(HYMNS[0].number);
  const [mode, setMode] = useState<Mode>("follow");
  const [micState, setMicState] = useState<MicState>("idle");
  const [micDetail, setMicDetail] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<FollowSnapshot | null>(null);
  const [recognition, setRecognition] = useState<RecognitionState | null>(null);
  const [orderMode, setOrderMode] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [shownStanza, setShownStanza] = useState<number>(1);
  const [testProgress, setTestProgress] = useState<number | null>(null);

  const hymn: ResolvedHymn = useMemo(() => HYMNS.find((h) => h.number === hymnNumber) ?? HYMNS[0], [hymnNumber]);

  // De sessie en herkenner leven in refs: ze veranderen 20 keer per seconde en mogen geen render per frame veroorzaken.
  // Ze worden pas aangemaakt als er audio binnenkomt en opnieuw aangemaakt bij een andere lofzang of modus.
  const enginesRef = useRef<{ session: HymnFollowSession; recognizer: HymnRecognizer } | null>(null);
  const extractorRef = useRef<ChromaExtractor | null>(null);
  const hymnRef = useRef<ResolvedHymn>(hymn);
  const orderRef = useRef<number[]>([]);
  const modeRef = useRef<Mode>(mode);
  const micRef = useRef<MicListener | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTest = useRef(false);

  const engines = useCallback(() => {
    if (!enginesRef.current) {
      const session = new HymnFollowSession(hymnRef.current);
      session.setStanzaOrder(orderRef.current);
      const recognizer = new HymnRecognizer(HYMNS.map((h) => ({ id: h.composition.id, number: h.number, title: h.text.title, composition: h.composition })));
      enginesRef.current = { session, recognizer };
    }
    return enginesRef.current;
  }, []);

  const flush = useCallback(() => {
    flushTimer.current = null;
    if (!enginesRef.current) return;
    if (modeRef.current === "follow") {
      const snap = enginesRef.current.session.snapshotNow;
      setSnapshot(snap);
      setShownStanza(snap.stanza);
    } else setRecognition(enginesRef.current.recognizer.state());
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current === null) flushTimer.current = setTimeout(flush, UI_FLUSH_MS);
  }, [flush]);

  const resetEngines = useCallback(() => {
    enginesRef.current = null;
    extractorRef.current = null;
    setSnapshot(null);
    setRecognition(null);
    setShownStanza(hymnRef.current.text.stanzas[0]?.n ?? 1);
  }, []);

  const selectHymn = useCallback(
    (number: number) => {
      hymnRef.current = HYMNS.find((h) => h.number === number) ?? HYMNS[0];
      modeRef.current = "follow";
      orderRef.current = [];
      setHymnNumber(number);
      setMode("follow");
      setOrder([]);
      resetEngines();
    },
    [resetEngines]
  );

  const changeMode = useCallback(
    (next: Mode) => {
      modeRef.current = next;
      setMode(next);
      resetEngines();
    },
    [resetEngines]
  );

  const handleSamples = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      const { session, recognizer } = engines();
      if (modeRef.current === "follow") {
        session.pushAudio(samples, sampleRate);
      } else {
        if (!extractorRef.current || extractorRef.current.config.sampleRate !== sampleRate) extractorRef.current = new ChromaExtractor({ sampleRate });
        for (const frame of extractorRef.current.push(samples)) recognizer.update(frame);
      }
      scheduleFlush();
    },
    [engines, scheduleFlush]
  );

  const stopMic = useCallback(() => {
    micRef.current?.stop();
  }, []);

  const startMic = useCallback(async () => {
    if (!micRef.current) {
      micRef.current = new MicListener({
        onSamples: handleSamples,
        onState: (state, detail) => {
          setMicState(state);
          setMicDetail(detail);
        },
      });
    }
    resetEngines();
    await micRef.current.start();
  }, [handleSamples, resetEngines]);

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
      resetEngines();
      setTestProgress(0);
      try {
        const { samples, sampleRate } = await decodeAudioFile(file);
        const chunk = 4096;
        for (let i = 0; i < samples.length; i += chunk) {
          if (cancelTest.current) break;
          handleSamples(samples.subarray(i, Math.min(samples.length, i + chunk)), sampleRate);
          if ((i / chunk) % 24 === 0) {
            setTestProgress(i / samples.length);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        flush();
      } finally {
        setTestProgress(null);
      }
    },
    [flush, handleSamples, resetEngines]
  );

  const stanzaNumbers = hymn.text.stanzas.map((s) => s.n);

  const onStanzaTap = (n: number) => {
    if (orderMode) {
      const next = order.includes(n) ? order.filter((x) => x !== n) : [...order, n].sort((a, b) => a - b);
      setOrder(next);
      orderRef.current = next;
      enginesRef.current?.session.setStanzaOrder(next);
      return;
    }
    // Handmatige keuze: onmiddellijk tonen, de muziekherkenning loopt ongestoord door.
    enginesRef.current?.session.selectStanza(n);
    setShownStanza(n);
    scheduleFlush();
  };

  const listening = micState === "listening";
  const status = snapshot?.status ?? "idle";
  const stanza = hymn.text.stanzas.find((s) => s.n === shownStanza) ?? hymn.text.stanzas[0];
  const cursor = snapshot?.cursor;
  const active = mode === "follow" && (status === "locked" || status === "recovered" || status === "uncertain");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-vs-fg">{COPY.title}</h1>
        <p className="text-base text-vs-fg-2">{COPY.intro}</p>
        <p className="flex items-start gap-2 rounded-xl bg-vs-accent-soft p-3 text-sm text-vs-fg-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-vs-accent" aria-hidden="true" />
          <span>{COPY.privacy}</span>
        </p>
      </header>

      <section aria-label="Bediening" className={`${surfaceCard} space-y-3 p-4`}>
        <div className="flex flex-wrap items-center gap-3">
          {listening ? (
            <button type="button" className={primaryButton} onClick={stopMic}>
              <Square className="h-4 w-4" aria-hidden="true" />
              {COPY.stop}
            </button>
          ) : (
            <button type="button" className={primaryButton} onClick={() => void startMic()} disabled={micState === "requesting"}>
              <Mic className="h-4 w-4" aria-hidden="true" />
              {COPY.start}
            </button>
          )}
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-vs-fg" role="status">
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
        {micDetail && micState !== "listening" ? <p className="text-sm text-vs-fg-3">{micDetail}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold text-vs-fg-2" htmlFor="hymn-select">
            {COPY.hymnLabel}
          </label>
          <select
            id="hymn-select"
            className={`min-h-10 w-full min-w-0 max-w-full rounded-xl border border-vs-line-strong bg-vs-surface px-3 text-base text-vs-fg sm:w-auto ${focusRing}`}
            value={hymnNumber}
            onChange={(e) => selectHymn(Number(e.target.value))}
          >
            {HYMNS.map((h) => (
              <option key={h.number} value={h.number}>
                {h.number}. {h.text.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={mode === "recognize" ? primaryButton : secondaryButton}
            aria-pressed={mode === "recognize"}
            onClick={() => changeMode(mode === "recognize" ? "follow" : "recognize")}
          >
            <Music className="h-4 w-4" aria-hidden="true" />
            {COPY.recognize}
          </button>
        </div>
        {mode === "recognize" ? <p className="text-sm text-vs-fg-3">{COPY.recognizeHelp}</p> : null}
      </section>

      {mode === "recognize" ? (
        <RecognitionPanel state={recognition} onFollow={selectHymn} />
      ) : (
        <>
          <section aria-label="Synchronisatie" className={`${surfaceCard} space-y-2 p-4`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${STATUS_TONE[status]}`} role="status" aria-live="polite">
                {SYNC_TEXT[status]}
              </span>
              {snapshot?.paused ? <span className="text-sm text-vs-fg-3">Pauze</span> : null}
            </div>
            <div className="flex items-center gap-3">
              <div
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-vs-subtle"
                role="meter"
                aria-label="Betrouwbaarheid"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((snapshot?.confidence ?? 0) * 100)}
              >
                <div className="h-full rounded-full bg-vs-accent transition-[width] duration-200" style={{ width: `${Math.round((snapshot?.confidence ?? 0) * 100)}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-vs-fg-3">
                {snapshot && snapshot.bpm > 0 ? `maat ${snapshot.measure + 1} · ${Math.round(snapshot.bpm)}/min` : "—"}
              </span>
            </div>
          </section>

          <section aria-label="Coupletten" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-vs-fg-2">{COPY.stanzaLabel}</span>
              {stanzaNumbers.map((n) => {
                const selected = order.includes(n);
                const current = n === shownStanza;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={orderMode ? selected : current}
                    aria-label={`${COPY.stanzaLabel} ${n}`}
                    onClick={() => onStanzaTap(n)}
                    className={`vs-motion inline-flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-base font-bold ${focusRing} ${
                      (orderMode ? selected : current) ? "border-vs-accent bg-vs-accent text-vs-on-accent" : "border-vs-line-strong bg-vs-surface text-vs-fg"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
              <button type="button" className={secondaryButton} onClick={() => setOrderMode((v) => !v)}>
                {orderMode ? COPY.orderDone : COPY.orderToggle}
              </button>
            </div>
            <p className="text-sm text-vs-fg-3">
              {order.length > 0 ? `${COPY.orderPrefix}: ${order.join(" → ")}` : COPY.orderAll}
              {order.length > 0 ? (
                <button type="button" className={`ml-2 underline ${focusRing}`} onClick={() => { setOrder([]); orderRef.current = []; enginesRef.current?.session.setStanzaOrder([]); }}>
                  {COPY.orderAll}
                </button>
              ) : null}
            </p>
          </section>

          <section aria-label="Tekst" className={`${surfaceCard} space-y-4 p-4`}>
            <h2 className="text-lg font-bold text-vs-fg">
              {hymn.number}. {hymn.text.title}
            </h2>
            <LyricBlock
              lines={stanza?.lines ?? []}
              activeLine={active && cursor?.section === "verse" ? cursor.line : -1}
              activeWord={active && cursor?.section === "verse" && stanza?.linking === "word" ? cursor.word : null}
              heading={`${COPY.stanzaLabel} ${stanza?.n ?? ""}`}
              frozen={status === "uncertain"}
            />
            {stanza?.linking === "line" ? <p className="text-xs text-vs-fg-3">{COPY.lineFallbackNote}</p> : null}
            {hymn.text.chorus ? (
              <LyricBlock
                lines={hymn.text.chorus.lines}
                activeLine={active && cursor?.section === "chorus" ? cursor.line : -1}
                activeWord={active && cursor?.section === "chorus" ? cursor.word : null}
                heading={COPY.chorus}
                frozen={status === "uncertain"}
              />
            ) : null}
          </section>
        </>
      )}

      <section aria-label="Testbestand" className={`${surfaceCard} space-y-2 p-4`}>
        <h2 className="flex items-center gap-2 text-base font-bold text-vs-fg">
          <FileAudio className="h-5 w-5 text-vs-fg-3" aria-hidden="true" />
          {COPY.testTitle}
        </h2>
        <p className="text-sm text-vs-fg-3">{COPY.testHelp}</p>
        <input
          type="file"
          accept="audio/*"
          className={`block w-full text-sm text-vs-fg ${focusRing}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runTestFile(file);
            e.target.value = "";
          }}
        />
        {testProgress !== null ? <p className="text-sm text-vs-fg-2">{COPY.testRunning} {Math.round(testProgress * 100)}%</p> : null}
      </section>
    </div>
  );
}

function LyricBlock({
  lines,
  activeLine,
  activeWord,
  heading,
  frozen,
}: {
  lines: HymnLine[];
  activeLine: number;
  activeWord: number | null;
  heading: string;
  frozen: boolean;
}) {
  const activeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    // Rustig meescrollen; bij verminderde beweging zonder animatie. Geen scroll van het hele venster naar boven.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    activeRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [activeLine]);
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-vs-fg-3">{heading}</h3>
      <div className="space-y-1.5">
        {lines.map((line, i) => {
          const isActive = i === activeLine;
          const past = activeLine >= 0 && i < activeLine;
          return (
            <p
              key={i}
              ref={isActive ? activeRef : undefined}
              aria-current={isActive ? "true" : undefined}
              className={`vs-wrap rounded-lg px-2 py-1 text-lg leading-snug transition-colors ${
                isActive ? `bg-vs-accent-soft font-semibold text-vs-fg ${frozen ? "opacity-80" : ""}` : past ? "text-vs-fg-3" : "text-vs-fg-2"
              }`}
            >
              {isActive && activeWord !== null
                ? line.words.map((w, wi) => (
                    <span key={wi} className={wi === activeWord ? "rounded bg-vs-accent px-1 text-vs-on-accent" : undefined}>
                      {w.w}
                      {wi < line.words.length - 1 ? " " : ""}
                    </span>
                  ))
                : line.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function RecognitionPanel({ state, onFollow }: { state: RecognitionState | null; onFollow: (number: number) => void }) {
  const top = state?.ranking[0];
  const maxEvidence = Math.max(70, ...(state?.ranking.map((r) => r.evidence) ?? [0]));
  return (
    <section aria-label="Herkenning" className={`${surfaceCard} space-y-3 p-4`}>
      <p className="text-base font-bold text-vs-fg" role="status" aria-live="polite">
        {RECOGNITION_TEXT[state?.status ?? "listening"]}
        {state?.status === "identified" && state.suggestion ? `: ${state.suggestion.number}. ${state.suggestion.title}` : ""}
      </p>
      <ul className="space-y-2">
        {(state?.ranking ?? []).map((r) => (
          <li key={r.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm text-vs-fg-2">
              <span className="vs-wrap">
                {r.number}. {r.title}
              </span>
              <span className="shrink-0 text-xs text-vs-fg-3">bewijs {Math.max(0, Math.round(r.evidence))}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-vs-subtle">
              <div className="h-full rounded-full bg-vs-accent" style={{ width: `${Math.min(100, Math.max(0, (r.evidence / maxEvidence) * 100))}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {state?.status === "identified" && top ? (
        <button type="button" className={primaryButton} onClick={() => onFollow(top.number)}>
          {COPY.followThis}
        </button>
      ) : null}
      {state?.status === "ambiguous" ? <p className="text-sm text-vs-fg-3">Kies zelf de lofzang in de lijst hierboven.</p> : null}
    </section>
  );
}
