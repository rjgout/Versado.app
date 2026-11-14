import { visualIdentityAsset } from "@/lib/visualIdentityAssets";
import { CHARACTER_ASSETS } from "@/lib/characterAssets";
export const NATIVE_PROFILE_STATIC_ASSETS=(["podium-gold","podium-silver","podium-bronze","achievement-learning","achievement-mastery","achievement-social","achievement-game"] as const).map(id=>visualIdentityAsset(id).src);
export const NATIVE_PROFILE_ARTWORK=[...new Set(Object.values(CHARACTER_ASSETS).filter(value=>value.avatarAllowed).map(value=>value.fullBody))].sort();
export function nativeProfileArtworkPath(src:string){return `/native-profile${src.replace(/\.(png|jpe?g|webp)$/i,".webp")}`;}
const originals=new Set<string>(NATIVE_PROFILE_ARTWORK);
export function nativeProfileImageSource(src:string){return originals.has(src)?nativeProfileArtworkPath(src):null;}
