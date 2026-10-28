// Versado Kompas: alle teksten van uitleg, rondleidingen en uitnodigingen.
// Nederlands is de bron. Structuur en regels: docs/KOMPAS.md.
//
// - topics.<id>: uitleg per onderdeel (id met punt of streepje wordt camelCase,
//   "play.word-search" wordt playWordSearch). Secties: what, benefit, step1..6,
//   more, faq1..5 (q + a). Spelonderdelen vallen terug op gamesHub.
// - work.<werk>: uitleg voor één schriftbron (ContentCollection.work, camelCase):
//   intro, contents en topics.<id> met dezelfde secties. Wat ontbreekt komt uit topics.
// - tours.<rondleiding>.<stap>: title en text per stap.
export const kompasNl = {
  title: "Ontdek Versado",
  entry: {
    new: "Nieuw",
    title: "Ontdek Versado",
    text: "Korte uitleg over Leren, Spelen en meer. Open het wanneer je wilt.",
  },
  hub: {
    offersTitle: "Zal Versado soms uitleg aanbieden?",
    offersText: "Bij een onderdeel dat je voor het eerst opent, kan Versado hoogstens één keer per bezoek vragen of je uitleg wilt. Je kunt dit altijd aan- of uitzetten in je profiel.",
    offersYes: "Ja, af en toe",
    offersNo: "Nee, bedankt",
    offersOn: "Prima. Je krijgt af en toe een uitnodiging.",
    intro: "Hier leer je hoe Versado werkt. Kies een onderdeel, lees een korte uitleg en probeer het meteen zelf.",
    mainTitle: "Waar wil je meer over weten?",
    supportTitle: "Meer over Versado",
    sourceNow: "Je bekijkt nu: {name}",
    sourceHint: "Wat je bij Leren en Spelen ziet, hangt af van de Schriften die je gekozen hebt.",
    sourceSwitch: "Hoe kies ik andere Schriften of een andere taal?",
    sourceGeneric: "Deze Schriften hebben hun eigen cursussen. Bij Leren zie je wat er voor deze keuze is.",
    tourTitle: "Liever laten wijzen?",
    tourText: "Een korte rondleiding wijst de belangrijkste plekken aan. Je kunt altijd stoppen.",
    tourStart: "Rondleiding starten",
  },
  topic: {
    what: "Wat is het?",
    benefit: "Wat kun je ermee?",
    steps: "Hoe werkt het?",
    try: "Probeer het zelf",
    more: "Meer weten",
    open: "Open {name}",
    tourStart: "Rondleiding starten",
    tourAgain: "Rondleiding opnieuw bekijken",
    related: "Hierbij hoort",
    games: "Spellen die nu bij jou passen",
    viewed: "Bekeken",
    forSource: "Uitleg voor {name}",
    backToHub: "Alle uitleg",
    moreInKompas: "Meer uitleg in Ontdek Versado",
    updated: "Bijgewerkt",
  },
  offer: {
    question: "Wil je zien hoe dit werkt?",
    about: "Korte uitleg over {topic}",
    from: "{name} wijst je de weg.",
    show: "Ja, laat zien",
    dismiss: "Nu niet",
    stop: "Niet meer vragen",
    region: "Uitleg aanbod",
    stopped: "Je krijgt geen uitnodigingen meer. Je kunt dit aanzetten in je profiel.",
  },
  tour: {
    region: "Rondleiding",
    step: "Stap {n} van {total}",
    next: "Volgende",
    back: "Vorige",
    done: "Klaar",
    skip: "Overslaan",
    close: "Rondleiding sluiten",
    hint: "Deze rondleiding verandert niets aan je gegevens.",
  },
  onboarding: {
    title: "Dit is Versado",
    intro: "Versado helpt je de Schriften te leren kennen, in je eigen tempo.",
    learnTitle: "Leren",
    learnText: "Lees in kleine stukken en beantwoord vragen.",
    playTitle: "Spelen",
    playText: "Spelletjes en puzzels, alleen of samen.",
    switcherTitle: "Schriften kiezen",
    switcherText: "Bovenaan kies je met welke Schriften je werkt en in welke taal je de tekst leest.",
    helpTitle: "Uitleg nodig?",
    helpText: "Open Ontdek Versado op Vandaag of in je profiel. Alles staat er in korte stappen.",
    tryTitle: "Liever meteen iets proberen?",
    tryLearn: "Begin met Leren",
    tryPlay: "Probeer een spel",
    tryLater: "De rest van de kennismaking, zoals vrienden en meldingen, vind je later terug in je profiel.",
  },
  settings: {
    offersTitle: "Uitleg aanbieden",
    offersHint: "Versado kan hoogstens één keer per bezoek vragen of je uitleg wilt bij een onderdeel dat je voor het eerst opent. Je kunt alle uitleg altijd zelf openen via Ontdek Versado.",
  },
  topics: {
    versado: {
      title: "Versado",
      what: "Versado helpt je de Schriften te leren kennen: door te lezen, vragen te beantwoorden en te spelen. Je doet dat in je eigen tempo.",
      benefit: "Je bouwt stap voor stap kennis op. XP en een dagelijkse reeks houden het leuk, en met vrienden leer en speel je samen.",
      step1: "Leren: kies een cursus, lees en beantwoord vragen.",
      step2: "Spelen: kies een spel en speel alleen of met anderen.",
      step3: "Samen: voeg vrienden toe en houd samen vol.",
      step4: "Jouw voortgang: XP, reeks en divisie laten zien hoe het gaat.",
      more: "Alle uitleg kun je altijd opnieuw lezen. Je vindt hem via Ontdek Versado op Vandaag en in je profiel.",
    },
    learn: {
      title: "Leren",
      what: "Leren is waar je cursussen volgt. Je werkt in kleine stukken en beantwoordt daarna vragen over wat je las of hoorde.",
      benefit: "Je onthoudt meer van wat je leest. Voor goede antwoorden verdien je XP.",
      step1: "Open Leren en kies een cursus.",
      step2: "Lees het volgende stuk.",
      step3: "Beantwoord de vragen. Je voortgang blijft bewaard, dus je kunt altijd verdergaan.",
      more: "Lezen alleen levert geen XP op. Een hoofdstuk of leesstap dat je uitdrukkelijk afrondt telt wel als activiteit voor je reeks, net als een afgeronde oefening. Tik op een vers of een alinea voor een bladwijzer, markering of privénotitie. Je kunt ook tekst binnen één sectie selecteren. Je vindt alles terug in Mijn studiemap, onderaan de contentkiezer. Annotaties leveren geen XP of reeksactiviteit op. Bij studieprogramma’s kies je bewust een actieve les. Die blijft gekozen bij een nieuwe kalenderweek of een andere contentbron. Een les kiezen geeft geen XP of leesafronding. Kom dan en volg Mij voeg je toe via Cursus toevoegen, als Stap voor stap (precies zes stappen per week, maandag t/m zaterdag, met de zondag vrij) of als Vrije studie (de persoonlijke studie van de week als één doorlopende tekst). Alle weken en stappen staan open. Alleen de leesstap afvinken telt niet als het lezen van de hele les en levert geen XP of reeksactiviteit op. Eerdere lessen van Kom dan en volg Mij verhuizen één kalendermaand na hun lesweek naar het archief; daar vind je ze per jaargang terug, met je aantekeningen en voortgang. Bij CFM verschijnen vragen alleen bij voldoende gecontroleerde schrifttekst: drie per leesstap en dezelfde achttien bij de hele week zodra alle zes stappen gedekt zijn. Een volledig ingeleverde vragenset volgt de bestaande XP- en reeksregels. Wisselen van leeswijze geeft geen nieuwe basisbeloning.",
      faq1: {
        q: "Maakt het uit welke cursus ik kies?",
        a: "Elke cursus biedt dezelfde inhoud op een andere manier aan, bijvoorbeeld in korte stappen of per hoofdstuk. Voor dezelfde inhoud kun je er niet meer XP mee verdienen dan met een andere cursus.",
      },
      faq2: {
        q: "Wat als ik een hoofdstuk opnieuw oefen?",
        a: "Dat mag altijd. Een hoofdstuk levert zijn XP één keer op, in welke cursus of taal je het ook oefent. Opnieuw oefenen geeft minder XP.",
      },
      faq3: {
        q: "Kan ik een cursus verbergen?",
        a: "Ja. Je voortgang blijft dan bewaard, en je kunt de cursus later weer toevoegen.",
      },
    },
    play: {
      title: "Spelen",
      what: "Spelen is waar je spelletjes en puzzels doet rond de Schriften, alleen of samen met anderen. Denk aan woordspellen, quizzen en het Mysterie.",
      benefit: "Spelen is een ontspannen manier om de Schriften te ontdekken. Welke spellen je ziet, hangt af van de Schriften die je gekozen hebt.",
      step1: "Open Spelen en kies een spel.",
      step2: "Het informatie-icoon bij een spel toont de spelregels.",
      step3: "Speel alleen, of nodig een vriend uit als het spel dat toestaat.",
      more: "Niet elk spel levert XP of reeks op. Bij elk spel staat in de spelregels wat het oplevert.",
      faq1: {
        q: "Kan ik de volgorde van de spellen aanpassen?",
        a: "Ja. Je kunt spellen verslepen en verbergen. Verbergen verwijdert niets, en je zet ze later weer terug.",
      },
      faq2: {
        q: "Waarom zie ik minder spellen dan een ander?",
        a: "Spellen horen bij bepaalde Schriften. Kies je andere Schriften, dan verandert het aanbod.",
      },
    },
    playMystery: {
      benefit: "Je ontdekt de verhalen stap voor stap, met puzzels die je zelf oplost.",
    },
    together: {
      title: "Samen",
      what: "Samen gaat over vrienden en groepen. Je ziet hoe het met je vrienden gaat en je kunt samen volhouden.",
      benefit: "Samen is het makkelijker om elke dag door te gaan. Je kunt elkaar een seintje geven (een zetje, geen chatbericht) en samen een reeks opbouwen.",
      step1: "Open Vrienden en zoek iemand op met zijn of haar naam, bijvoorbeeld Jan#83.",
      step2: "Start een vriendenreeks met een vriend, of maak een groep.",
      step3: "Iedereen draagt bij door op de eigen dag te oefenen. Bijdragen en seintjes leveren geen XP op.",
      more: "Je kiest zelf of vrienden kunnen zien dat je online bent. Dat stel je in bij je profiel, onder Online-activiteit.",
    },
    togetherFriends: {
      title: "Vrienden",
      what: "Hier voeg je vrienden toe en zie je wie er meedoet.",
      benefit: "Met vrienden kun je samen spelen, elkaar een seintje geven en een vriendenreeks starten.",
      step1: "Zoek een vriend op met zijn of haar naam, bijvoorbeeld Jan#83.",
      step2: "Of deel je persoonlijke uitnodigingslink.",
      step3: "Zodra je vriend het accepteert, zijn jullie vrienden.",
    },
    togetherGroups: {
      title: "Groepen",
      what: "Een groep is een kring waarin jullie samen een reeks opbouwen.",
      benefit: "In een groep telt wat jullie samen doen. Niet iedereen hoeft elke dag mee te doen.",
      step1: "Maak een groep en geef hem een naam.",
      step2: "Nodig vrienden uit, of deel de groepslink.",
      step3: "Iedereen draagt bij door op de eigen dag te oefenen.",
      more: "Een groepslink geeft niet meteen toegang: een beheerder van de groep keurt een verzoek goed. Alleen leden zien wie er in de groep zitten.",
    },
    progress: {
      title: "Mijn voortgang",
      what: "Hier zie je hoe het met je gaat: je XP, je reeks en je divisie.",
      benefit: "Je ziet wat je al bereikt hebt, en het helpt je om elke dag een beetje te blijven doen.",
      step1: "Bovenaan staan je reeks, je XP en je divisie.",
      step2: "Tik erop voor meer uitleg en je geschiedenis.",
      step3: "In je profiel vind je ook je prestaties en je leesvoortgang.",
      more: "Alleen wat je echt doet in Versado telt mee. Uitleg lezen of een rondleiding volgen verandert niets aan je XP, reeks of resultaten.",
    },
    progressXp: {
      title: "XP",
      what: "XP zijn punten die je verdient met oefeningen en sommige spellen.",
      benefit: "Met XP klim je in de wekelijkse competitie. Je kunt XP ook uitgeven, bijvoorbeeld aan een hint.",
      step1: "Maak een oefening of speel een spel dat XP oplevert.",
      step2: "Tik bovenaan op je XP om je geschiedenis te zien.",
      more: "Lezen levert geen XP op. Een hoofdstuk levert zijn XP één keer op, in welke cursus of taal je het ook oefent.",
    },
    progressStreak: {
      title: "Reeks",
      what: "Je reeks telt hoeveel dagen op rij je minstens één echte activiteit in Versado hebt afgerond.",
      benefit: "Een reeks helpt je om elke dag een beetje te doen, ook als dat maar kort is.",
      step1: "Rond elke dag minstens één activiteit af, zoals een les, een oefenronde, een spel of een afgeronde leesstap. Hoe kort of lang die is, maakt niet uit.",
      step2: "Mis je een dag, dan gebruikt Versado automatisch een reeksbevriezing als je er een hebt. Die bewaart je reeks.",
      step3: "Heb je geen reeksbevriezing meer, dan is je reeks onderbroken, maar niet verloren. Je kunt je reeks voortzetten.",
      more: "De eerste afgeronde activiteit van de dag zet je reeks voort; een tweede activiteit diezelfde dag geeft geen extra reeksdag. XP en reeks zijn los van elkaar: ook een activiteit zonder XP kan meetellen. Alleen openen, bladeren of beginnen telt niet, het moet echt afgerond zijn. Een dag loopt volgens de tijdzone van je account. Tijdens het spelen zie je een nieuwe reeksverlenging direct in een banner bovenaan. Veeg die omhoog of sluit hem; je spel loopt door. De fullscreen viering volgt later, na je activiteit. In de persoonlijke fullscreen viering kun je je aantal reeksdagen delen of kopiëren.",
    },
    progressDivisions: {
      title: "Divisie",
      what: "Je divisie is je plek in de wekelijkse competitie.",
      benefit: "Je speelt tegen een groep andere spelers. Wie meer XP verdient, klimt.",
      step1: "Verdien deze week XP.",
      step2: "Kijk bij Competitie waar je staat en hoeveel tijd er nog is.",
      step3: "Aan het einde van de week promoveren de bovenste spelers en degraderen de onderste.",
    },
    profile: {
      title: "Mijn profiel en instellingen",
      what: "Je profiel is jouw persoonlijke plek. Hier kies je je avatar en staan je instellingen.",
      benefit: "Je kiest hier je personageavatar, gids, taal en meldingen. Bij Privacy bepaal je of vrienden je reeks, XP, divisie en uitgelichte prestaties mogen bekijken.",
      step1: "Tik rechtsboven op je avatar.",
      step2: "Kies Avatar wijzigen om een ander personage of je vrijgespeelde accessoires te kiezen.",
      step3: "Open Privacy om te bepalen of vrienden je prestaties mogen zien.",
      more: "De taal van de app en de taal van de tekst van de Schriften zijn twee aparte keuzes. Je kiest ze allebei in je profiel; de taal van de tekst ook bovenaan bij de Schriften. Via Mijn dorp open je je dorp wanneer dit beschikbaar is. Bij Privacy kies je of vrienden het mogen bezoeken. Bij Meldingen kies je voor de tekst van de dag een bron voor push en e-mail. Standaard is dat de actuele weekles van Kom dan en volg Mij. Op Vandaag volgt de tekst je actieve content, met diezelfde weekles als terugval.",
    },
    start: {
      title: "Aan de slag",
      what: "Hier leer je Versado in een paar stappen kennen.",
      benefit: "Je ziet waar alles zit en je kunt meteen iets proberen.",
      step1: "Bekijk de korte rondleiding.",
      step2: "Begin met Leren en doe een oefening.",
      step3: "Probeer daarna een spel bij Spelen.",
      step4: "Kom je er niet uit? Open Ontdek Versado.",
      more: "Je kunt deze vrijwillige productuitleg en de rondleiding altijd opnieuw openen via Ontdek Versado. Je instellingen veranderen daardoor niet.",
    },
    switcher: {
      "title": "Content en taal kiezen",
      "what": "Tik linksboven op je huidige bron om de volledige contentkiezer te openen.",
      "benefit": "Kies uit Schriften en Studieprogramma’s, of open Lofzangen onder Zang & muziek. Podcasts blijven bij Studieprogramma’s. Lofzangen openen verandert je bronkeuze niet; op zondag vind je ze ook bij Vandaag.",
      "step1": "Open de kiezer via de bron in de header.",
      "step2": "Tik op een beschikbare bron om direct te wisselen.",
      "step3": "Kies een beschikbare teksttaal of expliciet een andere uitgave.",
      "step4": "Versado opent een passende bestemming; terug zonder keuze verandert niets.",
      "more": "Onderaan de contentkiezer, boven de taalkeuze, staat Mijn studiemap. Daar vind je al je bladwijzers, markeringen en privénotities uit alle bronnen bij elkaar, ook als je nu een andere bron of taal hebt gekozen. Zoek op tekst, filter op soort, markeringskleur of bron en tik op Open passage om terug te gaan naar het bewaarde vers of de studiepassage. Notities zijn privé. Is een les bijgewerkt of een bron niet meer beschikbaar, dan zet Versado je notitie niet automatisch om naar een andere passage; je oorspronkelijke tekst blijft bewaard. Annotaties leveren geen XP of reeksactiviteit op.",
      "faq1": {
        "q": "Wat verandert er als ik wissel?",
        "a": "Je gekozen bron bepaalt de beschikbare teksten, cursussen en spellen."
      },
      "faq2": {
        "q": "Wat blijft hetzelfde?",
        "a": "Je lees- en cursusvoortgang, actieve studielessen, podcasts, XP, hints en reeks blijven bewaard. Wisselen is geen leeractiviteit."
      },
      "faq3": {
        "q": "Hoe kies ik een andere taal?",
        "a": "Gebruik de taalkeuze op de contentpagina. Alleen beschikbare edities worden gebruikt. De interfacetaal blijft een aparte profielinstelling."
      },
      "faq4": {
        "q": "Wat als iets niet beschikbaar is?",
        "a": "Een verborgen bron of ontbrekende taal kun je niet normaal kiezen. Als een geldige bron nog geen passende bestemming heeft, krijg je uitleg; er wordt geen lege cursus gestart."
      }
    },
  },
  work: {
    bofm: {
      intro: "Het Boek van Mormon is een van de Schriften op Versado.",
      contents: "Je kunt het hoofdstuk voor hoofdstuk lezen, of in korte stappen. Waar audio beschikbaar is, kun je hoofdstukken laten voorlezen.",
      topics: {
        learn: {
          what: "Leren is waar je cursussen volgt. Je leest het Boek van Mormon in kleine stukken, per hoofdstuk, en beantwoordt daarna vragen over wat je las.",
        },
      },
    },
    dcTestament: {
      intro: "De Leer en Verbonden bevat openbaringen, verdeeld in afdelingen.",
      contents: "Je leest afdeling voor afdeling, of in korte stappen.",
      topics: {
        learn: {
          what: "Leren is waar je cursussen volgt. Je leest de Leer en Verbonden in kleine stukken, per afdeling, en beantwoordt daarna vragen over wat je las.",
        },
      },
    },
    pgp: {
      intro: "De Parel van Grote Waarde is een verzameling geschriften, verdeeld in boeken en hoofdstukken.",
      contents: "Je leest hoofdstuk voor hoofdstuk, of in korte stappen.",
      topics: {
        learn: {
          what: "Leren is waar je cursussen volgt. Je leest de Parel van Grote Waarde in kleine stukken, per hoofdstuk, en beantwoordt daarna vragen over wat je las.",
        },
      },
    },
  },
  tours: {
    start: {
      entry: { title: "Ontdek Versado", text: "Hier vind je altijd uitleg over Versado. Je kunt hier op elk moment terugkomen." },
      switcher: {"title": "Open de contentkiezer", "text": "Tik hier om Schriften of Studieprogramma’s te kiezen, Lofzangen te openen onder Zang & muziek of je teksttaal te veranderen. Je voortgang blijft bewaard."},
      learn: { title: "Leren", text: "Hier volg je cursussen: lezen en vragen beantwoorden." },
      play: { title: "Spelen", text: "Hier vind je spellen en puzzels, alleen of met anderen." },
      friends: { title: "Vrienden", text: "Hier voeg je vrienden toe en zie je hoe jullie samen bezig zijn." },
      profile: { title: "Jouw profiel", text: "Hier vind je je avatar, instellingen en gids." },
    },
    learn: {
      intro: { title: "Je cursussen", text: "Dit zijn je cursussen. Open er een om te lezen en vragen te beantwoorden. Je voortgang blijft bewaard." },
      add: { title: "Meer cursussen", text: "Hier voeg je een cursus toe. Verborgen cursussen kun je hier ook weer terugzetten." },
      switcher: {"title": "Open de contentkiezer", "text": "Tik hier om Schriften of Studieprogramma’s te kiezen, Lofzangen te openen onder Zang & muziek of je teksttaal te veranderen. Je voortgang blijft bewaard."},
    },
    play: {
      games: { title: "Je spellen", text: "Kies een spel om het te openen. Het informatie-icoon toont de spelregels." },
      switcher: {"title": "Open de contentkiezer", "text": "Tik hier om Schriften of Studieprogramma’s te kiezen, Lofzangen te openen onder Zang & muziek of je teksttaal te veranderen. Je voortgang blijft bewaard."},
    },
    switcher: {
      menu: {"title": "Open de contentkiezer", "text": "Tik hier om Schriften of Studieprogramma’s te kiezen, Lofzangen te openen onder Zang & muziek of je teksttaal te veranderen. Je voortgang blijft bewaard."},
      learn: { title: "Leren volgt je keuze", text: "Je cursussen horen bij de gekozen Schriften." },
      play: { title: "Spelen ook", text: "Ook de spellen hangen af van je keuze." },
    },
  },
};
