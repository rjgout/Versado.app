# Fase 2 — hintvoorraad, sheet en CTA's

## Onderzoek op main 105c66a

`applySoloAction` registreert extra hints zonder `User.hintBalance` te verlagen.
Het paneel toont alleen het inbegrepen budget en gebruikt afzonderlijke zware
knoppen. Het is geen echte modal: focus kan ontsnappen en het bord blijft actief.
Locatie- en verbindingshints roepen `fit()` aan en verliezen daardoor de camera.
De primaire CTA's hebben geen gezamenlijke lokale breedte.

De winkel, Woordspel en Raad het hoofdstuk delen `User.hintBalance`. Raad het
hoofdstuk combineert een hintclaim en conditionele afschrijving (`gt: 0`) in
een transactie. Puzzels hebben al sessielocks, versies en unieke actionIds.
Antwoorden gebruiken sessie → gebruiker; starten laat zijn gebruikerlock vrij
voordat het een sessielock neemt. Deze volgorde blijft behouden.

## Implementatie

- Eerst de bestaande inbegrepen budgetten: onbeperkt / 3 / 2 / 1. Daarna exact
  één persoonlijke hint, met dezelfde conditionele `User`-update als bestaande
  activiteiten. Geen tweede voorraad, nieuwe valuta of prijswijziging.
- Validatie en targetselectie vóór afschrijving. Sessielock → gebruikerupdate,
  hintlog, snapshot en sessieversie in één transactie. Een rollback herstelt ook
  het saldo. Een bestaande actionId wordt vóór versie/statuscontrole herkend.
- Extra hints vereisen `confirmPersonal: true`. Een verzoek zonder bevestiging
  of zonder saldo maakt geen hint aan. Voorraadwijzigingen na bevestiging worden
  opnieuw server-side beoordeeld.
- Nieuwe hintrecords krijgen `source: INCLUDED | PERSONAL`. Ontbrekende bron
  blijft historische registratie; oude extra hints zijn niet achteraf betaald.
  Alle historische hints tellen mee voor het reeds gebruikte sessiebudget.
  Geometry en spelregelversies 1/2 blijven behouden; deze economische correctie
  geldt uitsluitend voor toekomstige aanvragen, niet voor historische records.
- Start/resume/act geven een actueel server-hintsaldo terug. De client gebruikt
  `/api/hints` via `useLiveQuery`, refetch bij openen en de centrale invalidatie
  na hintverbruik. Een gericht `hints_changed`-signaal bereikt andere apparaten.
  Winkel en bestaande spellen blijven hun gedeelde servervoorraad lezen.
- Het paneel gebruikt de bestaande mobiele-sheetstijl en Versado-tokens, in een
  native modal dialog via een body-portal: focus binnen de sheet, inert bord,
  Escape, focusherstel, intern scrollen en veilige schermranden. Persoonlijke
  bevestiging en sorteer-subkeuze blijven binnen dezelfde sheet.
- De vier hulpmiddelen krijgen dezelfde rustige lijstweergave. Openen en
  sorteer-subkeuze kosten niets; alleen de uiteindelijke hintactie telt.
- Locatie/verbinding behouden camera wanneer zichtbaar; alleen minimaal pannen
  naar een onzichtbaar doel, zonder de zoom te resetten.
- Primaire puzzel-CTA's lokaal `w-full max-w-[440px]`, gecentreerd en minimaal
  48px hoog. De 60px bordknoppen en fullscreen Canvas blijven intact.
- Kompas en alle vijf UI-talen beschrijven inbegrepen en persoonlijke hints.

## Bewijs vóór oplevering

Isolated PostgreSQL met alle migraties: budgetten, saldo 1/0, ongeldige targets,
afgeronde sessie, rollback, retries, concurrentie over dezelfde/twee sessies,
historische records, winkel en spelvoorraad, geen XP/reeks door hintgebruik.
Productie-Chromium met desktop en touch: sheet, focus/inert/Escape, beide
budgetten, bevestiging/annuleren/leegsaldo/winkel/hervatten, camera, sorteeractie,
CTA-breedtes, 320px/200%/landscape/vertaling/safe areas en bestaande regressies.
Daarna Prisma, TypeScript, lint, i18n, schone productiebuild en GitHub Actions.
Geen fase 3, geen merge zonder nieuwe instructie.
