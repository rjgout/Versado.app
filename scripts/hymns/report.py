#!/usr/bin/env python3
"""Schrijft het Nederlandse kwaliteitsrapport van de bibliotheek (docs/hymns/15-KWALITEITSRAPPORT.md) uit het manifest.
Alle getallen komen uit src/lib/hymns/library/data/manifest.json; er wordt niets met de hand ingevuld."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "src/lib/hymns/library/data"
m = json.loads((DATA / "manifest.json").read_text())
c = m["counts"]
H = m["hymns"]


def nums(pred):
    return [h["number"] for h in H if pred(h)]


def fmt(ns):
    return ", ".join(map(str, ns)) if ns else "geen"


total = c["official"]
no_music = nums(lambda h: not h["capabilities"]["scoreValidated"] and h["textStatus"] == "volledig")
lines = []
a = lines.append
a("# Lofzangen: kwaliteitsrapport Nederlandse bibliotheek")
a("")
a(f"_Gegenereerd door `scripts/hymns/report.py` uit `manifest.json` (dataversie `{m['dataVersion']}`). Niet met de hand bewerken._")
a("")
a("## 1. Aantallen per niveau")
a("")
a("| Niveau | Aantal | Toelichting |")
a("|---|---:|---|")
a(f"| Officiële Nederlandse lofzangen | {total} | Alle nummers 1 t/m {total} uit de officiële inhoudsopgave. |")
a(f"| Volledig geïmporteerde teksten | {c['textComplete']} | Alle coupletten, refreinen en bronvermeldingen van de officiële pagina. |")
a(f"| Tekst door de kerk niet gepubliceerd | {len(c['textUnavailable'])} | Nummers: {fmt(c['textUnavailable'])}. Officiële licentie-uitzondering; het nummer blijft, er wordt niets aangevuld. |")
a(f"| Onzekere teksten | {len(c['textUncertain'])} | Nummers: {fmt(c['textUncertain'])}. |")
a(f"| Met officiële bladmuziek (PDF) | {c['withPdf']} | De overige lofzangen hebben geen PDF (zie hieronder). |")
a(f"| Bladmuziek gelezen én gevalideerd | {c['scoreValidated']} | Maten sluiten aan, noten en tekst kloppen met de officiële tekst. |")
a(f"| Regelvolging beschikbaar | {c['lineFollowing']} | |")
a(f"| Woordvolging beschikbaar | {c['wordFollowing']} | Alleen als alle woorden betrouwbaar aan lettergrepen zijn gekoppeld; anders wordt de regel gemarkeerd. |")
a(f"| Herkenning beschikbaar | {c['recognizable']} | In de herkenningsgegevens opgenomen. Unieke melodieën: {c['uniqueCompositions']}. |")
a(f"| Herkenning gevalideerd met opnamen | {c['recognitionValidated']} | Juiste lofzang op de officiële begeleidingsopname, zonder verkeerde uitspraak: {c['recognitionAuto']} automatisch (de app volgt zelf), {c['recognitionSuggested']} als voorstel dat de gebruiker bevestigt. |")
a(f"| Noten bevestigd door de begeleidingsopname | {c['audioConfirmed']} | Onafhankelijke controle (zie 10-MUZIEKEXTRACTIE.md). |")
a("")
a("Onderscheid dat dit rapport bewust maakt:")
a("")
a(f"- **Bibliotheek compleet**: {c['textComplete']} van {total}. De {len(c['textUnavailable'])} ontbrekende teksten ({fmt(c['textUnavailable'])}) zijn licentie-uitzonderingen van de kerk zelf, geen importfouten.")
a(f"- **Muziekgegevens compleet**: {c['scoreValidated']} van {c['withPdf']} bladmuziek-PDF's gevalideerd; {c['withPdf'] - c['scoreValidated']} blijven onzeker en worden niet gebruikt.")
a(f"- **Live herkenning gevalideerd**: {c['recognitionValidated']} van {c['recognizable']}, uitsluitend op studio-opnamen van de begeleiding. Niet getest met een echte gemeente, zang, galm of kinderen.")
a("")
a("## 2. Lofzangen zonder volledige muziekondersteuning")
a("")
a("| Nr | Titel | Reden |")
a("|---:|---|---|")
for h in H:
    if h["capabilities"]["scoreValidated"]:
        continue
    reasons = "; ".join(h.get("textIssues", []) + h["music"].get("reasons", [])) or "-"
    a(f"| {h['number']} | {h['title']} | {reasons} |")
a("")
a(f"Dat zijn {len([h for h in H if not h['capabilities']['scoreValidated']])} lofzangen. Van {len(no_music)} daarvan is de tekst wel volledig leesbaar in Versado.")
a("")
a("## 3. Noten niet bevestigd door de opname")
a("")
a(f"Nummers waarvan de gelezen noten niet bij de (Engelse) begeleidingsopname passen: {fmt(c['audioDeviating'])}. Dat kan een andere harmonisatie in de Nederlandse uitgave zijn en is dus geen bewijs van een fout; de lofzang blijft gevalideerd op basis van de partituur zelf, maar telt niet mee als 'bevestigd'.")
(DATA.parent.parent.parent.parent.parent / "docs/hymns/15-KWALITEITSRAPPORT.md").write_text("\n".join(lines) + "\n")
print("rapport geschreven")
