#!/usr/bin/env python3
"""Headless smoke test for every page in the repo.

    python3 tools/smoke.py                  # all pages
    python3 tools/smoke.py cert_iii/UEEEC0069   # only paths containing this
    python3 tools/smoke.py -j 8 --deeplinks # 8 workers, also load ?q=2 on quiz pages
    python3 tools/smoke.py --links-only     # skip the browser, just check local links

Checks, per page:
  1. JS errors     — uncaught errors, unhandled promise rejections, console.error
  2. Local links   — every relative src/href (script, link, a, img) points at a file that exists
  3. Deep links    — (--deeplinks) quiz pages with a QUESTIONS array also load as ?q=2

Needs Chromium on PATH (override with CHROME=/path/to/chrome). Exit code is 1 if
anything fails, so it can run in CI. Temp copies are written next to the page
(relative paths must resolve) and removed afterwards; stale ones are swept first.
Pages under assets/shapes, assets/Templates and working/ are standalone
references and skipped unless --all is given.
"""
import argparse, concurrent.futures as cf, glob, os, re, subprocess, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME', 'chromium')
SKIP = ('/assets/shapes/', '/assets/Templates/', '/working/', '/.git/')

INJECT = ('<script>window.__e=[];'
          'addEventListener("error",function(e){window.__e.push((e.message||"error")+" @"+((e.filename||"").split("/").pop())+":"+e.lineno)});'
          'addEventListener("unhandledrejection",function(e){window.__e.push("rejection: "+e.reason)});'
          '(function(){var ce=console.error;console.error=function(){window.__e.push("console.error: "+Array.prototype.join.call(arguments," "));ce.apply(console,arguments)}})();'
          'addEventListener("load",function(){setTimeout(function(){document.title="SMOKE|"+JSON.stringify(window.__e)},400)});'
          '</script>')


def pages(filters, include_all):
    out = []
    for p in sorted(glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)):
        rel = os.path.relpath(p, ROOT)
        if os.path.basename(p).startswith('_smoke_'):
            continue
        if not include_all and any(s in '/' + rel.replace(os.sep, '/') for s in SKIP):
            continue
        if filters and not any(f in rel for f in filters):
            continue
        out.append(p)
    return out


def check_links(path, text):
    bad = []
    text = re.sub(r'<!--.*?-->|/\*.*?\*/', '', text, flags=re.S)   # prose in comments isn't a link
    base = os.path.dirname(path)
    for m in re.finditer(r'<(?:script|link|a|img|iframe)\b[^>]*?\b(?:src|href)="([^"]+)"', text, re.I):
        ref = m.group(1).strip()
        if re.match(r'^(https?:|//|mailto:|data:|javascript:|#|tel:)', ref, re.I) or '${' in ref or '{{' in ref:
            continue
        target = urllib.parse.unquote(ref.split('#')[0].split('?')[0])
        if not target:
            continue
        full = os.path.normpath(os.path.join(base, target))
        if not os.path.exists(full):
            bad.append(ref)
    return bad


def load(path, text, query='', retry=True):
    """Load `path` (+query) with the listener injected; return list of errors."""
    m = re.search(r'<head[^>]*>', text[text.find('<!DOCTYPE') if '<!DOCTYPE' in text else 0:], re.I)
    off = text.find('<!DOCTYPE') if '<!DOCTYPE' in text else 0
    t = text[:off + m.end()] + INJECT + text[off + m.end():] if m else INJECT + text
    tmp = os.path.join(os.path.dirname(path), '_smoke_' + os.path.basename(path))
    try:
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write(t)
        out = subprocess.run([CHROME, '--headless', '--disable-gpu', '--virtual-time-budget=4000',
                              '--dump-dom', 'file://' + tmp + query],
                             capture_output=True, text=True, timeout=90).stdout
    except subprocess.TimeoutExpired:
        if retry:
            return load(path, text, query, retry=False)   # slow under load — one more go
        return ['harness: browser timed out twice']
    except Exception as e:
        return [f'harness: {e}']
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    mm = re.search(r'<title>SMOKE\|(.*?)</title>', out, re.S)
    if not mm:
        if re.search(r'http-equiv=["\']refresh', text, re.I) or 'location.replace' in text:
            return []                       # redirect stub
        return ['page never fired load (no title written)']
    import json
    try:
        return json.loads(mm.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'))
    except Exception:
        return [mm.group(1)]


def run_one(path, deeplinks, links_only):
    text = open(path, encoding='utf-8', errors='replace').read()
    problems = [('link', b) for b in check_links(path, text)]
    if not links_only:
        problems += [('js', e) for e in load(path, text)]
        if deeplinks and re.search(r'\bconst\s+QUESTIONS\b|\bQUESTIONS\s*=', text):
            problems += [('deeplink ?q=2', e) for e in load(path, text, '?q=2')]
    return path, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('filters', nargs='*', help='only pages whose repo-relative path contains one of these')
    ap.add_argument('-j', '--jobs', type=int, default=4)
    ap.add_argument('--deeplinks', action='store_true')
    ap.add_argument('--links-only', action='store_true')
    ap.add_argument('--all', action='store_true', help='include assets/shapes, Templates and working/')
    a = ap.parse_args()

    for stale in glob.glob(os.path.join(ROOT, '**', '_smoke_*.html'), recursive=True):
        os.remove(stale)

    ps = pages(a.filters, a.all)
    print(f'{len(ps)} pages')
    failed = 0
    with cf.ThreadPoolExecutor(max_workers=a.jobs) as ex:
        for path, problems in ex.map(lambda p: run_one(p, a.deeplinks, a.links_only), ps):
            if problems:
                failed += 1
                print(f'FAIL {os.path.relpath(path, ROOT)}')
                for kind, msg in problems:
                    print(f'     [{kind}] {msg}')
    print(f'{len(ps) - failed} ok, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
