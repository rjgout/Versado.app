"""Gecontroleerde openbare bronnen; geen database, scraper of videospiegel.
Herhaal expliciet met --refresh. HTTP-bewijs is geen interne editie-equivalentie.
"""
import concurrent.futures, datetime, hashlib, html.parser, ipaddress, json, pathlib, re, socket, sys, threading, urllib.error, urllib.parse, urllib.request
ROOT = pathlib.Path('data/study-content/cfm-2026-nl')
ALLOWED = {'www.churchofjesuschrist.org', 'assets.churchofjesuschrist.org'}
class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('REDIRECT_REQUIRES_REVIEW')
OPENER = urllib.request.build_opener(SafeRedirect)
class Ids(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.ids=set()
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if a.get('id'): self.ids.add(a['id'])
cache={}; lock=threading.Lock()
def safe_url(raw):
    u=urllib.parse.urlsplit(raw)
    if u.scheme!='https' or u.hostname not in ALLOWED or u.username or u.password or u.port or '\\' in raw or any(ord(c)<33 for c in raw): raise ValueError('UNAPPROVED_URL')
    if any(not ipaddress.ip_address(x[4][0]).is_global for x in socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM)): raise ValueError('NON_PUBLIC_DNS')
    return u

def fetch(url, limit, headers=None):
    safe_url(url)
    with OPENER.open(urllib.request.Request(url, headers=headers or {}),timeout=25) as r:
        data=r.read(limit+1)
        if len(data)>limit: raise ValueError('RESPONSE_TOO_LARGE')
        return data,r.status,r.headers.get('Content-Type','')

def api_page(path):
    uri=path.removeprefix('/study')
    url='https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?'+urllib.parse.urlencode({'lang':'nld','uri':uri})
    with lock:
        if path in cache: return cache[path]
    raw,status,mime=fetch(url,5_000_000)
    d=json.loads(raw); meta=d.get('meta',{}); content=d.get('content',{}); attrs=meta.get('pageAttributes',{})
    if d.get('restricted') not in (False,0) or d.get('uri')!=uri or attrs.get('lang')!='nld' or attrs.get('data-uri')!=uri or not content.get('body') or not meta.get('title'): raise ValueError('LANGUAGE_OR_CANONICAL_IDENTITY_UNPROVEN')
    ids=Ids(); ids.feed(content['body'])
    result={'verifiedApi':url,'sourceHash':hashlib.sha256(raw).hexdigest(),'title':meta['title'],'language':'nl','canonicalUri':uri,'ids':ids.ids}
    with lock: cache[path]=result
    return result

def review(url):
    row={'url':url,'verified':False}
    try:
        u=safe_url(url)
        if u.hostname=='www.churchofjesuschrist.org' and u.path.startswith('/study/'):
            if any(k not in {'lang','id'} for k,v in urllib.parse.parse_qsl(u.query)) or urllib.parse.parse_qs(u.query).get('lang')!=['nld']: raise ValueError('QUERY_OR_LANGUAGE_REVIEW')
            page=api_page(u.path)
            wanted=[]
            for part in urllib.parse.parse_qs(u.query).get('id',[''])[0].split(','):
                if not part: continue
                m=re.fullmatch(r'p(\d+)-p?(\d+)',part)
                if m:
                    a,b=map(int,m.groups())
                    if not 1<=a<=b<=500: raise ValueError('ANCHOR_RANGE')
                    wanted.extend('p'+str(i) for i in range(a,b+1))
                else: wanted.append(part)
            if u.fragment: wanted.append(u.fragment)
            if any(x not in page['ids'] for x in wanted): raise ValueError('SOURCE_ANCHOR_NOT_PROVEN')
            row.update({k:v for k,v in page.items() if k!='ids'},anchorsVerified=sorted(set(wanted)),verified=True,method='official-nld-content-api')
        elif u.hostname=='assets.churchofjesuschrist.org' and u.path.lower().endswith(('.pdf','.mp4')):
            # Alleen prefix; geen download/mirror van video's of PDF-bestanden.
            req=urllib.request.Request(url,headers={'Range':'bytes=0-1023'})
            with OPENER.open(req,timeout=25) as r:
                prefix=r.read(1024); status=r.status; mime=r.headers.get('Content-Type','').split(';')[0]
                size=r.headers.get('Content-Range') or r.headers.get('Content-Length')
            pdf=u.path.lower().endswith('.pdf')
            if pdf and not (prefix.startswith(b'%PDF-') and mime=='application/pdf'): raise ValueError('PDF_SIGNATURE')
            if not pdf and not (prefix[4:8]==b'ftyp' and mime=='video/mp4'): raise ValueError('VIDEO_SIGNATURE')
            row.update(binaryChecked=True,mediaLanguage='und' if pdf else 'nl' if re.search(r'-nl\.mp4$',u.path,re.I) else 'en',method='official-binary-prefix-only',mimeType=mime,prefixHash=hashlib.sha256(prefix).hexdigest(),sizeEvidence=size,status=status)
            row['requiresLanguageDisclosure']=not pdf and row['mediaLanguage']=='en'
            row['verified']=True
        else: raise ValueError('RESOURCE_TYPE_REQUIRES_REVIEW')
    except Exception as e:
        row['reason']=('HTTP_'+str(e.code)) if isinstance(e,urllib.error.HTTPError) else str(e) if isinstance(e,ValueError) else type(e).__name__
    return row

def main():
    out=ROOT/'reference-source-checks.json'
    if out.exists() and '--retry-transient' in sys.argv:
        data=json.loads(out.read_text())
        for row in data['resources']:
            if row.get('mimeType')=='application/pdf': row['mediaLanguage']='und'
            if row.get('reason') in {'HTTP_503','HTTP_429','TimeoutError','URLError'}:
                fresh=review(row['url']); row.clear(); row.update(fresh)
        additional=json.loads((ROOT/'reference-review-additional.json').read_text())
        known={r['url'] for r in data['resources']}
        for r in additional['occurrences']:
            if r['originalTarget']['externalUrl'] not in known:
                data['resources'].append(review(r['originalTarget']['externalUrl'])); known.add(r['originalTarget']['externalUrl'])
        data['resources'].sort(key=lambda r:r['url'])
        out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
        return
    if out.exists() and '--refresh' not in sys.argv: raise SystemExit('Gebruik --refresh voor een bewuste nieuwe netwerkcontrole.')
    baseline=json.loads((ROOT/'reference-review-baseline.json').read_text())
    additional=json.loads((ROOT/'reference-review-additional.json').read_text())
    urls=sorted({r['originalTarget']['externalUrl'] for r in baseline['occurrences']+additional['occurrences']})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(review,urls))
    out.write_text(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'methodVersion':1,'automaticInternalEquivalence':False,'resources':rows},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'uniqueUrls':len(rows),'verified':sum(r['verified'] for r in rows),'manual':sum(not r['verified'] for r in rows)}))
if __name__=='__main__': main()
