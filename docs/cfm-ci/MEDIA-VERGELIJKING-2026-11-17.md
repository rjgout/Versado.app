# CFM-mediavergelijking van 17 november 2026 (alleen lezen)

Doel: vaststellen of de 14 vastgepinde CFM-afbeeldingen die de officiële bron nu met andere
bytes levert (`CFM_ASSET_HASH`) inhoudelijk dezelfde afbeeldingen zijn. Er is **geen hash, lock of
bronbestand gewijzigd**; dit document en `MEDIA-VERGELIJKING-2026-11-17.json` zijn alleen resultaten.

Herhalen (alleen-lezen, schrijft uitsluitend onder een eigen `/tmp`-map):

```sh
node scripts/study-content/compare-cfm-media.mjs --out /tmp/cfm-vergelijking \
  --old-archive <pinned-assets.json.gz uit PR #237> [--old-dir <alleen-lezen kopie van NAS-media>]
```

## Methode

- **Oude bytes tellen alleen mee als hun sha256 exact de gepinde hash is.** Zo is bewezen dat het
  de werkelijke oude bytes zijn. Bronnen: het archief uit PR #237 (30 oktober) en, indien de eigenaar
  die aanlevert, een alleen-lezen kopie van de NAS-mediavolume (`--old-dir`). De NAS is niet benaderd.
- Vergeleken worden afmetingen, kanalen, JPEG-structuur (progressief, kwantisatietabellen,
  chroma-subsampling, metadata-segmenten), **gedecodeerde pixels** (zelfde `sharp` 0.35.5 als de importer),
  PSNR, maximale en gemiddelde afwijking en het meest afwijkende 16×16-blok.
- Per afbeelding een verschilbeeld (oud | nieuw | verschil 16× uitvergroot) voor visuele beoordeling.
- Automatische drempels (`THRESHOLDS` in het script) zijn een oordeel van de auteur, geen norm; de
  ruwe maten staan in het JSON-rapport. Het eindoordeel hieronder combineert maten en visuele beoordeling.

## Resultaat per afbeelding

Oude bytes **beschikbaar** (archief, hash = gepinde hash): 7. Niet beschikbaar: 7.

| Bestands-ID | Oude → nieuwe bytes | PSNR | Max Δ | Oordeel |
| --- | --- | --- | --- | --- |
| `0b0f0137adc3` | 18879 → 19101 | 37,4 dB | 80 | inhoudelijk gelijk (herencodering; verschil op randen) |
| `776f6e71e7d8` | 35240 → 35195 | 38,3 dB | 32 | inhoudelijk gelijk (gelijkmatig blokruis) |
| `79cca9b0d880` | 31660 → 31606 | 40,7 dB | 24 | inhoudelijk gelijk |
| `83a6a0f34cc4` | 30665 → 30682 | 41,7 dB | 21 | inhoudelijk gelijk |
| `ab6f54bafbe4` | 25682 → 25747 | 40,2 dB | 26 | inhoudelijk gelijk |
| `ba2eef6c090e` | 30070 → 30087 | 41,2 dB | 20 | inhoudelijk gelijk |
| `f284d2736a75` | 20421 → 20428 | 43,9 dB | 19 | inhoudelijk gelijk |
| `17321b600c83` | 24633 → 24654 | n.v.t. | n.v.t. | **niet vast te stellen** (oude bytes niet beschikbaar) |
| `5dc933a6b340` | 20190 → 20191 | n.v.t. | n.v.t. | **niet vast te stellen** |
| `6b4f476973c1` | 17209 → 17189 | n.v.t. | n.v.t. | **niet vast te stellen** |
| `930d33407d99` | 17694 → 17696 | n.v.t. | n.v.t. | **niet vast te stellen** |
| `d33c6782e013` | 28640 → 28948 | n.v.t. | n.v.t. | **niet vast te stellen** |
| `ebaf72897426` | 28267 → 28254 | n.v.t. | n.v.t. | **niet vast te stellen** |
| `fa1ee428b903` | 23960 → 23959 | n.v.t. | n.v.t. | **niet vast te stellen** |

Bij de zeven vergelijkbare afbeeldingen is **geen enkele pixel-identiek** (max Δ 19–80 op 0–255): het
zijn dus niet alleen andere bytes met dezelfde pixels. De afwijking is wel overal van hetzelfde type:
JPEG-structuur, kwantisatietabellen-aantal, subsampling en metadata zijn gelijk, afmetingen zijn gelijk,
en het verschilbeeld toont gelijkmatig 8×8-blokruis of ringing langs randen, nergens een afwijkend
gebied of andere inhoud. Automatisch kwamen twee als "inhoudelijk gelijk" uit de drempels en vijf als
"niet vast te stellen" (net boven de blokdrempel); na visuele beoordeling van alle zeven verschilbeelden
is het oordeel voor alle zeven **inhoudelijk gelijk, alleen JPEG-herencodering**. Dat is een
beoordeling van de auteur, niet iets wat het script bewijst.

De zeven zonder oude bytes hebben sinds 30 oktober dezelfde huidige hash (het archief bevat de huidige
bytes) en dezelfde afmetingen als de lock, met bytegrootteverschillen (−21…+308) van dezelfde orde als de
zeven aantoonbare gevallen. Dat is consistent met herencodering, maar **geen bewijs**: voor deze zeven is
inhoudsgelijkheid niet vast te stellen zonder de oorspronkelijke bytes (NAS-kopie of een eerdere
CI-cache). De eigenaar heeft deze zeven op 30 oktober visueel beoordeeld (zie `docs/cfm-ci` op branch
`fix/cfm-reproducible-ci`); ook dat is geen pixelbewijs.

## Belangrijkste bevinding: de officiële bron is niet één stabiele waarheid

PR #237 meldt dat een GitHub-run andere bytes ontving dan een lokale controle van dezelfde URL, en dat twee
antwoorden zelfs exact de oude pin hadden. De vier afwijkende bronresponsen in die run en de huidige 14
overlappen: de bron levert dus per verzoek of vanaf verschillende locaties verschillende, gelijkwaardige
JPEG-codes. Een enkele vastgepinde hash per afbeelding is daarom van nature fragiel, zowel in CI als bij een
"Content opnieuw laden" op de NAS.

## Reproduceerbare testassets

Zie het rapport bij deze PR. Kern: gewone tests horen nul externe downloads te doen. PR #237 bevat dat
al (vast archief van 1.641 bestanden, één gedeelde build, aparte broncontrole), maar staat 70 commits achter
op `develop`, bevat de CFM-media als publieke Git-blob (22 MiB) en lost de productie-import niet op.
