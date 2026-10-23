// Weergavegegevens bij de achievement-slugs uit src/lib/achievements.ts /
// prisma/seed.ts. Puur data, veilig om in client components te gebruiken.
export const ACHIEVEMENT_DISPLAY: Record<string, { name: string; icon: string }> = {
  "streak-7": { name: "Eerste week", icon: "🔥" },
  "streak-30": { name: "Vol doorgezet", icon: "🔥" },
  "first-chapter": { name: "Eerste hoofdstuk", icon: "📖" },
  "xp-1000": { name: "1000 XP", icon: "⭐" },
  "first-freeze-earned": { name: "Eerste reeksbevriezing", icon: "🧊" },
  "first-freeze-gifted": { name: "Vrijgevig", icon: "🎁" },
  "first-friend": { name: "Niet alleen", icon: "👥" },
  "first-duel-won": { name: "Eerste overwinning", icon: "⚔️" },
  "family-game-first-play": { name: "Gezinsavond", icon: "🎉" },
};
