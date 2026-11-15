// Verzoeken die de native Spelen-client kan sturen (afgeleid van dezelfde expliciete routetabellen) en
// verzoeken die de store-test-rand moet weigeren. Puur Node (geen aliassen): ook bruikbaar in de Docker-integratietest.
import { GAME_API_ROUTES, gameApiRoute } from '../../src/lib/native/gamesRoutes.ts';
import { GAME_PAGE_ROUTES, gamePageRoute } from '../../src/lib/native/gamesPagesRoutes.ts';

const PAGE_QUERY_SAMPLE = {
  tab: 'required', challengeId: 'abc123', cursus: 'abc123', vers: '12', returnTo: '/mysteries/001a/play?resume=completed',
  kompas: 'play', view: 'leaderboard', availability: 'unavailable', resume: 'completed', mode: 'SOLO', cat: 'NO_HINTS',
};
const API_QUERY_SAMPLE = {
  tab: 'required', offset: '0', limit: '10', listKey: 'games', variant: 'abc123', cursor: 'abc123', variantId: 'abc123', imageId: 'abc123',
  pieceCount: '24', difficulty: 'EASY', mode: 'SOLO', hintCategory: 'NO_HINTS', type: 'weekly', board: 'all', absent: '1',
  ids: 'a1,b2', q: 'jan jansen',
};
const fill = (path) => path.replace(/\[word\]/, 'zondaar').replace(/\[[^\]]+\]/g, 'abc123');
const enc = encodeURIComponent;

/** Elk geldig verzoek dat de client kan sturen: [methode, request-uri na /api/v1/native/]. */
export function clientRequests() {
  const out = [];
  for (const row of GAME_PAGE_ROUTES) {
    const base = fill(row.path);
    const variants = [base];
    for (const key of row.query) {
      const route = `${base}?${key}=${PAGE_QUERY_SAMPLE[key]}`;
      if (gamePageRoute(route)) variants.push(route);
    }
    if (row.query.length > 1) { // twee verschillende sleutels tegelijk, als de client die toestaat
      const [a, b] = row.query; const route = `${base}?${a}=${PAGE_QUERY_SAMPLE[a]}&${b}=${PAGE_QUERY_SAMPLE[b]}`;
      if (gamePageRoute(route)) variants.push(route);
    }
    if (variants.length === 1 && row.query.length) throw new Error(`geen geldig queryvoorbeeld voor ${row.path}`);
    for (const route of variants) {
      if (!gamePageRoute(route)) throw new Error(`voorbeeldroute ongeldig voor de client: ${route}`);
      out.push(['GET', `games/page?route=${enc(route)}`]);
    }
  }
  for (const route of GAME_API_ROUTES) {
    for (const method of route.methods) {
      const base = `games/${fill(route.path)}`;
      const variants = [base];
      for (const key of route.query) variants.push(`${base}?${key}=${enc(API_QUERY_SAMPLE[key] ?? 'x1')}`);
      for (const uri of variants) {
        if (!gameApiRoute(`/api/${uri.slice(6)}`, method)) continue; // clientregels (bv. list-order) bepalen wat geldig is
        out.push([method, uri]);
      }
    }
  }
  out.push(['GET', `games/dictionary/${enc('één')}`], ['GET', `games/dictionary/${enc('zondaar’s')}`]);
  const hex = 'a'.repeat(64);
  out.push(['GET', 'games/reading/ch1/annotations'], ['POST', 'games/reading/ch1/annotations'], ['GET', 'games/reading/ch1/annotations/v1'],
    ['GET', 'games/reading/ch1/audio/playback'], ['GET', 'games/intro-solo/q1/0/audio/playback'], ['GET', 'games/ak-live/q1/499/audio/playback'],
    ['GET', `games/reading/ch1/audio/${hex}/stream`], ['HEAD', `games/reading/ch1/audio/${hex}/stream`], ['GET', `games/intro-live/q1/12/audio/${hex}/stream`]);
  return out;
}

const page = (route) => `games/page?route=${route}`;
/** Verzoeken die geweigerd moeten blijven: [omschrijving, methode, request-uri na /api/v1/native/]. */
export const rejectedRequests = [
  ['pagina met verkeerde methode', 'POST', page('%2Flive')], ['pagina DELETE', 'DELETE', page('%2Flive')],
  ['pagina zonder query', 'GET', 'games/page'], ['pagina met lege route', 'GET', page('')],
  ['pagina onbekende route', 'GET', page('%2Fonbekend')], ['pagina ongecodeerde route', 'GET', page('/live')],
  ['pagina extra queryparameter', 'GET', `${page('%2Flive')}&token=geheim`], ['pagina dubbele route-parameter', 'GET', `${page('%2Flive')}&route=%2Fshop`],
  ['pagina andere eerste parameter', 'GET', 'games/page?token=1&route=%2Flive'],
  ['pagina onbekende sleutel in route', 'GET', page('%2Flive%3Fbad%3D1')], ['pagina dubbele sleutel in route', 'GET', page('%2Flive%3Fkompas%3Dplay%26kompas%3Dplay')],
  ['pagina sleutel van een andere route', 'GET', page('%2Fshop%3Fkompas%3Dplay')],
  ['dubbele codering %25', 'GET', page('%252Flive')], ['dubbele codering in sleutel', 'GET', page('%2Flive%3Fkompas%253Dplay')],
  ['traversal %2F..', 'GET', page('%2F..%2Flive')], ['traversal in route', 'GET', page('%2Fjigsaw%2F..%2Fadmin')], ['lege segmenten %2F%2F', 'GET', page('%2F%2Flive')],
  ['dotsegment', 'GET', page('%2F.%2Flive')], ['kleine hex %2f', 'GET', page('%2flive')], ['nulbyte', 'GET', page('%2Flive%00')],
  ['backslash %5C', 'GET', page('%5Clive')], ['punt-gecodeerd %2E', 'GET', page('%2E%2E%2Flive')], ['spatie', 'GET', page('%2Flive%20x')],
  ['ongeldige procentcodering', 'GET', page('%2Flive%2')], ['hash', 'GET', page('%2Flive%23x')],
  ['onbekende games-route', 'GET', 'games/admin'], ['games-wortel', 'GET', 'games'], ['games/ zonder pad', 'GET', 'games/'],
  ['API verkeerde methode (GET op POST)', 'GET', 'games/nudges'], ['API verkeerde methode (POST op GET)', 'POST', 'games/shop'],
  ['API DELETE op GET-route', 'DELETE', 'games/shop'], ['API extra queryparameter', 'GET', 'games/open-actions?tab=required&token=geheim'],
  ['API dubbele parameter', 'GET', 'games/open-actions?tab=a&tab=b'], ['API query op route zonder query', 'GET', 'games/shop?x=1'],
  ['API gecodeerde slash in pad', 'POST', 'games/shop%2Ffreezes'], ['API gecodeerde slash in id', 'GET', 'games/chapter-guess/a%2Fb'],
  ['API traversal', 'GET', 'games/shop/../admin'], ['API dubbele slash', 'GET', 'games//shop'], ['API %25 in query', 'GET', 'games/users/search?q=a%25b'],
  ['API %2F in query', 'GET', 'games/users/search?q=a%2Fb'], ['API %00 in query', 'GET', 'games/users/search?q=a%00b'],
  ['API %2E in query', 'GET', 'games/users/search?q=%2E%2E'], ['API %26 in query', 'GET', 'games/users/search?q=a%26b%3Dc'],
  ['woord met ASCII-codering', 'GET', 'games/dictionary/a%2Fb'], ['woord met %25', 'GET', 'games/dictionary/%2541'], ['woord met cijfer', 'GET', 'games/dictionary/abc1'],
  ['audio ak-stream', 'GET', `games/ak-solo/q1/1/audio/${'a'.repeat(64)}/stream`], ['audio verkeerde index', 'GET', 'games/intro-solo/q1/500/audio/playback'],
  ['audio POST', 'POST', 'games/reading/ch1/audio/playback'], ['audio korte hash', 'GET', `games/reading/ch1/audio/${'a'.repeat(63)}/stream`],
  ['annotatie DELETE', 'DELETE', 'games/reading/ch1/annotations/v1'], ['annotatie POST op item', 'POST', 'games/reading/ch1/annotations/v1'],
  ['bestaande route met %-codering', 'GET', '%63apabilities'], ['bestaande route met query', 'GET', 'capabilities?token=secret'],
];
