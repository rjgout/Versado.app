import { CHARACTER_ASSETS } from "../../src/lib/characterAssets";
import { AVATAR_ACCESSORIES } from "../../src/lib/avatarAccessories";
import { TIER_EMBLEMS } from "../../src/lib/leagueTiers";
import { SYSTEM_ICON_SOURCES, EMPTY_STREAK_SOURCE } from "../../src/lib/systemIcons";
import { staticMascotAsset } from "../../src/lib/mascots";

/** Alleen compacte, bekende publieke assets; nooit gebruiker-URL's of het volledige public-archief. */
export function nativeStaticAssets(): string[] {
  const mascot = staticMascotAsset("novi", "greeting");
  return [...new Set([
    "/icons/native/versado-flame.png", ...(mascot ? [mascot.src] : []),
    ...Object.values(SYSTEM_ICON_SOURCES), EMPTY_STREAK_SOURCE,
    ...Object.values(TIER_EMBLEMS),
    ...Object.values(CHARACTER_ASSETS).filter(asset => asset.avatarAllowed).map(asset => asset.avatar),
    ...Object.values(AVATAR_ACCESSORIES).map(asset => asset.compact),
  ])].sort();
}
