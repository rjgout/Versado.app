import { registeredArtworkPaths } from "@/lib/artwork";
import { PERSONAL_MASCOTS, staticMascotAsset } from "@/lib/mascots";
import { visualIdentityAsset } from "@/lib/visualIdentityAssets";
/** Zelfde geregistreerde beelden, alleen tijdens de lokale build compact gecodeerd. */
export const NATIVE_TODAY_ARTWORK = registeredArtworkPaths().filter(src => src.startsWith("/") && !src.startsWith("/api/"));
export function nativeArtworkPath(src: string): string { return `/native-artwork${src.replace(/\.(png|jpe?g|webp)$/i, ".webp")}`; }
export const NATIVE_TODAY_ASSETS = [...new Set([
  visualIdentityAsset("kompas").src,
  ...PERSONAL_MASCOTS.flatMap(character => (["greeting", "sleep", "discovery"] as const).flatMap(state => { const asset = staticMascotAsset(character, state); return asset ? [asset.src] : []; })),
])].sort();
const originals = new Set(NATIVE_TODAY_ARTWORK), sources = new Set(NATIVE_TODAY_ASSETS);
export function nativeTodayImageSource(src: string): string | null { return originals.has(src) ? nativeArtworkPath(src) : sources.has(src) ? src : null; }
