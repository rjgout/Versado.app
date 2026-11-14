/** Dezelfde procesgrens als realtime.ts: een read-only verwijzing naar de
 * echte spelserver, geen tweede kamers-/spelcache in een Next-routebundle. */
type Selection={kind:"ak-solo"|"ak-live";id:string;index:number};
type Reader=(userId:string,selection:Selection)=>Promise<{text:string;language:string}|null>;
const processState=globalThis as typeof globalThis & {__versadoGameListeningReader?:Reader};
export function registerGameListeningReader(reader:Reader){processState.__versadoGameListeningReader=reader;}
export function gameListeningSource(userId:string,selection:Selection){return processState.__versadoGameListeningReader?.(userId,selection)??Promise.resolve(null);}
