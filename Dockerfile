# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
# openssl/libc6-compat: benodigd door de Prisma query engine op Alpine (musl)
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ARG NEXT_PUBLIC_BUILD_SHA=unknown
ENV NEXT_PUBLIC_BUILD_SHA=$NEXT_PUBLIC_BUILD_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ARG NEXT_PUBLIC_BUILD_SHA=unknown
ENV NODE_ENV=production
# Eigen kopie van de voorgelezen hoofdstukken (zie src/lib/audioMirror.ts).
# Koppel hier een volume of map aan, anders gaat de kopie bij elke nieuwe
# container verloren en wordt hij bij de volgende contentlading opnieuw gehaald.
ENV AUDIO_DIR=/data/audio
ENV NEXT_PUBLIC_BUILD_SHA=$NEXT_PUBLIC_BUILD_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY package.json package-lock.json ./
COPY next.config.js ./
COPY tsconfig.json ./
COPY server.ts ./
COPY src ./src
# De Prisma-client wordt in de builder gegenereerd (src/generated staat niet
# in git) en is nodig voor server.ts, dat via tsx draait.
COPY --from=builder /app/src/generated ./src/generated
COPY prisma ./prisma
# Verbindings-URL en migratiemap voor `prisma migrate deploy` hieronder.
COPY prisma.config.ts ./
# Statische bestanden (bv. de kindercursus-afbeeldingen in public/kids/images)
# worden niet in .next meegebundeld — zonder deze COPY draait de app prima,
# maar 404en al zulke bestanden in productie.
COPY public ./public
RUN npm prune --omit=dev

EXPOSE 3000

# Kritiek voor Docker Compose depends_on/orchestratie: geeft aan of de app
# (en de databaseverbinding) daadwerkelijk gezond is, niet alleen of het
# proces draait. Node heeft een ingebouwde fetch(), dus geen curl/wget nodig.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Retry rond 'migrate deploy': depends_on/service_healthy laat de database-
# container meestal op tijd klaarstaan, maar dit vangt de korte race op
# tussen "pg_isready" en "daadwerkelijk klaar voor migraties" op.
# recoverFailedMigrations.ts maakt vooraf alleen bekende, veilig herhaalbare
# mislukte migraties vrij (zie dat bestand); anders blijft P3009 elke start
# blokkeren, ook nadat de migratie gerepareerd is.
CMD ["sh", "-c", "\
  ok=0; \
  for i in $(seq 1 10); do \
    npx tsx prisma/recoverFailedMigrations.ts; \
    npx prisma migrate deploy && ok=1 && break; \
    echo 'Database nog niet klaar, opnieuw proberen...'; sleep 3; \
  done; \
  if [ \"$ok\" != 1 ]; then echo 'Kon migraties niet toepassen, stoppen.'; exit 1; fi; \
  npm start \
"]
