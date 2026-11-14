import {gameAnnotationRoute} from "./annotationsContract";
import {gameAudioRoute} from "./gamesAudioContract";
import {gameApiRoute} from "./gamesRoutes";
import {gamePageRoute} from "./gamesPagesRoutes";
/** Dezelfde beperkte grens als de native Swift-/Java-policy, vóór de bridge. */
export function nativeGamePathAllowed(path:string,method:string):boolean {
  if(path.length>8192||/[^\x21-\x7e]/.test(path)||!path.startsWith("games/")||/[\\\s#]/.test(path)||/%(?![0-9a-f]{2})/i.test(path))return false;
  if(gameAnnotationRoute(path,method))return true;
  const audio=gameAudioRoute(path,method);if(audio)return audio.sourceId===null;
  const relative=path.slice(6);
  if(relative.split("?")[0]==="page"){
    if(method!=="GET")return false;
    const query=new URLSearchParams(relative.split("?").slice(1).join("?"));
    if([...query.keys()].length!==1||!query.has("route"))return false;
    return gamePageRoute(query.get("route")??"")!==null;
  }
  return gameApiRoute(`/api/${relative}`,method)!==null;
}
