#!/usr/bin/env python3
"""Screenshot capture + pixel diff, for checking that a refactor changed nothing visible.

    # 1. before touching anything
    python3 tools/shots.py capture before cert_iii/UEEEC0069/term-2/knowledge
    # 2. ...migrate / refactor...
    python3 tools/shots.py capture after  cert_iii/UEEEC0069/term-2/knowledge
    # 3. compare
    python3 tools/shots.py diff before after

What is captured, per page:
  quiz pages (a QUESTIONS array)  every question fresh (?q=N) and answered/worked (?q=N&ans=1),
                                  plus the summary (?q=s)
  everything else                 the page as loaded
Runs are deterministic: Math.random is seeded, CSS animations/transitions are off, the
viewport is fixed — so two captures of an unchanged page are pixel-identical.

Limits worth knowing:
  * Seeded randomness still depends on the ORDER of Math.random() calls. If a refactor
    changes how many shuffles happen before a render, option orders (and so pixels)
    change even though nothing is wrong — look at the diff image before panicking.
  * Pages driven by real time (simulators, animations) will not be stable; capture
    them with --no-diff-pages or skip them with filters.
  * Web fonts load from Google Fonts: capture before/after in the same network state.

Images live in $SHOTS_DIR (default ~/.cache/tafe-shots), outside the repo.
Needs Chromium on PATH (CHROME=... to override) and Pillow + numpy for `diff`.
"""
import argparse, concurrent.futures as cf, glob, hashlib, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME', 'chromium')
BASE = os.environ.get('SHOTS_DIR', os.path.expanduser('~/.cache/tafe-shots'))
SKIP = ('/assets/shapes/', '/assets/Templates/', '/working/', '/.git/')
W, H = 1200, 2000

SEED = ('<script>(function(){var s=20260101;Math.random=function(){s|=0;s=s+0x6D2B79F5|0;'
        'var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})();'
        '</script>')
CALM = ('<style>*,*::before,*::after{animation:none!important;transition:none!important;'
        'caret-color:transparent!important;scroll-behavior:auto!important}</style>')
COUNT = ('<script>addEventListener("load",function(){setTimeout(function(){document.title="QN="+'
         '(typeof QUESTIONS!=="undefined"&&QUESTIONS.length?QUESTIONS.length:0)},300)});</script>')


def pages(filters, include_all):
    out = []
    for p in sorted(glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)):
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        if '/_shots_' in '/' + rel or os.path.basename(p).startswith('_smoke_'):
            continue
        if not include_all and any(s in '/' + rel for s in SKIP):
            continue
        if filters and not any(f in rel for f in filters):
            continue
        out.append(p)
    return out


def instrumented(text, extra=''):
    off = text.find('<!DOCTYPE') if '<!DOCTYPE' in text else 0
    m = re.search(r'<head[^>]*>', text[off:], re.I)
    ins = SEED + CALM + extra
    if m:
        return text[:off + m.end()] + ins + text[off + m.end():]
    return ins + text


def browse(path, text, query, extra, shot=None, dom=False):
    tag = hashlib.md5((path + query + str(os.getpid()) + str(id(text))).encode()).hexdigest()[:8]
    tmp = os.path.join(os.path.dirname(path), f'_shots_{tag}_{os.path.basename(path)}')
    try:
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write(instrumented(text, extra))
        cmd = [CHROME, '--headless', '--disable-gpu', '--hide-scrollbars', f'--window-size={W},{H}',
               '--virtual-time-budget=5000']
        if shot:
            cmd.append(f'--screenshot={shot}')
        if dom:
            cmd.append('--dump-dom')
        cmd.append('file://' + tmp + query)
        for attempt in (1, 2):             # a hung browser gets one more go, then is reported
            try:
                return subprocess.run(cmd, capture_output=True, text=True, timeout=75).stdout
            except subprocess.TimeoutExpired:
                subprocess.run(['pkill', '-f', os.path.basename(tmp)], capture_output=True)
        return ''
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def slug(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/').replace('/', '__')[:-5]


def question_count(path, text):
    if not re.search(r'\bQUESTIONS\b', text):
        return 0
    out = browse(path, text, '', COUNT, dom=True)
    m = re.search(r'<title>QN=(\d+)</title>', out)
    return int(m.group(1)) if m else 0


def jobs_for(path, quick):
    text = open(path, encoding='utf-8', errors='replace').read()
    n = question_count(path, text) or ARGS.count
    d = os.path.join(BASE, ARGS.label, slug(path))
    if n == 0:
        return [(path, text, '', os.path.join(d, 'page.png'))]
    js = []
    for q in range(1, n + 1):
        if not quick:
            js.append((path, text, f'?q={q}', os.path.join(d, f'q{q:02d}.png')))
        js.append((path, text, f'?q={q}&ans=1', os.path.join(d, f'q{q:02d}_ans.png')))
    js.append((path, text, '?q=s', os.path.join(d, 'summary.png')))
    return js


def shoot(job):
    path, text, query, out = job
    os.makedirs(os.path.dirname(out), exist_ok=True)
    browse(path, text, query, '', shot=out)
    return out, os.path.exists(out)


def capture(a):
    for stale in glob.glob(os.path.join(ROOT, '**', '_shots_*.html'), recursive=True):
        os.remove(stale)
    ps = pages(a.filters, a.all)
    print(f'{len(ps)} pages -> {os.path.join(BASE, a.label)}')
    with cf.ThreadPoolExecutor(max_workers=a.jobs) as ex:
        jobs = [j for js in ex.map(lambda p: jobs_for(p, a.quick), ps) for j in js]
        print(f'{len(jobs)} screenshots')
        missing = [o for o, ok in ex.map(shoot, jobs) if not ok]
    print('done' if not missing else f'{len(missing)} screenshots missing: {missing[:5]}')
    return 1 if missing else 0


def diff(a):
    import numpy as np
    from PIL import Image
    b, c = os.path.join(BASE, a.before), os.path.join(BASE, a.after)
    names = sorted(os.path.relpath(p, b) for p in glob.glob(os.path.join(b, '**', '*.png'), recursive=True)
                   if os.sep + '_diff' + os.sep not in p)
    same = changed = missing = 0
    for n in names:
        p2 = os.path.join(c, n)
        if not os.path.exists(p2):
            print(f'MISSING in {a.after}: {n}')
            missing += 1
            continue
        i1, i2 = Image.open(os.path.join(b, n)).convert('RGB'), Image.open(p2).convert('RGB')
        if a.crop:
            box = tuple(int(v) for v in a.crop.split(','))
            i1, i2 = i1.crop(box), i2.crop(box)
        if i1.size != i2.size:
            print(f'SIZE   {n}: {i1.size} -> {i2.size}')
            changed += 1
            continue
        d = np.abs(np.asarray(i1, dtype=np.int16) - np.asarray(i2, dtype=np.int16)).max(axis=2) > a.tolerance
        frac = d.mean()
        if frac <= a.threshold:
            same += 1
            continue
        changed += 1
        ys, xs = np.where(d)
        print(f'DIFF   {n}: {frac*100:.3f}% of pixels, bbox x{xs.min()}-{xs.max()} y{ys.min()}-{ys.max()}')
        out = os.path.join(c, '_diff', n)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        hl = np.asarray(i2).copy()
        hl[d] = [255, 0, 255]
        w, h = i1.size
        sheet = Image.new('RGB', (w * 3, h), 'white')
        sheet.paste(i1, (0, 0)); sheet.paste(i2, (w, 0)); sheet.paste(Image.fromarray(hl), (2 * w, 0))
        sheet.save(out)
    print(f'{same} identical, {changed} changed, {missing} missing  (diff sheets: {os.path.join(c, "_diff")})')
    return 1 if changed or missing else 0


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest='cmd', required=True)
c = sub.add_parser('capture')
c.add_argument('label'); c.add_argument('filters', nargs='*')
c.add_argument('-j', '--jobs', type=int, default=4)
c.add_argument('--quick', action='store_true', help='only the answered/worked state, not the fresh question')
c.add_argument('--all', action='store_true')
c.add_argument('--count', type=int, default=0, help='treat pages with no QUESTIONS array as quizzes with this many ?q=N questions')
d = sub.add_parser('diff')
d.add_argument('before'); d.add_argument('after')
d.add_argument('--threshold', type=float, default=0.0, help='fraction of pixels allowed to differ (0.001 = 0.1%%)')
d.add_argument('--crop', default='', help='x0,y0,x1,y1 — compare only this region of every image')
d.add_argument('--tolerance', type=int, default=8, help='per-channel difference ignored (anti-aliasing noise)')
ARGS = ap.parse_args()

if __name__ == '__main__':
    sys.exit(capture(ARGS) if ARGS.cmd == 'capture' else diff(ARGS))
