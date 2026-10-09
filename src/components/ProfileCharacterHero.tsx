"use client";

import { useState } from "react";
import { getCharacterAsset } from "@/lib/characterAssets";
import { profileFrameFor } from "@/lib/profileCharacterFraming";
import type { AvatarAppearance } from "@/lib/avatarTypes";
import ScriptureAvatar from "@/components/ScriptureAvatar";

export default function ProfileCharacterHero({ appearance, handle, zoomInLabel, zoomOutLabel, changeLabel, onChange }: {
  appearance: AvatarAppearance;
  handle: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  changeLabel?: string;
  onChange?: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const character = getCharacterAsset(appearance.avatarCharacterId);
  const frame = character ? profileFrameFor(character.id) : null;
  const headX = frame ? `${(frame.head[0] / frame.source[0]) * 100}%` : "50%";
  const headY = frame ? `${(frame.head[1] / frame.source[1]) * 100}%` : "16%";
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
          {/* Hetzelfde full-body-raster blijft staan; alleen de camera-transform
              verandert, zodat gezicht, kleding en licht niet verspringen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={character.fullBody}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain transition-transform duration-[360ms] ease-out motion-reduce:transition-none"
            style={{ transformOrigin: `${headX} ${headY}`, transform: zoomed ? `scale(${zoom})` : "scale(1)" }}
          />
        </button>
      ) : (
        <div className="flex h-full items-center justify-center">
          <ScriptureAvatar appearance={appearance} handle={handle} className="h-28 w-28 bg-black/15 text-4xl text-gold-300" />
        </div>
      )}

      {/* Vierkante lagen blijven in een kleine badge; ze worden nooit over de
          rechthoekige full-body-header uitgerekt. */}
      {character && <ScriptureAvatar appearance={appearance} handle={handle} className="absolute left-3 top-3 h-16 w-16 bg-black/20 shadow-lg ring-2 ring-white/30 sm:left-5 sm:top-5" />}
      {onChange && changeLabel && <button type="button" onClick={onChange} className="absolute bottom-3 right-3 min-h-10 rounded-full bg-black/45 px-3 text-xs font-extrabold text-white backdrop-blur transition hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:bottom-5 sm:right-5">
        {changeLabel}
      </button>}
    </div>
  );
}
