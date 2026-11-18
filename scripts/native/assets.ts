import {readdirSync} from "node:fs";
import {join} from "node:path";
import kids from "../../prisma/kidsManifest.json";
import {MYSTERY_GAME} from "../../src/lib/mysteries/game";
import { AVATAR_ACCESSORIES } from "../../src/lib/avatarAccessories";
import { CHARACTER_ASSETS } from "../../src/lib/characterAssets";
import { CONTENT_SOURCE_ICON_PATHS } from "../../src/lib/contentMetadata";
import { TIER_EMBLEMS } from "../../src/lib/leagueTiers";
import { registeredStaticMascots,staticMascotAsset } from "../../src/lib/mascots";
import { NATIVE_PROFILE_STATIC_ASSETS } from "../../src/lib/native/profileAssets";
import { NATIVE_TODAY_ASSETS } from "../../src/lib/native/todayAssets";
import { EMPTY_STREAK_SOURCE,SYSTEM_ICON_SOURCES } from "../../src/lib/systemIcons";

/** Alleen compacte, bekende publieke assets; nooit gebruiker-URL's of het volledige public-archief. */
export function nativeStaticAssets(): string[] {
  const mascot = staticMascotAsset("novi", "greeting");
  return [...new Set([
    ...NATIVE_PROFILE_STATIC_ASSETS, ...NATIVE_TODAY_ASSETS, "/icons/native/versado-flame.png", ...(mascot ? [mascot.src] : []),
    ...Object.values(CONTENT_SOURCE_ICON_PATHS),
    ...Object.values(SYSTEM_ICON_SOURCES), EMPTY_STREAK_SOURCE,
    ...Object.values(TIER_EMBLEMS),
    ...Object.values(CHARACTER_ASSETS).filter(asset => asset.avatarAllowed).flatMap(asset => [asset.avatar, ...(asset.bustCompact ? [asset.bustCompact] : [])]),
    ...Object.values(AVATAR_ACCESSORIES).map(asset => asset.compact),
  ])].sort();
}

/** Bestaande spelbeelden op originele spelpaden, zonder externe downloads. */
export function nativeGameStaticAssets():string[]{
 const files:string[]=[];
 function collect(dir:string){for(const item of readdirSync(join("public",dir),{withFileTypes:true})){const path=`${dir}/${item.name}`;if(item.isDirectory())collect(path);else if(item.isFile()&&/\.(png|jpe?g|webp|svg|mp3|ogg|wav|json)$/i.test(item.name))files.push(path);}}
 collect("/games");collect("/gezinsavond");
 for(const puzzle of MYSTERY_GAME.puzzles)files.push(puzzle.assets.board,puzzle.assets.manifest,...puzzle.characters.map(character=>character.asset));
 files.push(...kids.flatMap(story=>story.images),...registeredStaticMascots().map(item=>item.asset.src));
 return [...new Set(files)].sort();
}
