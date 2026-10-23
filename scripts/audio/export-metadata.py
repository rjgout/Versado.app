"""Exporteer uitsluitend controle-/uitlijningsmetadata; nooit audio, modellen of gebruikersdata."""
import argparse
import datetime
import importlib.metadata
import json
import pathlib
from official_inventory import ROOT, canonical_hash, page_verses

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=pathlib.Path, default=ROOT / '.audio-v2-work')
options = parser.parse_args()
root = options.root.resolve()
inventory = json.loads((root / 'inventory.json').read_text())
recordings, failures = {}, {}
for row in inventory['chapters']:
    for recording in row['recordings']:
        if recording['status'] != 'DOWNLOADED_VALIDATED':
            continue
        key = f'{recording["sha256"]}-{row["sourceHash"]}'
        file = root / 'alignment' / (key + '.json')
        # Historische NL-seedkop stond apart; herstel alleen de cache-identiteit.
        if not file.exists() and row['language'] == 'nl' and row['work'] == 'bofm':
            page = json.loads((root / row['pageFile']).read_text())
            old = canonical_hash({'heading': None, 'verses': [{'number': i+1, 'text': text} for i, text in enumerate(page_verses(page))]})
            previous = root / 'alignment' / f'{recording["sha256"]}-{old}.json'
            if previous.exists():
                value = json.loads(previous.read_text()); value['sourceHash'] = row['sourceHash']
                file.write_text(json.dumps(value))
        if file.exists():
            value = json.loads(file.read_text())
            if value['sha256'] != recording['sha256'] or value['sourceHash'] != row['sourceHash']:
                raise ValueError('ALIGNMENT_IDENTITY')
            recordings[key] = value
        else:
            error_file = file.with_suffix('.error.json')
            error = json.loads(error_file.read_text()).get('error') if error_file.exists() else 'ALIGNMENT_NOT_COMPLETED'
            failures[key] = {'work': row['work'], 'language': row['language'], 'bookKey': row['bookKey'], 'chapterNumber': row['chapterNumber'], 'voice': recording['voice'], 'error': error}
    # De bestaande grote legacy-lijst blijft de bestaande bron; geen tweede kopie.
    row.pop('legacyEntries', None)
output = ROOT / 'data/audio'; output.mkdir(exist_ok=True, parents=True)
inventory['exportedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(output / 'official-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2)+'\n')
versions = {}
for name in ('vosk', 'av', 'numpy'):
    try: versions[name] = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError: versions[name] = 'Zie uitvoeringsrapport'
(output / 'official-alignments.json').write_text(json.dumps({'schemaVersion':1,'createdAt':inventory['exportedAt'],'software':versions,'recordings':recordings,'failures':failures},ensure_ascii=False,indent=2)+'\n')
print(f'Metadata: {len(inventory["chapters"])} hoofdstukdoelen, {len(recordings)} uitlijningen, {len(failures)} review-/uitlijningspunten.')
