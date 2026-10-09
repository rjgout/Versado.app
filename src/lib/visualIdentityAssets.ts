import {
  Bell,
  BookOpen,
  Compass,
  Gamepad2,
  Mail,
  Medal,
  Target,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";

interface VisualIdentityAsset {
  src: string;
  fallback: LucideIcon;
}

/**
 * Definitieve V2-identiteitsbeelden. Alleen deze registry kent de paden naar
 * de nieuwe publieke assets; domeinspecifieke registers (bron, divisie,
 * systeem, mascotte en artwork) blijven eigenaar van hun bestaande beelden.
 */
export const VISUAL_IDENTITY_ASSETS = {
  kompas: { src: "/icons/versado/kompas.webp", fallback: Compass },
  invite: { src: "/icons/versado/invite-friends.webp", fallback: Mail },
  tools: { src: "/icons/versado/tools.webp", fallback: Wrench },
  "podium-gold": { src: "/icons/versado/podium/podium-gold.webp", fallback: Medal },
  "podium-silver": { src: "/icons/versado/podium/podium-silver.webp", fallback: Medal },
  "podium-bronze": { src: "/icons/versado/podium/podium-bronze.webp", fallback: Medal },
  "achievement-learning": { src: "/icons/versado/achievements/achievement-learning.webp", fallback: BookOpen },
  "achievement-mastery": { src: "/icons/versado/achievements/achievement-mastery.webp", fallback: Target },
  "achievement-social": { src: "/icons/versado/achievements/achievement-social.webp", fallback: UsersRound },
  "achievement-game": { src: "/icons/versado/achievements/achievement-game.webp", fallback: Gamepad2 },
  "notifications-empty": { src: "/icons/versado/empty/notifications-empty.webp", fallback: Bell },
} as const satisfies Record<string, VisualIdentityAsset>;

export type VisualIdentityAssetId = keyof typeof VISUAL_IDENTITY_ASSETS;

export function visualIdentityAsset(id: VisualIdentityAssetId): VisualIdentityAsset {
  return VISUAL_IDENTITY_ASSETS[id];
}

const PODIUM_ASSET_BY_RANK: Record<1 | 2 | 3, VisualIdentityAssetId> = {
  1: "podium-gold",
  2: "podium-silver",
  3: "podium-bronze",
};

/** De drie podiumassets zijn voor alle publieke klassementen dezelfde set. */
export function podiumAssetForRank(rank: 1 | 2 | 3): VisualIdentityAssetId {
  return PODIUM_ASSET_BY_RANK[rank];
}

export type AchievementVisual =
  | "system-streak"
  | "system-xp"
  | "system-freeze"
  | "podcasts"
  | "kompas"
  | "achievement-learning"
  | "achievement-mastery"
  | "achievement-social"
  | "achievement-game";

// Expliciete, stabiele slugmapping: nooit raden op naam, emoji of een deel
// van een slug. Nieuwe prestaties krijgen bewust een keuze in deze registry.
const ACHIEVEMENT_VISUALS: Record<string, AchievementVisual> = {
  "streak-3": "system-streak",
  "streak-7": "system-streak",
  "streak-30": "system-streak",
  "streak-100": "system-streak",
  "first-chapter": "achievement-learning",
  "chapters-5": "achievement-learning",
  "chapters-10": "achievement-learning",
  "chapters-25": "achievement-learning",
  "chapters-50": "achievement-learning",
  "perfect-chapter": "achievement-mastery",
  "perfect-10": "achievement-mastery",
  "xp-1000": "system-xp",
  "xp-5000": "system-xp",
  "xp-10000": "system-xp",
  "first-freeze-earned": "system-freeze",
  "first-freeze-gifted": "achievement-social",
  "first-friend": "achievement-social",
  "friends-5": "achievement-social",
  "first-duel-won": "achievement-game",
  "duels-10-won": "achievement-game",
  "family-game-first-play": "achievement-game",
  "word-game-first-win": "achievement-game",
  "word-game-7-wins": "achievement-game",
  "podcast-first-lesson": "podcasts",
  "podcast-10-lessons": "podcasts",
  "kids-first-story": "achievement-learning",
  "kids-10-stories": "achievement-learning",
  "intro-first-lesson": "kompas",
  "intro-all-lessons": "kompas",
  "friend-streak-1": "achievement-social",
  "friend-streak-7": "achievement-social",
  "friend-streak-30": "achievement-social",
  "friend-streak-100": "achievement-social",
  "friend-streak-365": "achievement-social",
};

export function achievementVisualFor(slug: string): AchievementVisual | null {
  return ACHIEVEMENT_VISUALS[slug] ?? null;
}
