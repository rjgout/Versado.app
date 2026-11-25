import { nativeGameOwnsRoute } from "./gamesPagesRoutes";
import { nativeReaderRoute } from "./readerNavigation";

/** De logische bovenliggende route voor "terug" als er geen app-geschiedenis is (heropening, deeplink, eerste scherm).
 * Eén bron voor de terugbalk én de Android-systeemterugknop, zodat beide altijd naar dezelfde plek gaan. Met wel
 * geschiedenis gaat terug naar het scherm waar de gebruiker vandaan kwam; dit is alleen de terugval. */
export function nativeBackFallback(pathname: string, features: readonly string[]): string {
  const path = pathname.split("?")[0];
  if(path==="/study-folder")return "/content";
  if(path.startsWith("/study-folder/"))return "/study-folder";
  // De hoofdschermen van de tabbladen vallen terug op Vandaag, nooit op zichzelf.
  if (/^\/profile\?view=/.test(pathname)) return "/profile";
  if (path === "/live" || path === "/courses" || path === "/friends" || path === "/profile") return "/dashboard";
  if (nativeGameOwnsRoute(pathname, features)) return "/live";
  if (path === "/change-password" || path === "/account-verwijderen" || path === "/profile/avatar" || /^\/profile\?view=/.test(pathname)) return "/profile";
  const reader = nativeReaderRoute(pathname);
  if (reader) return `/courses/${reader.courseId}/pad`;
  if (path.startsWith("/friends/")) return "/friends";
  if (path.startsWith("/courses/")) return path.endsWith("/archief") ? path.replace(/archief$/, "pad") : "/courses";
  return "/dashboard";
}
