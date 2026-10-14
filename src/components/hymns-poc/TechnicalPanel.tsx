"use client";

import { FileAudio } from "lucide-react";
import type { MicState } from "@/lib/hymns/audio/micListener";
import type { LiveState } from "@/lib/hymns/live";
import { focusRing } from "@/components/versado/styles";
import { COPY, MIC_TEXT, RECOGNITION_TEXT, SYNC_TEXT } from "./copy";
import { formatPosition } from "./viewModel";

// Ontwikkelaarsgegevens voor de lopende praktijktesten. Alleen voor beheerders en standaard dicht; de gewone
// meezingweergave blijft er rustig van. Niets hiervan verlaat het toestel.

interface Props {
  micState: MicState;
  live: LiveState;
  testProgress: number | null;
  testAs: "recognize" | "follow";
  onTestAs(v: "recognize" | "follow"): void;
  onFile(file: File): void;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-vs-fg-3">{k}</dt>
      <dd className="vs-wrap min-w-0 text-right font-semibold text-vs-fg">{v}</dd>
    </div>
  );
}

export default function TechnicalPanel({ micState, live, testProgress, testAs, onTestAs, onFile }: Props) {
  const s = live.snapshot;
  const r = live.recognition;
  const maxEvidence = Math.max(70, ...(r?.ranking.map((x) => x.evidence) ?? [0]));
  return (
    <div className="space-y-4 text-sm" data-hymns-technical>
      <dl className="space-y-1">
        <Row k="Microfoon" v={MIC_TEXT[micState]} />
        <Row k="Fase" v={live.stage === "idle" ? "niet gestart" : live.stage === "recognizing" ? "herkennen" : `volgen (${live.choice === "auto" ? "automatisch gekozen" : "handmatig gekozen"})`} />
        {s ? (
          <>
            <Row k="Synchronisatie" v={`${SYNC_TEXT[s.status]} · ${Math.round(s.confidence * 100)}%`} />
            <Row k="Muzikale positie" v={`${formatPosition(s)} · beat ${s.position.toFixed(1)}`} />
            <Row k="Zang" v={s.phase.phase === "singing" ? `begonnen (${s.phase.startReason ?? "?"})` : s.phase.phase === "interlude" ? "tussenspel" : s.phase.waiting ? "voorspel · wachten op zangbegin" : "voorspel"} />
            <Row k="Begin van de muziek" v={s.phase.entry === "start" ? "bij het begin van het couplet" : s.phase.entry === "mid" ? "midden in het couplet" : s.phase.entry === "joined" ? "halverwege ingestapt" : "onbekend"} />
            <Row k="Rondes gezongen" v={`${s.lap} · dekking ${Math.round(s.phase.coverage * 100)}%`} />
            <Row k="Tussenspelen" v={String(s.phase.interludes)} />
            <Row k="Bewijs zangbegin" v={s.phase.startEvidence.length ? s.phase.startEvidence.join("; ") : "geen"} />
            <Row k="Niveauverandering (diagnose)" v={`${s.phase.levelStepDb.toFixed(1)} dB`} />
            <Row k="Achterstand verwerking" v={`${live.backlog} frames`} />
          </>
        ) : null}
      </dl>

      {r ? (
        <div className="space-y-2">
          <p className="font-bold text-vs-fg">{RECOGNITION_TEXT[r.status]}</p>
          <ul className="space-y-2">
            {r.ranking.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-vs-fg-2">
                  <span className="vs-wrap">
                    {c.number}. {c.title}
                  </span>
                  <span className="shrink-0 text-xs text-vs-fg-3">bewijs {Math.max(0, Math.round(c.evidence))}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-vs-subtle">
                  <div className="h-full rounded-full bg-vs-accent" style={{ width: `${Math.min(100, Math.max(0, (c.evidence / maxEvidence) * 100))}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-vs-line pt-3">
        <h3 className="flex items-center gap-2 font-bold text-vs-fg">
          <FileAudio className="h-5 w-5 text-vs-fg-3" aria-hidden="true" />
          {COPY.testTitle}
        </h3>
        <p className="text-vs-fg-3">{COPY.testHelp}</p>
        <label className="flex flex-wrap items-center gap-2 text-vs-fg-2">
          <span>{COPY.testAs}</span>
          <select
            className={`min-h-10 min-w-0 max-w-full rounded-xl border border-vs-line-strong bg-vs-surface px-3 text-vs-fg ${focusRing}`}
            value={testAs}
            onChange={(e) => onTestAs(e.target.value === "follow" ? "follow" : "recognize")}
          >
            <option value="recognize">{COPY.testAsRecognize}</option>
            <option value="follow">{COPY.testAsFollow}</option>
          </select>
        </label>
        <input
          type="file"
          accept="audio/*"
          aria-label={COPY.testTitle}
          className={`block w-full text-vs-fg ${focusRing}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
        {testProgress !== null ? (
          <p className="text-vs-fg-2">
            {COPY.testRunning} {Math.round(testProgress * 100)}%
          </p>
        ) : null}
      </div>
    </div>
  );
}
