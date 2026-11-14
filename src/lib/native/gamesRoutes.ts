/** Expliciete spelhandelingen en benodigde ondersteunende endpoints. Geen URL-proxy.
 * Nieuwe webhandlers verschijnen hier nooit automatisch; uitbreiding vereist review en tests. */
export const GAME_API_ROUTES = [
 {"path":"kompas/state","segments":["kompas","state"],"methods":["GET","POST"],"query":[]},
  {"path":"open-actions","segments":["open-actions"],"methods":["GET"],"query":["tab","offset","limit"]},
  {"path":"nudges","segments":["nudges"],"methods":["POST"],"query":[]},
  {"path":"group-invites/[inviteId]","segments":["group-invites","[inviteId]"],"methods":["POST"],"query":[]},
  {"path":"friends/[friendshipId]/accept","segments":["friends","[friendshipId]","accept"],"methods":["POST"],"query":[]},
  {"path":"friends/[friendshipId]/decline","segments":["friends","[friendshipId]","decline"],"methods":["POST"],"query":[]},

  {"path":"reading-sessions","segments":["reading-sessions"],"methods":["POST"],"query":[]},
  {"path":"chapters/[chapterId]/read","segments":["chapters","[chapterId]","read"],"methods":["POST"],"query":[]},
  {"path":"chapters/[chapterId]/submit","segments":["chapters","[chapterId]","submit"],"methods":["POST"],"query":[]},
  {"path":"exercises/[exerciseId]/check","segments":["exercises","[exerciseId]","check"],"methods":["POST"],"query":[]},
  {"path":"study/[code]/units","segments":["study","[code]","units"],"methods":["GET"],"query":[]},
  {"path":"activity-status","segments":["activity-status"],"methods":["GET"],"query":[]},
  {"path":"alleskenner/seasons/[id]/evenings","segments":["alleskenner","seasons","[id]","evenings"],"methods":["POST"],"query":[]},
  {"path":"alleskenner/seasons/[id]/finale","segments":["alleskenner","seasons","[id]","finale"],"methods":["POST"],"query":[]},
  {"path":"alleskenner/seasons/[id]/members","segments":["alleskenner","seasons","[id]","members"],"methods":["POST","DELETE"],"query":[]},
  {"path":"alleskenner/seasons/[id]","segments":["alleskenner","seasons","[id]"],"methods":["GET","PATCH"],"query":["absent"]},
  {"path":"alleskenner/seasons","segments":["alleskenner","seasons"],"methods":["GET","POST"],"query":[]},
  {"path":"alleskenner/solo","segments":["alleskenner","solo"],"methods":["GET","POST"],"query":[]},
  {"path":"challenges/[challengeId]/accept","segments":["challenges","[challengeId]","accept"],"methods":["POST"],"query":[]},
  {"path":"challenges/[challengeId]/cancel","segments":["challenges","[challengeId]","cancel"],"methods":["POST"],"query":[]},
  {"path":"challenges/[challengeId]/decline","segments":["challenges","[challengeId]","decline"],"methods":["POST"],"query":[]},
  {"path":"challenges/[challengeId]/forfeit","segments":["challenges","[challengeId]","forfeit"],"methods":["POST"],"query":[]},
  {"path":"challenges","segments":["challenges"],"methods":["GET","POST"],"query":[]},
  {"path":"chapter-guess/[gameId]/answer","segments":["chapter-guess","[gameId]","answer"],"methods":["POST"],"query":[]},
  {"path":"chapter-guess/[gameId]/forfeit","segments":["chapter-guess","[gameId]","forfeit"],"methods":["POST"],"query":[]},
  {"path":"chapter-guess/[gameId]/hint","segments":["chapter-guess","[gameId]","hint"],"methods":["POST"],"query":[]},
  {"path":"chapter-guess/[gameId]","segments":["chapter-guess","[gameId]"],"methods":["GET"],"query":[]},
  {"path":"chapter-guess/start","segments":["chapter-guess","start"],"methods":["POST"],"query":[]},
  {"path":"chapters","segments":["chapters"],"methods":["GET"],"query":[]},
  {"path":"dictionary/[word]","segments":["dictionary","[word]"],"methods":["GET"],"query":[]},
  {"path":"exercises/[exerciseId]/hint","segments":["exercises","[exerciseId]","hint"],"methods":["GET","POST"],"query":[]},
  {"path":"feedback/exercise","segments":["feedback","exercise"],"methods":["POST"],"query":[]},
  {"path":"friends/recent","segments":["friends","recent"],"methods":["GET"],"query":[]},
  {"path":"friends","segments":["friends"],"methods":["GET"],"query":[]},
  {"path":"hints","segments":["hints"],"methods":["GET"],"query":[]},
  {"path":"jigsaw-v2","segments":["jigsaw-v2"],"methods":["POST"],"query":[]},
  {"path":"jigsaw","segments":["jigsaw"],"methods":["POST"],"query":[]},
  {"path":"list-order","segments":["list-order"],"methods":["GET","PUT"],"query":["listKey"]},
  {"path":"live/[code]","segments":["live","[code]"],"methods":["GET"],"query":[]},
  {"path":"live/create-alleskenner","segments":["live","create-alleskenner"],"methods":["POST"],"query":[]},
  {"path":"live/create-chapter-guess","segments":["live","create-chapter-guess"],"methods":["POST"],"query":[]},
  {"path":"live/create-family-game","segments":["live","create-family-game"],"methods":["POST"],"query":[]},
  {"path":"live/create","segments":["live","create"],"methods":["POST"],"query":[]},
  {"path":"mysteries/attempts","segments":["mysteries","attempts"],"methods":["GET","POST"],"query":["variant"]},
  {"path":"puzzle/coop","segments":["puzzle","coop"],"methods":["POST"],"query":[]},
  {"path":"puzzle/history","segments":["puzzle","history"],"methods":["GET"],"query":["limit","cursor"]},
  {"path":"puzzle/leaderboard","segments":["puzzle","leaderboard"],"methods":["GET"],"query":["variantId","imageId","pieceCount","difficulty","mode","hintCategory"]},
  {"path":"puzzle/match","segments":["puzzle","match"],"methods":["POST"],"query":[]},
  {"path":"puzzle/overview","segments":["puzzle","overview"],"methods":["GET"],"query":[]},
  {"path":"puzzle/records","segments":["puzzle","records"],"methods":["GET"],"query":["mode","hintCategory","pieceCount","difficulty"]},
  {"path":"scrabble/[gameId]/accept","segments":["scrabble","[gameId]","accept"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/cancel","segments":["scrabble","[gameId]","cancel"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/decline","segments":["scrabble","[gameId]","decline"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/exchange","segments":["scrabble","[gameId]","exchange"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/forfeit","segments":["scrabble","[gameId]","forfeit"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/hint","segments":["scrabble","[gameId]","hint"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/move","segments":["scrabble","[gameId]","move"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]/pass","segments":["scrabble","[gameId]","pass"],"methods":["POST"],"query":[]},
  {"path":"scrabble/[gameId]","segments":["scrabble","[gameId]"],"methods":["GET"],"query":[]},
  {"path":"scrabble","segments":["scrabble"],"methods":["GET","POST"],"query":[]},
  {"path":"shop/genees","segments":["shop","genees"],"methods":["POST"],"query":[]},
  {"path":"shop/hints","segments":["shop","hints"],"methods":["POST"],"query":[]},
  {"path":"shop","segments":["shop"],"methods":["GET"],"query":[]},
  {"path":"snelle-zendeling/leaderboard","segments":["snelle-zendeling","leaderboard"],"methods":["GET"],"query":["type","board"]},
  {"path":"snelle-zendeling/runs/[runId]/death","segments":["snelle-zendeling","runs","[runId]","death"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/runs/[runId]/finish","segments":["snelle-zendeling","runs","[runId]","finish"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/runs/[runId]/genees","segments":["snelle-zendeling","runs","[runId]","genees"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/runs/[runId]/resume","segments":["snelle-zendeling","runs","[runId]","resume"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/runs/[runId]/revive/answer","segments":["snelle-zendeling","runs","[runId]","revive","answer"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/runs/[runId]/revive","segments":["snelle-zendeling","runs","[runId]","revive"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/runs/[runId]","segments":["snelle-zendeling","runs","[runId]"],"methods":["GET"],"query":[]},
  {"path":"snelle-zendeling/runs","segments":["snelle-zendeling","runs"],"methods":["POST"],"query":[]},
  {"path":"snelle-zendeling/together","segments":["snelle-zendeling","together"],"methods":["POST"],"query":[]},
  {"path":"streak/celebration","segments":["streak","celebration"],"methods":["POST","GET"],"query":[]},
  {"path":"streak/continuation","segments":["streak","continuation"],"methods":["GET","POST"],"query":[]},
  {"path":"users/avatars","segments":["users","avatars"],"methods":["GET"],"query":["ids"]},
  {"path":"users/search","segments":["users","search"],"methods":["GET"],"query":["q"]},
  {"path":"word-game/guess","segments":["word-game","guess"],"methods":["POST"],"query":[]},
  {"path":"word-game/hint","segments":["word-game","hint"],"methods":["POST"],"query":[]},
  {"path":"word-game/ranking","segments":["word-game","ranking"],"methods":["GET"],"query":[]},
  {"path":"word-game","segments":["word-game"],"methods":["GET"],"query":[]},
  {"path":"word-search/[gameId]/find","segments":["word-search","[gameId]","find"],"methods":["POST"],"query":[]},
  {"path":"word-search/[gameId]/give-up","segments":["word-search","[gameId]","give-up"],"methods":["POST"],"query":[]},
  {"path":"word-search/[gameId]","segments":["word-search","[gameId]"],"methods":["GET"],"query":[]},
  {"path":"word-search","segments":["word-search"],"methods":["GET","POST"],"query":[]}
] as const;
export type GameApiId = typeof GAME_API_ROUTES[number]["path"];

/** Alleen bekende methoden, vaste paden en expliciete queryvelden. Geen credentials in URLs. */
export function gameApiRoute(raw: string, method: string) {
  if (raw.length > 8192 || !raw.startsWith('/api/') || /[\\\s#]/.test(raw) || /%(?![0-9a-f]{2})/i.test(raw)) return null;
  const rawPath = raw.split('?')[0];
  if (rawPath.split('/').some(part => /^(?:\.|%2e){1,2}$/i.test(part))) return null;
  let url: URL; try { url = new URL(raw, 'https://game.invalid'); } catch { return null; }
  if (url.origin !== 'https://game.invalid' || url.username || url.password || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const input = url.pathname.slice(5).split('/');
  for (const route of GAME_API_ROUTES) {
    if (!(route.methods as readonly string[]).includes(method) || route.segments.length !== input.length || keys.some(key => !(route.query as readonly string[]).includes(key))) continue;
    const params: Record<string,string> = {};
    if (!route.segments.every((part,index) => {
      if (!part.startsWith('[')) return part === input[index];
      const name = part.slice(1,-1);
      let value = input[index];
      if (name === 'word') {
        try { value = decodeURIComponent(value); } catch { return false; }
        if (!/^[\p{L}\p{M}'’-]{1,64}$/u.test(value)) return false;
      } else if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return false;
      params[name] = value; return true;
    })) continue;
    if(route.path==="list-order"&&(method==="GET"?(keys.length!==1||url.searchParams.get("listKey")!=="games"):keys.length!==0))return null;
    return { id: route.path, params, path: route.segments.map(part => part.startsWith('[') ? encodeURIComponent(params[part.slice(1,-1)]) : part).join('/'), search: url.search };
  }
  return null;
}
