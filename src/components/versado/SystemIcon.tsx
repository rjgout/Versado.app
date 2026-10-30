import type { CSSProperties } from "react";
import { SYSTEM_ICON_SOURCES, EMPTY_STREAK_SOURCE } from "@/lib/systemIcons";

export type SystemIconKind = "streak" | "xp" | "freeze";

// Eigen illustraties voor de systeemiconen (public/icons/), geen lijniconen:
// ze nemen dus geen tekstkleur over. fill="none" geeft bij de reeks, net als
// bij het oude lijnicoon, de "lege" vlam: vandaag nog niet gestudeerd. Elk
// bestand is strak om de figuur uitgesneden, zodat dezelfde maat (uit
// className, bv. h-4 w-4) overal even groot oogt.

interface SystemIconProps {
  kind: SystemIconKind;
  className?: string;
  style?: CSSProperties;
  /** Alleen voor de reeks: "none" = de lege vlam. */
  fill?: string;
  /** Overgebleven van de lijniconen; een illustratie is altijd decoratief naast een getal of tekst. */
  strokeWidth?: number;
  "aria-hidden"?: boolean | "true" | "false";
}

/** Centrale bron voor de systeemiconen: reeks, XP en reeksbevriezing. */
export default function SystemIcon({ kind, className = "", style, fill }: SystemIconProps) {
  const src = kind === "streak" && fill === "none" ? EMPTY_STREAK_SOURCE : SYSTEM_ICON_SOURCES[kind];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      width={128}
      height={128}
      style={style}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
