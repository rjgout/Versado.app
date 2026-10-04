import SystemIcon from "@/components/versado/SystemIcon";

/** Eén vervangpunt voor het voorlopige terugkeersymbool; betekenis staat ook in echte tekst. */
export default function StreakDayIndicator({ state }: { state: "STUDIED" | "FROZEN" | "RETURNED" }) {
  if (state === "RETURNED") return <span aria-hidden>✨</span>;
  return <SystemIcon kind={state === "FROZEN" ? "freeze" : "streak"} className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}
