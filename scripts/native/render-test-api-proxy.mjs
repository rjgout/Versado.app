// Opt-in ontwikkelconfiguratie. Schrijft alleen stdout; verandert geen stack of productieconfiguratie.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_API_HOST = 'api-test.versado.app'; // Voorstel; eigenaar moet DNS/uitrol apart goedkeuren.
const id = '[A-Za-z0-9_-]{1,128}';
const reader = `courses/${id}/read/(?:steps|chapters)/${id}`;
export const routes = [
  ['GET', '(?:capabilities|me|today|today-overview|content-context|courses)'],
  ['GET', `(?:chapters|study-media)/${id}`],
  ['GET', `courses/${id}/(?:path|weeks|archive)`],
  ['GET', `courses/${id}/weeks/${id}/steps`],
  ['GET', `${reader}(?:/audio(?:/playback)?|/annotations(?:/${id})?|/resume)?`],
  ['GET', `${reader}/learning/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`],
  ['POST', '(?:login|register|forgot-password|reset-password|verify-email|refresh|logout|security-setup/(?:complete|cancel)|apple/(?:challenge|complete)|account/password|realtime/session|content-context|today-actions/(?:hide|friend-response))'],
  ['POST', `chapters/${id}/complete`],
  ['POST', `${reader}/(?:learning/(?:start|submit|read|check)|annotations|position)`],
  ['DELETE', '(?:apple|account)'], // account blijft 404 totdat WP4 bewust geïntegreerd is.
  ['(?:GET|HEAD)', `${reader}/audio/[a-f0-9]{64}/stream`],
];
export function render(base = readFileSync('deploy/nginx/nginx.conf', 'utf8')) {
  base = base.replace('    server_tokens off;', '    server_tokens off;\n    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;');
  const rules = routes.map(([method, path]) => `    "~^${method}:/api/v1/native/${path}$" 1;`).join('\n');
  const extra = `
  # Alleen op de bestaande DEVELOPMENT-proxy laden; listener uitsluitend voor de tunnel.
  map "$request_method:$request_uri" $native_test_route {
    default 0;
${rules}
    "~^OPTIONS:/api/v1/native/(?:${routes.map(([, path]) => path).join('|')})$" 1;
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
    if ($request_uri ~ "%|\\\\|//|/\\.\\.?(?:/|$)") { return 404; }
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
