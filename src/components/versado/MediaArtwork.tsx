"use client";

import { useState } from "react";
import { AppImage as Image, useAppImageSource } from "@/components/navigation/AppNavigation";
import { BookOpen, Brain, Gamepad2, GraduationCap, Headphones, Sparkles, Users, type LucideIcon } from "lucide-react";
import { artworkFor, type ArtworkAsset, type ArtworkKeys, type ArtworkKind } from "@/lib/artwork";

// Vast kader voor beeld bij content (cursus, spel, podcast, dagelijkse
// content). De verhouding ligt vast, dus het laden van een afbeelding
// verschuift niets in de lay-out. Via `children` kan er een laag over het
// kader (een label, later eventueel een animatie).
//
// Welke afbeelding bij welke content hoort staat alleen in src/lib/artwork.ts;
// hier komt een lijst sleutels binnen en de eerste die bestaat wint. Zolang
// het beeld laadt: een vlak in de gemiddelde kleur ervan. Zonder beeld of bij
// een fout: een neutrale placeholder in de tint van de soort content met een
// lijnicoon, bewust geen illustratie of emoji.

const RATIOS = {
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "3/2": "aspect-[3/2]",
  "2/1": "aspect-[2/1]",
  "1/1": "aspect-square",
  "21/9": "aspect-[21/9]",
} as const;

const TONES: Record<ArtworkKind, { bg: string; fg: string; icon: LucideIcon }> = {
  course: { bg: "bg-vs-accent-soft", fg: "text-vs-accent", icon: GraduationCap },
  reading: { bg: "bg-vs-accent-soft", fg: "text-vs-accent", icon: BookOpen },
  podcast: { bg: "bg-vs-league-soft", fg: "text-vs-league", icon: Headphones },
  game: { bg: "bg-vs-streak-soft", fg: "text-vs-streak", icon: Gamepad2 },
  quiz: { bg: "bg-vs-xp-soft", fg: "text-vs-xp", icon: Brain },
  daily: { bg: "bg-vs-xp-soft", fg: "text-vs-xp", icon: Sparkles },
  social: { bg: "bg-vs-success-soft", fg: "text-vs-success", icon: Users },
};

export default function MediaArtwork({
  kind,
  artworkKey,
  asset,
  ratio = "16/9",
  sizes,
  className = "",
  priority = false,
  children,
}: {
  kind: ArtworkKind;
  /** Sleutel(s) in het artworkregister (src/lib/artwork.ts), van specifiek naar algemeen. */
  artworkKey?: ArtworkKeys;
  /** Rechtstreeks meegegeven beeld; gaat voor het register. */
  asset?: ArtworkAsset | null;
  ratio?: keyof typeof RATIOS;
  /** Hoe breed het kader op het scherm is (zoals bij <img sizes>), zodat de browser een passende maat laadt. */
  sizes: string;
  className?: string;
  /** Het eerste grote beeld bovenaan een pagina: direct laden in plaats van lui. */
  priority?: boolean;
  /** Laag over het kader, bv. een label. */
  children?: React.ReactNode;
}) {
  const image = asset ?? artworkFor(artworkKey);
  const source = useAppImageSource(image?.src);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const tone = TONES[kind];
  const Icon = tone.icon;
  const showImage = image !== null && source !== null && state !== "error";

  return (
    <div
      className={`relative overflow-hidden ${RATIOS[ratio]} ${showImage ? "" : tone.bg} ${className}`}
      style={showImage && image.tone ? { backgroundColor: image.tone } : undefined}
      data-artwork-kind={kind}
      data-artwork={showImage ? image.src : "placeholder"}
    >
      {!showImage && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <Icon className={`h-7 w-7 ${tone.fg} opacity-60`} strokeWidth={1.75} />
        </div>
      )}
      {showImage && (
        <Image
          src={source!}
          alt={image.alt ?? ""}
          fill
          sizes={sizes}
          priority={priority}
          // Beveiligde media-API (bv. het lesbeeld van een studiecursus): de beeldoptimalisatie heeft geen sessie.
          unoptimized={image.src.startsWith("/api/")}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className={`vs-motion transition-opacity duration-300 ${image.fit === "contain" ? "object-contain" : "object-cover"} ${
            state === "loaded" ? "opacity-100" : "opacity-0"
          }`}
          style={image.position ? { objectPosition: image.position } : undefined}
        />
      )}
      {/* Een zachte verloop bovenin alleen als er iets over het beeld ligt:
          de labels hebben hun eigen achtergrond, dit houdt ze ook op een
          lichte lucht rustig leesbaar zonder het hele beeld donkerder te
          maken. */}
      {showImage && children && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent" aria-hidden />
      )}
      {children}
    </div>
  );
}
