// Opt-in ontwikkelconfiguratie. Schrijft alleen stdout; verandert geen stack of productieconfiguratie.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// De spelroutes komen uit dezelfde expliciete tabellen als de native client (TS) en Swift/Java-policies;
// Node 24 haalt de typen er zelf af. Geen tweede routelijst om bij te houden: tests/native-test-api-games.test.ts
// bewijst dat elk verzoek dat de client kan sturen hier doorkomt en dat de rest geweigerd blijft.
import { GAME_API_ROUTES } from '../../src/lib/native/gamesRoutes.ts';
import { GAME_PAGE_ROUTES } from '../../src/lib/native/gamesPagesRoutes.ts';

export const TEST_API_HOST = 'api-test.versado.app'; // Voorstel; eigenaar moet DNS/uitrol apart goedkeuren.
const id = '[A-Za-z0-9_-]{1,128}';
const reader = `courses/${id}/read/(?:steps|chapters)/${id}`;
// Toegestane procentcoderingen op deze rand, en nergens anders (de rest van `%` blijft 404, ook %25 en %2E):
//  - %2F %3F %3D %26: alleen binnen de waarde van games/page?route= (encodeURIComponent van een spelroute);
//  - %20 %2C en niet-ASCII-bytes (%80-%FF, UTF-8): alleen in waarden van spelvragen en het woord van dictionary/[word].
const ENCODED_BYTE = '%[89A-F][0-9A-F]';
// Herhalingen met `+`: PCRE weigert grote {n,m}-herhalingen van groepen ("regular expression is too large"); de lengte
// wordt begrensd door nginx (verzoekregel max. 8k), de client-allowlists (max. 4096/8192) en de backend.
const WORD = `(?:[A-Za-z'-]|${ENCODED_BYTE})+`;
const QUERY_VALUE = `(?:[A-Za-z0-9._~-]|%20|%2C|${ENCODED_BYTE})+`;
const literal = (part) => part.replace(/[.]/g, '[.]');
const gameSegments = (segments) => segments.map((part) => (part === '[word]' ? WORD : part.startsWith('[') ? id : literal(part))).join('/');
// Query van een API-route: alleen de benoemde sleutels, elk hoogstens eenmaal (PCRE-lookahead), geen lege query.
function apiQuery(keys) {
  if (keys.length === 0) return '';
  const alt = keys.map(literal).join('|');
  const unique = keys.length > 1 ? '(?!(?:[^&]*&)*?([A-Za-z]+)=[^&]*&(?:[^&]*&)*?\\1=)' : '';
  return `(?:[?]${unique}(?:${alt})=${QUERY_VALUE}(?:&(?:${alt})=${QUERY_VALUE}){0,${keys.length - 1}})?`;
}
// De route-waarde van games/page: één geëncodeerde spelroute uit GAME_PAGE_ROUTES; query alleen met de sleutels van die rij.
const PAGE_ATOM = '(?:[A-Za-z0-9_~-]|[.](?![.])|%2F(?=[A-Za-z0-9_-])|%3F|%3D)';
function pageRoute(row) {
  const path = row.segments.map((part) => (part.startsWith('[') ? id : literal(part))).join('%2F');
  if (row.query.length === 0) return `%2F${path}`;
  const alt = row.query.map(literal).join('|');
  const unique = row.query.length > 1 ? '(?!(?:.*?%26)?([A-Za-z]+)%3D.*?%26\\1%3D)' : '';
  const pair = `(?:${alt})%3D${PAGE_ATOM}+`;
  return `%2F${path}(?:%3F${unique}${pair}(?:%26${pair}){0,${row.query.length - 1}})?`;
}
const gamePageRoutes = GAME_PAGE_ROUTES.map((row) => ['GET', `games/page[?]route=${pageRoute(row)}`]);
const gameApiRoutes = GAME_API_ROUTES.map((route) => [`(?:${route.methods.join('|')})`, `games/${gameSegments(route.segments)}${apiQuery(route.query)}`]);
const gameIndex = '(?:0|[1-9][0-9]?|[1-4][0-9]{2})';
const gameMediaRoutes = [
  ['GET', `games/reading/${id}/annotations(?:/${id})?`],
  ['POST', `games/reading/${id}/annotations`],
  ['GET', `games/(?:reading/${id}|(?:intro-solo|intro-live|ak-solo|ak-live)/${id}/${gameIndex})/audio/playback`],
  ['(?:GET|HEAD)', `games/(?:reading/${id}|(?:intro-solo|intro-live)/${id}/${gameIndex})/audio/[a-f0-9]{64}/stream`],
];
export const gameRoutes = [...gamePageRoutes, ...gameApiRoutes, ...gameMediaRoutes];

export const routes = [
  ['GET', '(?:capabilities|me|today|today-overview|profile|content-context|courses)'],
  ['GET', `(?:chapters|study-media)/${id}`],
  ['GET', `courses/${id}/(?:path|weeks|archive)`],
  ['GET', `courses/${id}/weeks/${id}/steps`],
  ['GET', `${reader}(?:/audio(?:/playback)?|/annotations(?:/${id})?|/resume)?`],
  ['GET', `${reader}/learning/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`],
  ['POST', '(?:login|register|forgot-password|reset-password|verify-email|refresh|logout|security-setup/(?:complete|cancel)|apple/(?:challenge|complete)|account/password|profile(?:/two-factor)?|realtime/session|content-context|today-actions/(?:hide|friend-response))'],
  ['POST', `chapters/${id}/complete`],
  ['POST', `${reader}/(?:learning/(?:start|submit|read|check)|annotations|position)`],
  ['DELETE', '(?:apple|account)'], // account blijft 404 totdat WP4 bewust geïntegreerd is.
  ['(?:GET|HEAD)', `${reader}/audio/[a-f0-9]{64}/stream`],
  ...gameRoutes,
];
export function render(base = readFileSync('deploy/nginx/nginx.conf', 'utf8')) {
  base = base.replace('    server_tokens off;', '    server_tokens off;\n    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;');
  const rules = routes.map(([method, path]) => `    "~^${method}:/api/v1/native/${path}$" 1;`).join('\n');
  // Eén OPTIONS-regel per route (geen gecombineerde alternatie): spelroutes bevatten terugverwijzingen in hun regex.
  const optionsRules = routes.map(([, path]) => `    "~^OPTIONS:/api/v1/native/${path}$" 1;`).join('\n');
  const extra = `
  # Alleen op de bestaande DEVELOPMENT-proxy laden; listener uitsluitend voor de tunnel.
  map "$request_method:$request_uri" $native_test_route {
    default 0;
${rules}
${optionsRules}
    "~^GET:/socket[.]io/\\?(?:EIO=4&transport=websocket|transport=websocket&EIO=4)$" 1;
  }
  map $http_origin $native_test_origin {
    default 0;
    "capacitor://localhost" 1;
    "https://localhost" 1;
  }
  server {
    listen 8081 default_server;
    server_name ${TEST_API_HOST};
    server_tokens off;
    access_log off;
    # Ook foutlogs bevatten geen request-URLs, cookies of headers.
    error_log /dev/null;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Cache-Control "private, no-store, no-transform" always;
    add_header Permissions-Policy "camera=(), microphone=(self), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    if ($host != ${TEST_API_HOST}) { return 404; }
    if ($native_test_origin = 0) { return 403; }
    # Controleer de ruwe URI: nginx-normalisatie mag traversal of encoding niet toelaten.
    # nginx haalt één backslash weg uit de aanhalingstekens: vier tekens geven hier een regex voor één letterlijke backslash.
    # Procentcodering alleen voor de vaste, hierboven beschreven bytes; %25 (dubbele codering), %2E, %00, %5C enz. blijven 404.
    if ($request_uri ~ "%(?!(?:2F|3F|3D|26|20|2C|[89A-F][0-9A-F]))|\\\\\\\\|//|/\\.\\.?(?:/|$)") { return 404; }
    if ($native_test_route = 0) { return 404; }
    client_max_body_size 16k;
    location / {
      proxy_pass http://jehova-app:3000;
      proxy_http_version 1.1;
      proxy_set_header Host ${TEST_API_HOST};
      proxy_set_header X-Forwarded-Host ${TEST_API_HOST};
      proxy_set_header X-Forwarded-Proto https;
      # Alleen vertrouwde cloudflared mag deze listener bereiken.
      proxy_set_header X-Real-IP $http_cf_connecting_ip;
      proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
      proxy_set_header Cookie "";
      proxy_set_header CF-Access-Client-Id "";
      proxy_set_header CF-Access-Client-Secret "";
      proxy_set_header CF-Access-Jwt-Assertion "";
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_hide_header Set-Cookie;
      proxy_hide_header X-Robots-Tag;
      proxy_hide_header Cache-Control;
      proxy_buffering off;
      proxy_request_buffering off;
      proxy_cache off;
      proxy_read_timeout 3600s;
      proxy_intercept_errors off;
    }
  }
`;
  if (!base.trimEnd().endsWith('}')) throw new Error('nginx http-configuratie ongeldig');
  return base.trimEnd().slice(0,-1) + extra + '}\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(render());
