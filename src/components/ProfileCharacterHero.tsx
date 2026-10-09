"use client";

import { useState } from "react";
import Link from "next/link";
import { getCharacterAsset } from "@/lib/characterAssets";
import { profileFrameFor } from "@/lib/profileCharacterFraming";
import { profileCameraOriginX, profileCameraOriginY } from "@/lib/profileCamera";
import type { AvatarAppearance } from "@/lib/avatarTypes";
import ScriptureAvatar from "@/components/ScriptureAvatar";

export default function ProfileCharacterHero({ appearance, handle, zoomInLabel, zoomOutLabel, changeLabel, changeHref }: {
  appearance: AvatarAppearance;
  handle: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  changeLabel?: string;
  changeHref?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const character = getCharacterAsset(appearance.avatarCharacterId);
  const frame = character ? profileFrameFor(character.id) : null;
  const headX = frame ? `${profileCameraOriginX(frame) * 100}%` : "50%";
  const cameraY = frame ? `${profileCameraOriginY(frame) * 100}%` : "16%";
  const zoom = frame?.zoom ?? 2.45;

  return (
    <div className="relative h-[clamp(15rem,70vw,18.75rem)] overflow-hidden border-b border-white/10 bg-black/10 md:h-72">
      {character ? (
        <button
          type="button"
          className="absolute inset-0 h-full w-full cursor-zoom-in touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
          aria-label={zoomed ? zoomOutLabel : zoomInLabel}
          aria-pressed={zoomed}
          onClick={() => setZoomed((value) => !value)}
        >
          <span className="absolute inset-0 flex items-center justify-center overflow-hidden">
            {/* Hetzelfde full-body-raster blijft staan; alleen de camera-transform
                verandert. De veilige camera-Y houdt de volledige zichtbare
                bovenrand binnen beeld, ook bij hoofdbedekking. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={character.fullBody}
              alt=""
              draggable={false}
              className="h-full w-auto max-w-none select-none transition-transform duration-[360ms] ease-out motion-reduce:transition-none"
              style={{ transformOrigin: `${headX} ${cameraY}`, transform: zoomed ? `scale(${zoom})` : "scale(1)" }}
            />
          </span>
        </button>
      ) : (
        <div className="flex h-full items-center justify-center">
          <ScriptureAvatar appearance={appearance} handle={handle} className="h-28 w-28 bg-black/15 text-4xl text-gold-300" />
        </div>
      )}

      {/* Een kader is uitsluitend voor compacte avatars. Achtergrond/decoratie
          kunnen wel in een kleine badge mee zichtbaar blijven, maar nooit als
          ring rond het full-body-personage of diens hoofd. */}
      {character && (appearance.avatarBackgroundId || appearance.avatarDecorationId || appearance.avatarLightAccentId) && (
        <ScriptureAvatar
          appearance={{ ...appearance, avatarFrameId: null }}
          handle={handle}
          className="absolute left-3 top-3 h-16 w-16 bg-black/20 shadow-lg sm:left-5 sm:top-5"
        />
      )}
      {changeHref && changeLabel && <Link href={changeHref} className="absolute bottom-3 right-3 inline-flex min-h-10 items-center rounded-full bg-black/45 px-3 text-xs font-extrabold text-white backdrop-blur transition hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:bottom-5 sm:right-5">
        {changeLabel}
      </Link>}
    </div>
  );
}
