/** Alle bestaande spelpagina's; uitbreiding is expliciet en reviewbaar. */
export const GAME_PAGE_ROUTES = [
  {"path":"/kompas/play","segments":["kompas","play"],"query":[]},
  {"path":"/kompas/play.jigsaw","segments":["kompas","play.jigsaw"],"query":[]},
  {"path":"/kompas/play.word-search","segments":["kompas","play.word-search"],"query":[]},
  {"path":"/kompas/play.word-game","segments":["kompas","play.word-game"],"query":[]},
  {"path":"/kompas/play.scrabble","segments":["kompas","play.scrabble"],"query":[]},
  {"path":"/kompas/play.alleskenner","segments":["kompas","play.alleskenner"],"query":[]},
  {"path":"/kompas/play.gezinsavond","segments":["kompas","play.gezinsavond"],"query":[]},
  {"path":"/kompas/play.chapter-guess","segments":["kompas","play.chapter-guess"],"query":[]},
  {"path":"/kompas/play.challenges","segments":["kompas","play.challenges"],"query":[]},
  {"path":"/kompas/play.quick-missionary","segments":["kompas","play.quick-missionary"],"query":[]},
  {"path":"/kompas/play.mystery","segments":["kompas","play.mystery"],"query":[]},

  {"path":"/acties","segments":["acties"],"query":["tab"]},
  {"path":"/lesson/[chapterId]","segments":["lesson","[chapterId]"],"query":["challengeId","cursus","vers","returnTo"]},
  {"path":"/alleskenner/alleen/[id]","segments":["alleskenner","alleen","[id]"],"query":[]},
  {"path":"/alleskenner/alleen","segments":["alleskenner","alleen"],"query":[]},
  {"path":"/alleskenner","segments":["alleskenner"],"query":[]},
  {"path":"/alleskenner/seizoen/[id]","segments":["alleskenner","seizoen","[id]"],"query":[]},
  {"path":"/alleskenner/seizoen","segments":["alleskenner","seizoen"],"query":[]},
  {"path":"/challenges","segments":["challenges"],"query":[]},
  {"path":"/chapter-guess","segments":["chapter-guess"],"query":[]},
  {"path":"/chapter-guess/solo/[gameId]","segments":["chapter-guess","solo","[gameId]"],"query":[]},
  {"path":"/gezinsavond","segments":["gezinsavond"],"query":[]},
  {"path":"/jigsaw/afgerond","segments":["jigsaw","afgerond"],"query":[]},
  {"path":"/jigsaw","segments":["jigsaw"],"query":[]},
  {"path":"/jigsaw/records/[variantId]","segments":["jigsaw","records","[variantId]"],"query":["mode","cat"]},
  {"path":"/jigsaw/records","segments":["jigsaw","records"],"query":[]},
  {"path":"/jigsaw/samen/[id]","segments":["jigsaw","samen","[id]"],"query":[]},
  {"path":"/jigsaw/wedstrijd/[id]","segments":["jigsaw","wedstrijd","[id]"],"query":[]},
  {"path":"/live/[code]","segments":["live","[code]"],"query":[]},
  {"path":"/live","segments":["live"],"query":["availability","kompas"]},
  {"path":"/mysteries/001","segments":["mysteries","001"],"query":[]},
  {"path":"/mysteries/001a","segments":["mysteries","001a"],"query":[]},
  {"path":"/mysteries/001a/play","segments":["mysteries","001a","play"],"query":["resume"]},
  {"path":"/mysteries/001b","segments":["mysteries","001b"],"query":[]},
  {"path":"/mysteries/001b/play","segments":["mysteries","001b","play"],"query":["resume"]},
  {"path":"/mysteries/001c","segments":["mysteries","001c"],"query":[]},
  {"path":"/mysteries/001c/play","segments":["mysteries","001c","play"],"query":["resume"]},
  {"path":"/mysteries/002","segments":["mysteries","002"],"query":[]},
  {"path":"/mysteries/002a","segments":["mysteries","002a"],"query":[]},
  {"path":"/mysteries/002a/play","segments":["mysteries","002a","play"],"query":["resume"]},
  {"path":"/mysteries/002b","segments":["mysteries","002b"],"query":[]},
  {"path":"/mysteries/002b/play","segments":["mysteries","002b","play"],"query":["resume"]},
  {"path":"/mysteries/002c","segments":["mysteries","002c"],"query":[]},
  {"path":"/mysteries/002c/play","segments":["mysteries","002c","play"],"query":["resume"]},
  {"path":"/mysteries/003","segments":["mysteries","003"],"query":[]},
  {"path":"/mysteries/003a","segments":["mysteries","003a"],"query":[]},
  {"path":"/mysteries/003a/play","segments":["mysteries","003a","play"],"query":["resume"]},
  {"path":"/mysteries/003b","segments":["mysteries","003b"],"query":[]},
  {"path":"/mysteries/003b/play","segments":["mysteries","003b","play"],"query":["resume"]},
  {"path":"/mysteries/003c","segments":["mysteries","003c"],"query":[]},
  {"path":"/mysteries/003c/play","segments":["mysteries","003c","play"],"query":["resume"]},
  {"path":"/mysteries/004","segments":["mysteries","004"],"query":[]},
  {"path":"/mysteries/004a","segments":["mysteries","004a"],"query":[]},
  {"path":"/mysteries/004a/play","segments":["mysteries","004a","play"],"query":["resume"]},
  {"path":"/mysteries/004b","segments":["mysteries","004b"],"query":[]},
  {"path":"/mysteries/004b/play","segments":["mysteries","004b","play"],"query":["resume"]},
  {"path":"/mysteries/004c","segments":["mysteries","004c"],"query":[]},
  {"path":"/mysteries/004c/play","segments":["mysteries","004c","play"],"query":["resume"]},
  {"path":"/mysteries/005","segments":["mysteries","005"],"query":[]},
  {"path":"/mysteries/005a","segments":["mysteries","005a"],"query":[]},
  {"path":"/mysteries/005a/play","segments":["mysteries","005a","play"],"query":["resume"]},
  {"path":"/mysteries/005b","segments":["mysteries","005b"],"query":[]},
  {"path":"/mysteries/005b/play","segments":["mysteries","005b","play"],"query":["resume"]},
  {"path":"/mysteries/005c","segments":["mysteries","005c"],"query":[]},
  {"path":"/mysteries/005c/play","segments":["mysteries","005c","play"],"query":["resume"]},
  {"path":"/mysteries/006","segments":["mysteries","006"],"query":[]},
  {"path":"/mysteries/006a","segments":["mysteries","006a"],"query":[]},
  {"path":"/mysteries/006a/play","segments":["mysteries","006a","play"],"query":["resume"]},
  {"path":"/mysteries/006b","segments":["mysteries","006b"],"query":[]},
  {"path":"/mysteries/006b/play","segments":["mysteries","006b","play"],"query":["resume"]},
  {"path":"/mysteries/006c","segments":["mysteries","006c"],"query":[]},
  {"path":"/mysteries/006c/play","segments":["mysteries","006c","play"],"query":["resume"]},
  {"path":"/mysteries","segments":["mysteries"],"query":[]},
  {"path":"/scrabble/[gameId]","segments":["scrabble","[gameId]"],"query":[]},
  {"path":"/scrabble","segments":["scrabble"],"query":[]},
  {"path":"/snelle-zendeling","segments":["snelle-zendeling"],"query":["view"]},
  {"path":"/snelle-zendeling/run/[runId]","segments":["snelle-zendeling","run","[runId]"],"query":[]},
  {"path":"/snelle-zendeling/samen/[code]","segments":["snelle-zendeling","samen","[code]"],"query":[]},
  {"path":"/word-game","segments":["word-game"],"query":[]},
  {"path":"/word-search/[gameId]","segments":["word-search","[gameId]"],"query":[]},
  {"path":"/word-search","segments":["word-search"],"query":[]}
] as const;
export type GamePageId = typeof GAME_PAGE_ROUTES[number]['path'];

export function gamePageRoute(raw:string) {
  if(raw.length>4096 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\s#]/.test(raw)||raw.split("?")[0].includes("%"))return null;
  let url:URL;try{url=new URL(raw,'https://game.invalid');}catch{return null;}
  if(url.origin!=='https://game.invalid'||url.pathname!==raw.split('?')[0])return null;
  const parts=url.pathname.slice(1).split('/'),keys=[...url.searchParams.keys()];
  if(new Set(keys).size!==keys.length)return null;
  for(const row of GAME_PAGE_ROUTES){
    if(parts.length!==row.segments.length||keys.some(k=>!(row.query as readonly string[]).includes(k)))continue;
    const params:Record<string,string>={};
    if(!row.segments.every((part,i)=>{if(!part.startsWith('['))return part===parts[i];if(!/^[A-Za-z0-9_-]{1,128}$/.test(parts[i]))return false;params[part.slice(1,-1)]=parts[i];return true;}))continue;
    const query=Object.fromEntries(url.searchParams);
    if(Object.values(query).some(value=>!value))return null;
    if(query.challengeId&&!/^[A-Za-z0-9_-]{1,128}$/.test(query.challengeId)||query.cursus&&!/^[A-Za-z0-9_-]{1,128}$/.test(query.cursus)||query.vers&&!/^(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)$/.test(query.vers))return null;
    if(query.returnTo&&(!query.returnTo.startsWith("/mysteries/")||!gamePageRoute(query.returnTo)))return null;
    if(query.kompas&&query.kompas!=='play')return null;
    if(query.tab&&!['required','continue','waiting'].includes(query.tab))return null;
    if(query.view&&query.view!=='leaderboard')return null;
    if(query.availability&&query.availability!=='unavailable'||query.resume&&query.resume!=='completed'||query.mode&&!['SOLO','MATCH'].includes(query.mode)||query.cat&&!['NO_HINTS','WITH_HINTS'].includes(query.cat))return null;
    return {id:row.path,params,query,href:url.pathname+url.search};
  }
  return null;
}

/** Een oude Foundation-leeslink houdt zijn bestaande blokkade totdat de
 * backend de nieuwe volledige spel-/leespoort werkelijk aanbiedt. */
export function nativeGameOwnsRoute(href:string,features:readonly string[]){
 const route=gamePageRoute(href);
 return !!route&&(route.id!=="/lesson/[chapterId]"||features.includes("games-v1"));
}
