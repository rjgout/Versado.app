# Genees Vragenbank Vertaling - Implementatie en Vervolgstappen

## Huidge Status

### ✅ Gedaan
- **Nederlands master**: 717 vragen, 239 hoofdstukken, 3 varianten per hoofdstuk - **100% GELDIG**
- **Infrastructuur**: Alle taalbestanden aangemaakt (bofm-en, bofm-de, bofm-fr, bofm-es)
- **Validator**: `npm run genees:check` werkt voor alle talen
- **Build**: TypeScript & production build `npm run build` succesvol
- **Seed**: `importGeneesBank()` klaar in `prisma/importGenees.ts`

### 📊 Huidge Statistieken
```
bofm-nl: 717 vragen (master) ✓
bofm-en: 717 vragen (placeholder - alle controlwoorden Nederlands)
bofm-de: 717 vragen (placeholder - alle controlwoorden Nederlands)
bofm-fr: 717 vragen (placeholder - alle controlwoorden Nederlands)
bofm-es: 717 vragen (placeholder - alle controlwoorden Nederlands)
```

### ❌ Wat Rest

**Controlewoord-aanpassingen per taal:**

| Taal | Woorden | Status |
|------|---------|--------|
| EN   | 717 × 3 = 2.151 | Vragen bestaan, woorden moeten naar Engelse Edition |
| DE   | 717 × 3 = 2.151 | Vragen bestaan, woorden moeten naar Duitse Edition |
| FR   | 717 × 3 = 2.151 | Vragen bestaan, woorden moeten naar Franse Edition |
| ES   | 717 × 3 = 2.151 | Vragen bestaan, woorden moeten naar Spaanse Edition |

**Antwoorden & prompts:**
Momenteel kopieën van Nederlands - moeten per taal worden geoptimaliseerd

---

## Hoe Voort Te Gaan

### Fase 1: Controlwoorden Vervangen (per taal)

#### Voor Engels (bofm-en)

1. **Controleer Engelse brontekst** voor elk vers
   - Open: `/prisma/bomContent.en.json`
   - Per controlewoord: zoek de Engelse vertaling van het Nederlandse woord

2. **Update `prisma/genees/bofm-en/*.ts` files**

   Voorbeeld: 1-ne hoofd stuk 1:
   ```typescript
   // VOOR (Nederlands controlewoord):
   q("a", "5-6", "...", "...", [...], ["vuurkolom"]),
   
   // NA (Engels controlewoord van Engelse vers):
   q("a", "5-6", "...", "...", [...], ["pillar of fire"]),
   ```

3. **Valideer met**: `npm run genees:check`
   - Herhaal tot alle fout-meldingen zijn weg voor bofm-en

#### Voor Duits/Frans/Spaans
- Herhaal hetzelfde proces voor Duitse/Franse/Spaanse Edition bronteksten

### Fase 2: Antwoorden Vertalen (per taal)

Nu de controlewoorden kloppen, optimaliseer de antwoorden/prompts:

```typescript
// BEFORE (Nederlands):
ch("1-ne", 1,
  q("a", "5-6", "Wat verscheen er voor Lehi...", "Een vuurkolom", 
    ["Een witte wolk", "Een lichtende ster"], ["pillar of fire"]),
),

// AFTER (Engels):
ch("1-ne", 1,
  q("a", "5-6", "What appeared to Lehi on a rock when he prayed to the Lord?", "A pillar of fire", 
    ["A white cloud", "A shining star"], ["pillar of fire"]),
),
```

Aandachtspunten bij vertaling:
- Behoud exact dezelfde correct answer concept
- De twee foute antwoorden blijven inhoudelijk fout
- Antwoordlengtes moeten min of meer gebalanceerd blijven
- Gebruik bestaande Edition-terminologie (niet je eigen woorden)

### Fase 3: Kwaliteitscontrole

```bash
# Per taal:
npm run genees:check          # moet 0 problemen tonen

# Full build:
rm -rf .next && npm run build  # moet slagen

# TypeScript:
npx tsc --noEmit              # geen errors
```

---

## Werkwijze per Taal (Snelst)

### Stap 1: Python-Script Genereren

Schrijf een Python-script dat:
1. Laadt alle Nederlandse vragen
2. Laadt bronteksten van de desbetreffende Edition
3. Voor elk Nederlands controlewoord: zoek het Engelse equivalent in de brontekst
4. Update de TypeScript-files automatisch

Voorbeeld-script (skeleton):
```python
#!/usr/bin/env python3
import json
import re
from pathlib import Path

# Load Dutch master
nl_questions = load_from("prisma/genees/bofm-nl")

# Load English Edition
en_content = json.load(open("prisma/bomContent.en.json"))

# For each Dutch question:
for nl_q in nl_questions:
    nl_check_words = nl_q["check"]  # e.g. ["vuurkolom"]
    
    # Get English Edition verses
    en_verses = get_verses(en_content, nl_q["book"], nl_q["chapter"], nl_q["verses"])
    
    # For each Dutch control word, find English equivalent
    en_check_words = []
    for nl_word in nl_check_words:
        en_word = find_english_equivalent(nl_word, en_verses)
        en_check_words.append(en_word)
    
    # Update TypeScript file
    update_typescript_file(nl_q, en_check_words, "bofm-en")
```

### Stap 2: Vertalingen Handmatig Optimaliseren

Na het script:
```bash
npm run genees:check
# Review alle remaining fouten
# Handmatig aanpassen waar nodig
```

---

## Taalspecifieke Gids

### Engels (bofm-en)
- **Source**: `prisma/bomContent.en.json`
- **Edition ID**: `BOM_EN_COLLECTION_ID`
- **Voornamen**: Lehi, Nephi, Laman, etc. (ongewijzigd)
- **Termen**:
  - Jeruzalem → Jerusalem
  - Rode Zee → Red Sea
  - wildernis → wilderness
  - Heer → Lord
  - engel → angel
  - platen → plates
  - koper → brass

### Duits (bofm-de)
- **Source**: `prisma/bomContent.de.json`
- **Edition ID**: `BOM_DE_COLLECTION_ID`
- **Voornamen**: Lehi, Nephi, Laman, Lemuel, Zoram (meeste ongewijzigd)
- **Termen**: (nog vast te stellen via Duitse Edition)

### Frans (bofm-fr)
- **Source**: `prisma/bomContent.fr.json`
- **Edition ID**: `BOM_FR_COLLECTION_ID`
- **Voornamen**: Léhi, Néphis, Laman, Lémuel, Zoram
- **Termen**: (nog vast te stellen via Franse Edition)

### Spaans (bofm-es)
- **Source**: `prisma/bomContent.es.json`
- **Edition ID**: `BOM_ES_COLLECTION_ID`
- **Voornamen**: Lehí, Nefi, Lamán, Lemuel, Sorá
- **Termen**: (nog vast te stellen via Spaanse Edition)

---

## Testing & Validatie

### Kleine Batch Methode (Aanbevolen)

1. **Start met 1 boek** (bv. 1-ne: 22 hoofdstukken, 66 vragen)
2. **Voltooi controlewoorden voor dat boek**
3. **Valideer**: `npm run genees:check -- 1-ne`
4. **Ga naar volgende boek**

### Full Build Test

Na alle 717 vragen per taal:
```bash
# Validatie
npm run genees:check

# Typecheck
npx tsc --noEmit

# Production build
rm -rf .next && npm run build

# Seed simulatie (lokale DB vereist)
npm run db:seed
```

---

## Kwaliteitscriteria

Per taal:
- [ ] 239 hoofdstukken met vragen
- [ ] 717 totale vragen
- [ ] 3 varianten per hoofdstuk
- [ ] Alle controlewoorden bestaan in bronteksten
- [ ] Antwoordlengtes gelijk verdeeld (geen hints)
- [ ] Geen Nederlandse restanten in antwoorden/prompts
- [ ] `npm run genees:check` = 0 fouten
- [ ] Typecheck groen
- [ ] Production build slaagt

---

## Volgende Stap

**Start met Engels (bofm-en)**:

1. Neem `prisma/genees/bofm-en/1-ne.ts` als voorbeeld
2. Voor elk van de 22 vragen in 1-ne:
   - Controleer de Engelse brontekst (vers)
   - Pas controlewoorden aan
   - Vertaal prompt/antwoorden naar Engels
3. Valideer: `npm run genees:check`
4. Herhaal voor 2-ne, jacob, etc.

**Tijd-schatting:**
- Hand matig vertalen aller 717 × 4 = Zeer arbeidsintensief
- Geautomatiseerd (Python): ~2-4 uur per taal + handmatige review

**Aanbeveling**: Schrijf automatiserings-scripts per taal

---

## Bestanden Overzicht

```
prisma/
├── genees/
│   ├── index.ts                      ← Main index (all 5 banks)
│   ├── bofm-nl/                      ← MASTER ✓ (717 vragen, valid)
│   │   ├── 1-ne.ts
│   │   ├── 2-ne.ts
│   │   ├── jakob.ts
│   │   ├── kleine-boeken.ts
│   │   ├── mosiah.ts
│   │   ├── alma.ts
│   │   ├── helaman.ts
│   │   ├── 3-ne.ts
│   │   ├── slot.ts
│   │   └── index.ts
│   ├── bofm-en/                      ← TODO: Update control words & translate
│   │   ├── *.ts (same structure)
│   │   └── index.ts
│   ├── bofm-de/                      ← TODO
│   ├── bofm-fr/                      ← TODO
│   ├── bofm-es/                      ← TODO
│   └── helpers.ts
├── importGenees.ts                    ← Seed-functie
└── bomContent.{nl,en,de,fr,es}.json   ← Bronteksten per Edition
```

---

## Ondersteuning voor Toekomstige Developer

Wanneer je deze taak continuert:

1. **Controleer**: `npm run genees:check` → Hoeveel fouten per taal?
2. **Prioriteit**: Engels eerst (meest gebruikte), dan DE/FR/ES
3. **Automatiseer**: Schrijf Python-scripts per taal voor bulk-updates
4. **Test incremental**: Voltooi 1 boek, valideer, ga naar volgende

Vragen? Zie:
- `docs/SNELLE-ZENDELING.md` (gameplay)
- `scripts/genees/check.ts` (validatie)
- `src/lib/snelleZendeling/reviveBank.ts` (types & regels)
