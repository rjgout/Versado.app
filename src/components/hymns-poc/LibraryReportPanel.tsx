"use client";

import { useState } from "react";
import { loadLibraryReport, type LibraryReport } from "@/lib/hymnLibraryClient";
import { secondaryButton } from "@/components/versado/styles";

// Kwaliteitsoverzicht van de bibliotheek voor beheerders (staat in de technische gegevens): exacte aantallen per niveau
// en per onvolledige lofzang de concrete reden. Een gedeeltelijke import wordt hier nooit als compleet gepresenteerd.

const LABELS: [string, string][] = [
  ["official", "Officiële lofzangen"],
  ["textComplete", "Volledig geïmporteerde teksten"],
  ["withPdf", "Met bladmuziek (PDF)"],
  ["scoreValidated", "Gevalideerde bladmuziek"],
  ["lineFollowing", "Regelvolging"],
  ["wordFollowing", "Woordvolging"],
  ["recognizable", "Herkenning beschikbaar"],
  ["recognitionValidated", "Herkenning gevalideerd (opnamen)"],
  ["uniqueCompositions", "Unieke melodieën"],
  ["audioConfirmed", "Noten bevestigd door begeleidingsopname"],
];

export default function LibraryReportPanel() {
  const [report, setReport] = useState<LibraryReport | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const open = async () => {
    setState("loading");
    try {
      setReport(await loadLibraryReport());
      setState("idle");
    } catch {
      setState("error");
    }
  };

  if (!report) {
    return (
      <div className="space-y-2" data-hymns-report>
        <button type="button" className={`${secondaryButton} w-full`} onClick={() => void open()} disabled={state === "loading"}>
          Kwaliteitsoverzicht bibliotheek
        </button>
        {state === "error" ? <p className="text-sm text-vs-danger">Het overzicht kon niet worden geladen.</p> : null}
      </div>
    );
  }
  return (
    <section className="space-y-3" data-hymns-report aria-label="Kwaliteitsoverzicht bibliotheek">
      <h3 className="text-sm font-bold text-vs-fg-2">Kwaliteitsoverzicht bibliotheek</h3>
      <dl className="space-y-1">
        {LABELS.map(([key, label]) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-vs-fg-3">{label}</dt>
            <dd className="font-semibold tabular-nums text-vs-fg">{String(report.counts[key] ?? "—")}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-vs-fg-3">
        Onvolledig ({report.incomplete.length}): {report.incomplete.map((h) => h.number).join(", ") || "geen"}
      </p>
      <ul className="max-h-64 space-y-2 overflow-y-auto overscroll-contain">
        {report.incomplete.map((h) => (
          <li key={h.number} className="text-xs text-vs-fg-2">
            <span className="font-bold text-vs-fg">
              {h.number}. {h.title}
            </span>
            <span className="vs-wrap block">{h.problems.join("; ") || "geen details"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
