"""Herbruik Vosk/pauze-uitlijning voor gevalideerde officiële bestanden, zonder seedtimings te wijzigen.

Bestaande tijdcodes alleen bij exact dezelfde bron-URL en tekst. Onzekere
uitlijning krijgt NEEDS_REVIEW; geen verzonnen/lege segmenten publiceren.
"""
import concurrent.futures
import json
import multiprocessing
import pathlib
import sys
import traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'bom-audio'))
from common import load_audio, find_pauses, recognize, units_for, LANGUAGES
from align import unit_starts
from official_inventory import ROOT
ROOT_WORK = ROOT / '.audio-v2-work'
MODELS = {}


def job(task):
    row, recording = task
    key = recording['sha256'] + '-' + (row.get('sourceHash') or row['sourcePageHash'])
    output = ROOT_WORK / 'alignment' / (key + '.json')
    if output.exists(): return 'CACHED'
    try:
        page = json.loads((ROOT_WORK / row['pageFile']).read_text())
        duration = recording['duration']
        legacy = next((e for e in row['legacyEntries'] if e['url'] == recording['url']), None)
        if legacy and (len(legacy['verseStarts']) != row['actualVerseCount'] or any(s < 0 or s >= duration for s in legacy['verseStarts']) or any(a >= b for a,b in zip(legacy['verseStarts'],legacy['verseStarts'][1:]))):
            legacy = None
        starts = legacy['verseStarts'] if legacy else None
        quality, method, matched = 'VALIDATED', 'LEGACY_VERIFIED_SOURCE', 1.0
        if starts is None:
            from vosk import Model, SetLogLevel
            SetLogLevel(-1)
            language = row['language']
            if language not in MODELS:
                MODELS[language] = Model(str(ROOT_WORK / 'models' / LANGUAGES[language]['model']))
            samples, sr = load_audio(str(ROOT_WORK / recording['localFile']))
            pauses, _ = find_pauses(samples, sr)
            cache = ROOT_WORK / 'words' / (recording['sha256'] + '-' + language + '.json')
            if cache.exists(): words = json.loads(cache.read_text())
            else:
                words = recognize(samples, sr, MODELS[language], page)
                cache.write_text(json.dumps(words))
            units = unit_starts(words, page, pauses)
            verses = [u for u in units if u[0].startswith('v')]
            starts = [u[1] for u in verses]
            matched = sum(u[2] is True for u in verses) / max(1, len(verses))
            method = 'VOSK_PAUSE_ALIGNMENT'
            if matched < .85 or any(u[2] == 'missing' for u in verses): quality = 'NEEDS_REVIEW'
        if len(starts) != row['actualVerseCount'] or any(s < 0 or s >= duration for s in starts) or any(a >= b for a, b in zip(starts, starts[1:])):
            raise ValueError('SEGMENT_BOUNDARIES_INVALID')
        texts = [text for key, text in units_for(page) if key.startswith('v')]
        ends = starts[1:] + [duration]
        # De bestaande export markeert extreem snelle/lange segmenten als onzeker.
        if any((end-start)/max(1,len(text)) < .018 or (end-start)/max(1,len(text)) > .22 for start,end,text in zip(starts,ends,texts)):
            quality = 'NEEDS_REVIEW'
        output.write_text(json.dumps({'schemaVersion':1,'sourceUrl':recording['url'],'sha256':recording['sha256'],'sourceHash':row.get('sourceHash') or row['sourcePageHash'],'duration':duration,'starts':starts,'quality':quality,'method':method,'matched':round(matched,3)}))
        output.with_suffix('.error.json').unlink(missing_ok=True)
        return quality
    except Exception as error:
        output.with_suffix('.error.json').write_text(json.dumps({'error':str(error),'trace':traceback.format_exc()[-700:]}))
        return 'ERROR'


if __name__ == '__main__':
    for directory in ('alignment','words'): (ROOT_WORK / directory).mkdir(exist_ok=True)
    rows = json.loads((ROOT_WORK / 'inventory.json').read_text())['chapters']
    tasks = [(row, recording) for row in rows for recording in row['recordings'] if recording['status'] == 'DOWNLOADED_VALIDATED']
    # Eerst ontbrekende uitlijning van de primaire opname; alternatieve stemmen daarna.
    tasks.sort(key=lambda task: (not bool(task[0]['legacyEntries']), task[0]['recordings'].index(task[1]) > 0, task[0]['language']))
    from collections import Counter
    counts = Counter()
    with concurrent.futures.ProcessPoolExecutor(max_workers=4, mp_context=multiprocessing.get_context('spawn')) as pool:
        for i, value in enumerate(pool.map(job, tasks, chunksize=1),1):
            counts[value] += 1
            if i % 20 == 0: print(i, '/', len(tasks), dict(counts), flush=True)
    print('Klaar', dict(counts), flush=True)
