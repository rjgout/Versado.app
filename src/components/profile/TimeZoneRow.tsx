"use client";
import { useEffect, useState } from "react";
import { DEFAULT_TIME_ZONE,isValidTimeZone } from "@/lib/timeZone";
import { Clock } from "lucide-react";
import { SettingsInfoRow } from "./settings";
// Ter informatie, geen instelling: de tijdzone volgt automatisch het toestel
// (TimeZoneSync.tsx). Intern altijd de IANA-naam; zichtbaar de gangbare
// naam in de taal van de app, met de IANA-naam eronder.
export default function TimeZoneRow({ known, label, format, locale }: { known: string | null; label: string; format: (zone: string) => string; locale: string }) {
  const [zone, setZone] = useState(known ?? DEFAULT_TIME_ZONE);
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimeZone(detected)) setZone(detected);
    } catch {
      // geen Intl-tijdzone: de opgeslagen blijft staan
    }
  }, []);
  let name = zone;
  try {
    name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    // oudere browser zonder longGeneric: de IANA-naam
  }
  return (
    <SettingsInfoRow
      icon={<Clock className="h-5 w-5 text-vs-accent" aria-hidden />}
      label={label}
      description={<>{format(name)}<span className="block text-xs text-vs-fg-3">{zone.replace(/_/g, " ")}</span></>}
    />
  );
}
