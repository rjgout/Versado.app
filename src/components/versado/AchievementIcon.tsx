"use client";

import { Award } from "lucide-react";
import ContentIcon from "@/components/versado/ContentIcon";
import SystemIcon from "@/components/versado/SystemIcon";
import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";
import { achievementVisualFor } from "@/lib/visualIdentityAssets";

/**
 * Eén presentatiebron voor een achievement. De database-emoji blijft alleen
 * een veilige legacyfallback voor onbekende of historische slugs.
 */
export default function AchievementIcon({
  slug,
  fallbackIcon,
  className = "",
}: {
  slug: string;
  fallbackIcon?: string | null;
  className?: string;
}) {
  switch (achievementVisualFor(slug)) {
    case "system-streak":
      return <SystemIcon kind="streak" className={className} />;
    case "system-xp":
      return <SystemIcon kind="xp" className={className} />;
    case "system-freeze":
      return <SystemIcon kind="freeze" className={className} />;
    case "podcasts":
      return <ContentIcon collection={{ id: "podcasts", work: "podcasts" }} className={className} />;
    case "kompas":
      return <VisualIdentityIcon asset="kompas" className={className} />;
    case "achievement-learning":
      return <VisualIdentityIcon asset="achievement-learning" className={className} />;
    case "achievement-mastery":
      return <VisualIdentityIcon asset="achievement-mastery" className={className} />;
    case "achievement-social":
      return <VisualIdentityIcon asset="achievement-social" className={className} />;
    case "achievement-game":
      return <VisualIdentityIcon asset="achievement-game" className={className} />;
    default:
      return fallbackIcon
        ? <span className={className} aria-hidden>{fallbackIcon}</span>
        : <Award className={className} aria-hidden />;
  }
}
