"use client";

import { useEffect, useState } from "react";
import UserAvatarView from "@/components/versado/UserAvatarView";
import type { AvatarAppearance } from "@/lib/avatarTypes";

// Puur decoratief: elke gebruiker krijgt een stabiele (niet-willekeurige,
// dus niet bij elke render andere) avatarkleur uit het bestaande
// merkkleurenpalet, afgeleid van zijn id. Zo heeft iemand overal in de app
// dezelfde kleur.
// Compacte avatarinstellingen worden per pagina één keer opgehaald, voor alle
// avatars die tegelijk in beeld komen in één verzoek (zie
// /api/users/avatars). Het legacy emoji-veld blijft in de payload staan voor
// compatibiliteit, maar wordt nooit door deze renderer gebruikt.
const cache = new Map<string, AvatarAppearance>();
// Een server-rendered layout geeft de actuele eigen avatar al mee. Die waarde
// moet niet worden overschreven door een oudere batchrespons of door een
// tijdelijke fallback die tijdens een netwerkfout in de cache belandt.
const localOverrides = new Map<string, AvatarAppearance>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function requestAvatar(id: string) {
  if (cache.has(id) || waiting.has(id)) return;
  waiting.add(id);
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const ids = [...waiting];
    waiting.clear();
    try {
      const res = await fetch(`/api/users/avatars?ids=${encodeURIComponent(ids.join(","))}`, {
        cache: "no-store",
      });
      const data = res.ok ? ((await res.json()) as { avatars: Record<string, AvatarAppearance | string | null> }) : { avatars: {} };
      for (const id of ids) {
        const override = localOverrides.get(id);
        if (override) {
          cache.set(id, override);
          continue;
        }
        const value = data.avatars[id];
        cache.set(id, typeof value === "object" && value !== null ? value : { avatarEmoji: typeof value === "string" ? value : null, avatarCharacterId: null, avatarBackgroundId: null, avatarFrameId: null, avatarDecorationId: null, avatarLightAccentId: null });
      }
    } catch {
      for (const id of ids) {
        if (!localOverrides.has(id)) cache.set(id, { avatarEmoji: null, avatarCharacterId: null, avatarBackgroundId: null, avatarFrameId: null, avatarDecorationId: null, avatarLightAccentId: null });
      }
    }
    for (const listener of listeners) listener();
  }, 30);
}

export function invalidateAvatarCache(id?: string): void {
  if (id) {
    cache.delete(id);
    localOverrides.delete(id);
  } else {
    cache.clear();
    localOverrides.clear();
  }
  for (const listener of listeners) listener();
}

/** Zet een net opgeslagen eigen avatar direct in de gedeelde clientcache.
 * Zo hoeven header, profiel en sociale lijsten niet op een volledige reload
 * of een nieuwe sessie te wachten. */
export function setAvatarAppearance(id: string, appearance: AvatarAppearance): void {
  localOverrides.set(id, appearance);
  cache.set(id, appearance);
  for (const listener of listeners) listener();
}

function useAvatarAppearance(id: string, known: AvatarAppearance | undefined): AvatarAppearance {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    if (known === undefined && id) requestAvatar(id);
    return () => {
      listeners.delete(listener);
    };
  }, [id, known]);
  return localOverrides.get(id) ?? known ?? cache.get(id) ?? { avatarEmoji: null, avatarCharacterId: null, avatarBackgroundId: null, avatarFrameId: null, avatarDecorationId: null, avatarLightAccentId: null };
}

/**
 * Avatar-rondje van een gebruiker. `avatarEmoji` blijft als optionele legacy-
 * prop bestaan, zodat bestaande callers en API-antwoorden compatibel blijven;
 * nieuwe en bestaande gebruikers zien altijd een personage of letterfallback.
 */
export default function UserAvatar({
  id,
  handle,
  avatarEmoji,
  avatarCharacterId,
  avatarBackgroundId,
  avatarFrameId,
  avatarDecorationId,
  avatarLightAccentId,
  size = "sm",
  className = "",
}: {
  id: string;
  handle: string;
  avatarEmoji?: string | null;
  avatarCharacterId?: string | null;
  avatarBackgroundId?: string | null;
  avatarFrameId?: string | null;
  avatarDecorationId?: string | null;
  avatarLightAccentId?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const known = avatarCharacterId !== undefined
    ? { avatarEmoji: avatarEmoji ?? null, avatarCharacterId, avatarBackgroundId: avatarBackgroundId ?? null, avatarFrameId: avatarFrameId ?? null, avatarDecorationId: avatarDecorationId ?? null, avatarLightAccentId: avatarLightAccentId ?? null }
    : undefined;
  const appearance = useAvatarAppearance(id, known);
  return <UserAvatarView id={id} handle={handle} appearance={appearance} size={size} className={className} />;
}
