import {nativeRoute} from "./navigation";
import {gamePageRoute} from "./gamesPagesRoutes";

/** Alleen geïmplementeerde bestemmingen. Spelafhankelijkheden verschijnen pas
 * met de bewezen backendcapabilities én de bestaande native socketbinding. */
export function nativeProfileDestination(href:string,gamesEnabled=false):boolean {
 const route=nativeRoute(href);
 return route!==null&&(!gamePageRoute(route)||gamesEnabled);
}
