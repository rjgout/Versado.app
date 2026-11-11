# Altijd-actieve reverse proxy vóór jehova-app — zie CLAUDE.md /
# docs/DEPLOY-SYNOLOGY.md voor waarom deze er is (voorkomt dat bezoekers een
# Cloudflare-foutpagina zien tijdens het updaten van jehova-app).
# Alleen het expliciete development-target heeft Node/generator nodig.
FROM node:24-alpine AS development-config
WORKDIR /config
COPY deploy/nginx/nginx.conf deploy/nginx/nginx.conf
COPY scripts/native/render-test-api-proxy.mjs scripts/native/render-test-api-proxy.mjs
RUN node scripts/native/render-test-api-proxy.mjs > /config/nginx.conf

FROM nginx:alpine AS proxy-base
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/maintenance.html /usr/share/nginx/html/maintenance.html
COPY public/mascots/static/family/family-support.webp /usr/share/nginx/html/maintenance-assets/family-support.webp

# De bestaande website, branding en onderhoudsassets blijven in dezelfde proxy.
FROM proxy-base AS development
COPY --from=development-config /config/nginx.conf /etc/nginx/nginx.conf
EXPOSE 8081

# Standaardtarget voor main: uitsluitend de oorspronkelijke productieconfiguratie.
FROM proxy-base AS production
