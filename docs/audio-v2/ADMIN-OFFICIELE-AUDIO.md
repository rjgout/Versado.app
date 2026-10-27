# Officiële audio vanuit de adminbackend

Open **Adminbackend → Content → Audio**. Beheer Boek van Mormon, Leer en Verbonden en Parel van Grote Waarde per taal via de bestaande Audio V2-keten. De aparte Ether 1-pilotkaart en goedkeuringspoort zijn vervallen; Ether 1 blijft een gewoon hoofdstuk.

Zie [Nederlandse voortgang en taakherstel](NL-VOORTGANG.md) voor de actuele telling, lege/verlaten leases en de verwijderde pilotvoorwaarden. [Bulkherstel](BULK-HERSTEL.md) beschrijft de eerdere correctie uit #221.

## Bediening

1. Kies de gewenste bron en taal. De Nederlandse 34 aanvullingen worden apart geteld van de 205 bestaande legacy-bronkoppelingen; aanwezige legacy-bestanden hebben hun eigen teller.
2. **Downloaden** bevestigen voor de resterende kandidaten. De server controleert de officiële identiteit, tekstuitgave, bytes/hash, MP3-integriteit en tijdcodes. Het maakt nog geen registratie of publicatie. Grotere selecties worden in batches van twintig voorbereid; ontvangen taken blijven duurzaam bewaard.
3. **Registreren** apart bevestigen voor gecontroleerde kandidaten. De bestaande Audio V2-importer verwerkt het bevroren pakket; deze actie publiceert niets.
4. Open **Selecteer geregistreerde opnamen om te publiceren**, beluister de preview en selecteer de gewenste hoofdstukken. De lijst toont 25 rijen per pagina. Een aparte bevestiging noemt hoofdstukken, talen en stemmen. Bestaande publicaties worden door de bulkactie niet vervangen.
5. Bij een deelfout blijven geslaagde commits behouden. Ververs en beoordeel alleen de resterende kandidaten. Verlopen of mislukte taken kunnen via **Veilig hervatten** opnieuw worden aangeboden; levende workers en toekomstige backoff blijven beschermd. Per hoofdstuk zijn waar nodig aparte herstel- en registratieknoppen beschikbaar.

Een teller `34 geregistreerd` hoeft bij de Nederlandse aanvulling geen fout te zijn. Als alle 34 geregistreerd zijn, is downloaden klaar. Er kunnen nog aanvullende publicaties nodig zijn. De samenvatting maakt die volgende stap duidelijk; er wordt nooit een fictieve hervattaak aangemaakt.

## Beveiliging, opslag en compatibiliteit

- GET/status en alleen openen/verversen schrijven niets. Geen seed, migratie, tekstupdate of mirroropdracht vanuit deze bediening.
- Huidige beheerrechten en sessionVersion, origincontrole, strikte begrensde invoer, officiële HTTPS-/DNS-allowlist, hashes, MP3-decode, bronuitgave en versgrenzen blijven verplicht.
- De 205 beschermde legacy-doelen, zes verborgen tekstuitgaven en 19 reviewidentiteiten blijven intact. Geen cursussen/oefeningen, XP, reeksen, voortgang of bestaande teksten worden aangemaakt of aangepast.
- Eén bestaande OfficialAudioTask/worker/importer-keten. Geen SSH of Docker-socket in de webapp en geen nieuwe jobengine. Alle appcontainers moeten dezelfde blijvende audiomount delen; een directory of vrije-ruimtemeting bewijst die mount niet.
- Cache/objectbestanden worden niet overschreven. Een afgebroken netwerkdownload kan veilig opnieuw beginnen; geen belofte van byte-exact hervatten. Beschadigde bestaande bestanden worden geblokkeerd en vragen beoordeling.
- Bulkvoorbereiding heeft korte commits per kandidaat, PostgreSQL-lock-/statementtimeouts en duurzame resultaten. Lockvolgorde: User → audiobeleid → taak → canonieke bronclaim → receipt/hoofdstuk. Importer en publicatie controleren ook op hun eigen commitgrens.
- Historische pilotkolommen blijven als auditdata bestaan, zonder operationele poort. Geen nieuwe migratie of hernoeming van oude migraties. Oude schrijvende appversies niet naast de nieuwe keten laten draaien bij een later, afzonderlijk goedgekeurd uitrolmoment.
- Statusverversing: 15 seconden bij actieve taken, anders 120 seconden; de gedeelde datalaag pauzeert polling in verborgen tabs. Bestandscontroles zijn begrensd en lezen geen MP3-inhoud. Een verversfout laat de laatst bekende voortgang zien, met acties uitgeschakeld.

## Acceptatie

Publicatie blijft een afzonderlijke beheerbeslissing. Technische ontwikkeltests zijn geen NAS- of fysieke apparaattest. De eigenaar verzorgt deployment en live acceptatie na afzonderlijk akkoord. Geen productiehandelingen door Codex; huidige testresultaten, screenshots en CI-status staan in de bijbehorende draft-PR.
