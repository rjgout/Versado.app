import { BookOpen, Gamepad2, Flag, Globe2, Heart, Layers, Rocket, Trophy, UserRound, Users, Zap, Flame, type LucideIcon } from "lucide-react";
import type { KompasIconId } from "@/lib/kompas/registry";

/**
 * Het Kompas-icoon, afgeleid van het kompas dat Varo draagt: een cirkel met een
 * ster met vier punten. Getekend in dezelfde stijl en lijndikte als de
 * lucide-iconen van Versado, zodat het overal meekleurt met de tekst en in
 * licht en donker werkt. Geen nieuw mascotontwerp.
 */
export function KompasIcon({ className = "h-5 w-5", strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 5.5l2.2 4.8 4.8 2.2-4.8 2.2L12 19.5l-2.2-4.8L5 12.5l4.8-2.2z" />
    </svg>
  );
}

const ICONS: Record<Exclude<KompasIconId, "compass">, LucideIcon> = {
  learn: BookOpen,
  play: Gamepad2,
  together: Users,
  progress: Trophy,
  profile: UserRound,
  start: Rocket,
  switcher: Layers,
  xp: Zap,
  streak: Flame,
  division: Flag,
  friends: Heart,
  groups: Globe2,
};

/** Het icoon bij een onderdeel uit het register; onbekende waarden vallen terug op het kompas. */
export function TopicIcon({ icon, className = "h-5 w-5" }: { icon: KompasIconId; className?: string }) {
  if (icon === "compass") return <KompasIcon className={className} />;
  const Icon = ICONS[icon] ?? null;
  return Icon ? <Icon className={className} aria-hidden /> : <KompasIcon className={className} />;
}
