# Backend-aandachtspunt: Prisma-transactie verloopt bij een vriendenverzoek accepteren

Status: **vastgelegd, niet opgelost**. Gevonden tijdens de native runtime-proef (PR #286, run 38 op een trage CI-runner).
Dit is een afzonderlijk backendpunt: de proef zelf wijzigt de backend niet. Beoordeling en eventuele aanpassing zijn aan de eigenaar.

## Wat er gebeurde

`POST /api/v1/native/games/friends/{id}/accept` gaf op de **eerste, koude** aanroep een **500** na 8,1 s:

```
Invalid `tx.podcastEpisodeProgress.count()` invocation
Transaction API error: A query cannot be executed on an expired transaction.
The timeout for this transaction was 5000 ms, however 5161 ms passed since the start of the transaction.
```

De app toonde correct "Accepteren mislukt. Probeer het opnieuw." en bleef bruikbaar. Na het opwarmen van de route slaagde dezelfde
aanroep in ±1 s (200), en drie opeenvolgende runs daarna gaven geen enkele 500.

## Waarom (uit de code)

- `src/lib/social/friendRequests.ts` → `respondFriendRequest` accepteert in `commitAccountMutation` (`src/lib/account/mutation.ts`).
- Die gebruikt `prisma.$transaction(…, { maxWait: 2000, timeout: 5000 })` met `SET LOCAL lock_timeout = '1500ms'`.
- Binnen die ene transactie draait `checkAndAwardAchievements(tx, id)` **voor beide gebruikers** (`src/lib/achievements.ts`).
  Elke controle is een aparte, opeenvolgende databasequery (±31 definities per gebruiker, dus ruim 60 round trips) plus de
  `UserAchievement`-schrijfacties bij een nieuwe prestatie.
- Een koude route (eerste compilatie in de dev-server), een koude databasecache of een trage schijf/CPU maakt elke round trip
  duurder. De som overschrijdt dan de 5 s, de transactie verloopt en de **hele acceptatie wordt teruggedraaid**.

## Risico voor productie

- Op de NAS-Postgres kan hetzelfde gebeuren na een herstart (koude cache), tijdens zware achtergrondtaken (scheduler, feedsync) of
  bij gelijktijdige accepteeracties. De gebruiker ziet dan een fout terwijl er niets is veranderd.
- Het is een **robuustheidsrisico, geen beveiligings- of dataverliesrisico**: de transactie wordt volledig teruggedraaid en
  accepteren is idempotent (herhalen geeft 200). Een mobiele client moet daarom bij een 500 veilig opnieuw kunnen proberen.
- Hetzelfde patroon (prestatiecontrole binnen de kritieke transactie) staat ook in `streak.ts` en `friendStreaks.ts`; het is niet
  nagegaan of die onder dezelfde omstandigheden verlopen.

## Mogelijke richtingen (niet toegepast)

1. De prestatiecontrole **na** de commit in een eigen transactie uitvoeren (een mislukte prestatiecontrole mag het accepteren niet
   terugdraaien; de prestatie kan bij de volgende activiteit alsnog worden toegekend).
2. De controles bundelen (minder round trips) of per gebruiker begrenzen tot de definities die door deze actie kunnen veranderen
   (hier alleen de vriendenprestaties).
3. Als noodmaatregel de `timeout` verhogen. Dit verbergt het symptoom en houdt de rijvergrendeling langer vast; liever niet als enige maatregel.

Elke richting raakt de gedeelde accountmutatie en vraagt een eigen beoordeling (vergrendelingsvolgorde, tests voor gelijktijdigheid).

## Hoe te reproduceren

Op een geïsoleerde testdatabase: start de backend vers (koude route en cache), laat een gebruiker een binnenkomend vriendenverzoek
accepteren terwijl de machine zwaar belast is (bijvoorbeeld tijdens een Xcode-build). Zonder belasting en na één opwarmaanroep
treedt het niet op; de proef-CI warmt de route daarom vooraf op met een los testpaar.
