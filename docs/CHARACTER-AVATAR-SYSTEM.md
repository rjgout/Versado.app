# Personages, avatars en accessoires

De runtimebibliotheek voor schriftpersonages staat in
`src/lib/characterAssets.ts`. De uitgebreide JSON-bestanden onder
`docs/scripture/` blijven de documentatie- en assetbron; de TypeScript-catalogus
bevat alleen de gegevens die de client, renderers en servervalidatie nodig
hebben. Canonieke ID's zijn de enige sleutels. `brother-jared` wordt uitsluitend
als legacy-alias genormaliseerd naar `brother-of-jared`.

## Afbeeldingen

Runtime-URL's beginnen met `/scripture/`. `ScriptureAvatar` bouwt een avatar
uit onafhankelijke lagen: achtergrond, personage, lichtaccent, decoratie en
kader. De vierkante accessoire-assets worden alleen in vierkante avatarbadges
gebruikt; ze worden niet uitgerekt over de rechthoekige profielheader.

`ProfileCharacterHero` gebruikt voor de profielweergave één full-body-raster.
Tik of klik verandert alleen de camera-transform naar het hoofdanker uit
`src/lib/profileCharacterFraming.ts`. Daardoor blijft de header even hoog en
verspringt de afbeelding niet door een wissel naar een andere buste-afbeelding.
`prefers-reduced-motion` schakelt de overgang uit. Een toekomstige animatielaag
kan tussen `getCharacterAsset()` en de presentatiecomponent worden geplaatst;
de huidige renderer blijft bewust statisch.

## Persoonsmapping

`src/lib/personCharacterMapping.ts` bevat een expliciete mapping per collectie.
De mapping importeert geen databasecode, omdat de personenzoeker een
clientcomponent is. Voor Alma wordt alleen `alma-de-jongere` gekoppeld aan
`alma-younger`; het ambigue record `alma` blijft zonder afbeelding totdat de
bronidentiteit betrouwbaar is vastgesteld. Andere collecties vallen bewust
terug op tekst.

## Gebruikersavatar

De bestaande `User.avatarEmoji` blijft behouden als fallback. Nieuwe velden op
`User` zijn nullable:

- `avatarCharacterId`
- `avatarBackgroundId`
- `avatarFrameId`
- `avatarDecorationId`
- `avatarLightAccentId`

De route `/api/account` normaliseert aliases, controleert de canonieke
personage-ID, de avatargeschiktheid en de verdiende prestatie voordat een keuze
wordt opgeslagen. Een wijziging maakt de centrale avatarcache ongeldig en
wordt via de bestaande live-data-mutatie aangekondigd. De batchroute voor
compacte avatars blijft sessiebeveiligd.

## Ontgrendelingen

Er is geen nieuwe valuta of tijdelijke teller. Bestaande `UserAchievement`-
records fungeren als duurzame unlockregistratie. Bij het openen van het profiel
of opslaan van een avatar worden de bestaande achievement-definities gericht
opnieuw gecontroleerd, zodat historische voortgang niet wordt gemist. De acht
A-personages zijn
direct beschikbaar. De vier B-personages vragen `first-chapter`; C-personages
vragen `chapters-5`. De bestaande betekenis van die prestaties blijft
ongewijzigd: hoofdstukprestaties tellen afgeronde oefeningen, niet gelezen
hoofdstukken.

Accessoires gebruiken dezelfde permanente prestaties:

- bronzen, zilveren en gouden kader: `first-chapter`, `chapters-10`,
  `perfect-10`;
- sterrenachtergrond: `streak-7`;
- kompasdecoratie: `intro-all-lessons`;
- lichtaccent: `chapters-25`;
- schriftrol: `chapters-5`;
- mysterie-embleem: voorlopig vergrendeld, omdat er geen betrouwbare bestaande
  Mysterie-voltooiingsprestatie is.

## Mysterie

In het palet gebruikt Mysterie de compacte buste uit de centrale bibliotheek.
Sleep-preview en speelveld blijven de bestaande negen gekalibreerde
full-body-assets, voetankers, offsets en plaatsingslogica gebruiken. Nieuwe
full-body-assets worden dus niet automatisch aan een bestaand Mysterie
toegevoegd.

## Compatibiliteit

De mascottekeuze (`User.companion`) staat los van de schriftavatar. Bestaande
gebruikers krijgen geen automatische personagekeuze; zolang zij niets kiezen,
blijven emoji of initialen zichtbaar.
