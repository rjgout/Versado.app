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

De bestaande `User.avatarEmoji` blijft behouden voor oude gegevens en API-
compatibiliteit, maar wordt niet meer als gebruikersavatar gerenderd. Accounts
zonder personage krijgen tijdelijk een centrale letterfallback uit de naam;
een ontbrekende asset levert dus geen lege cirkel op. Nieuwe velden op `User`
zijn nullable:

- `avatarCharacterId`
- `avatarBackgroundId`
- `avatarFrameId`
- `avatarDecorationId`
- `avatarLightAccentId`

De route `/api/account` normaliseert aliases, controleert de canonieke
personage-ID, de avatargeschiktheid en de verdiende prestatie voordat een keuze
wordt opgeslagen. Een wijziging actualiseert de centrale avatarcache en
wordt via de bestaande live-data-mutatie aangekondigd. De batchroute voor
compacte avatars blijft sessiebeveiligd.

De fullscreen editor staat op `/profile/avatar` en bevat alleen de tabs
Personages en Accessoires. De keuze blijft lokaal in
de live preview totdat de gebruiker Opslaan kiest; daarna gebruikt de editor
dezelfde `/api/account`-validatie. `setAvatarAppearance()` zet een geslaagde
keuze direct in de gedeelde clientcache, zodat de header en reeds gemonteerde
gebruikerslijsten niet op een nieuwe login hoeven te wachten. Bij een emoji als
basis blijft het oude databaseveld behouden, maar nieuwe keuzes gaan altijd
naar een canoniek personage. Bestaande accessoires blijven onafhankelijke
lagen en worden niet door die compatibiliteit gewist.

Nieuwe accounts kiezen tijdens onboarding uit de vaste selectie
`sariah`, `abish`, `nephi` en `ammon-missionary`. Dezelfde centrale lijst wordt
gebruikt voor de gerichte keuze van bestaande accounts zonder personage.
Profielprivacy gebruikt de bestaande `User.shareAchievements`-instelling; de
onboardingdatum `onboardingProfilePrivacyAt` is alleen hervatstatus en geen
tweede privacybeleid. De server levert gedeelde prestaties uitsluitend via de
bestaande vriendenprofielcontrole.
De vrijwillige profieluitleg staat in Ontdek Versado en wijzigt deze keuzes
niet.

Compacte gebruikersavatars gebruiken alle vierkante lagen samen: achtergrond,
personage, decoratie/lichtaccent en kader. De transparante marges van de
accessoirebestanden worden in `ScriptureAvatar` gecompenseerd met een kleine
visuele schaal, zodat achtergrond en kader de buitenrand van het ronde vak
daadwerkelijk bereiken zonder de bronassets te wijzigen. Een profielhero
gebruikt daarentegen het onafhankelijke full-body-raster; het ronde kader wordt
daar nooit als halo rond het hoofd geplaatst. Een toekomstige profielscène kan
als afzonderlijke rechthoekige achtergrondlaag in `ProfileCharacterHero` worden
aangesloten, zonder de huidige vierkante avatarachtergrond of databasevelden te
hergebruiken.

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
gebruikers met alleen legacy emoji-data krijgen geen automatische opgeslagen
personagekeuze: na inloggen krijgen zij één gerichte keuze uit de vier
startpersonages. Tot die keuze blijft de neutrale letterfallback zichtbaar.
