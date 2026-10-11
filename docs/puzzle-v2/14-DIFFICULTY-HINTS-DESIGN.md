# Fase 2 — spelregelversie 2, bordplaatsing en tijdelijke hints

Onderzocht vanaf main `79636bd`, werkbranch
`feature/puzzle-v2-difficulty-hints`. Geen multiplayer of nieuwe engine.

## Gevonden toestand

- Alle huidige varianten hebben rulesVersion 1. De policy kent ongelijke
  wereldtoleranties (.42/.32/.24/.20); Expert toont nog een buitencontour.
- Groepen kennen geen verankering. Voltooiing veronderstelt één verbonden
  spanning tree; losse correcte bordplaatsingen bestaan nog niet.
- De API laat geen hintactie toe. De oude service heeft hintregistratie,
  maar kiest soms een buur binnen dezelfde groep en bewaart filtering permanent.
- De contextknoppen zijn minimaal 44px met 18px-iconen.
- Definitions, variants, sessies, actionId en persoonlijke records zijn al
  versieerbaar. De bestaande transacties/locks kunnen behouden blijven.

## Besluit en implementatiecontract

Nieuwe varianten krijgen rulesVersion 2. Eén wereldtolerantie (.36) voor
stukverbindingen op ieder niveau; bordplaatsing is een afzonderlijke `anchor`
actie, uitsluitend bij Ontdekker en Avonturier. Ontdekker heeft voorbeeld en
buitencontour, Avonturier alleen buitencontour; Expert en Meester hebben geen
permanente bordmarkering. Alleen Meester vereist rotatie. Stukaantal is los
van moeilijkheid. Oud rulesVersion 1 houdt oude tolerantie/ondersteuning en
heeft geen bordplaatsing; geometryVersion 1/2 blijven onveranderd leesbaar.

Een groep krijgt optionele `anchored`-metadata in de bestaande JSON-snapshot.
Canonieke positie komt uit de bestaande werktafel plus het canonieke ankerstuk.
De server valideert de bestaande groep, oriëntatie, tolerantie, unieke leden
(en dus bezette canonieke bordcellen), rechten en sessieversie. Verankerde
stukken mogen niet verplaatsen/draaien. Verbinden met een verankerde groep
behoudt dat bordanker, ongeacht de volgorde van de aangeleverde groepsleden.
Aangrenzende verankerde groepen worden deterministisch samengevoegd, met
behoud van bestaande verbindingen en één nieuwe geldige edge per fusie.

Voltooiing vereist volledige unieke stukdekking plus bewezen groepsverbindingen.
Zowel één volledig verbonden rechtstaande groep als volledige server-bevestigde
verankering kan voltooien. Positie, timestamp of een clientclaim alleen zijn
onvoldoende. Vraag, antwoordhistorie en centrale reeks/geen-XP blijven intact.

Hints blijven in snapshot.hints en PuzzleAction geregistreerd met type,
tijdstip, extra-status, actionId, server-target en vervaltijd. Alle vier werken
vijf seconden; filtering dimt alleen de weergave en wijzigt geen posities of
permanente filter. LOCATION geldt voor de hele selectie; CONNECTION kiest
een echte externe buur, bij voorkeur bruikbaar in de buurt. Ongeldige targets
verbruiken geen hint. Retries gebruiken dezelfde actionId; onder dezelfde
sessielock worden budget en registratie berekend. Herladen toont alleen de
nog resterende tijd, nooit opnieuw vijf seconden of een nieuwe afschrijving.

Geen schema-/datamigratie nodig: bestaande JSON-contracten worden additief
uitgebreid; variantregels en records zijn al door rulesVersion gescheiden.
Geen historische sessies, antwoorden, hints of records herschrijven. Een start
hervat een bestaande open poging voor dezelfde content/aantal/moeilijkheid,
ook als die oud is; na afronding krijgt replay een nieuwe rulesVersion-2-variant.
Toekomstige vergelijking moet definition/geometryVersion/rulesVersion en
extraHintsUsed meenemen; ranglijsten/multiplayer worden nu niet gebouwd.

De fullscreen-shell blijft bestaan. Menu en rotatie krijgen minimaal 60×60
CSS-pixels en iconen van 26px. Een compact hintpaneel opent vanuit ⋯, met
budget/extra-uitleg en selectieafhankelijke opties. Geen bak, permanente hintbalk
of nieuwe header. Uitleg en alle vijf talen volgen het nieuwe contract.
