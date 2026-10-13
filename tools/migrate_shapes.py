#!/usr/bin/env python3
"""Move pages from pasted shape <defs> to the shared shape library (assets/shapes.js).

    python3 tools/migrate_shapes.py --list              # classify every page
    python3 tools/migrate_shapes.py --dry  [pages…]     # show what would change
    python3 tools/migrate_shapes.py --apply [pages…]    # rewrite the pages
    (no pages = every page whose pasted shapes ALL match the masters)

For each page it looks at the top-level shapes inside <defs> blocks:
  * identical to a master shape                       -> removed, library supplies it
  * identical apart from a root transform="scale(…)"  -> removed, transform passed to Shapes.use
  * page-specific (id not in any master)              -> left alone
  * same id but different markup ("drift")            -> kept in the page (the library skips ids already
                                                         present, so the page looks exactly as before);
                                                         reported so you can decide page vs master
Then it adds <script src=".../assets/shapes.js"> after theme-init.js and a
Shapes.use(...) call just before the page's first inline <script> in <body> (after all
local <defs>, so kept-local shapes win), and drops hidden <svg><defs> wrappers left empty.
Comments are preserved; only the shape elements are cut.
Check every migrated page with tools/shots.py (before/after) and tools/smoke.py.
"""
import argparse, collections, glob, json, os, re, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_shapes as bs  # noqa: E402

ROOT = bs.ROOT
SKIP = ('assets/shapes/', 'Templates', 'working/', '/college/', '/.git/', 'tools/')


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


PRES = {'stroke', 'fill', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
        'opacity', 'fill-opacity', 'stroke-opacity', 'filter', 'font-size', 'font-weight', 'font-family'}


def canon(markup):
    """Canonical form for comparing shape markup: tag attributes become a sorted set in which
    presentation attributes and the equivalent style="prop: value" declarations are merged
    (style wins), and whitespace is collapsed. Two copies that differ only in syntax compare equal.
    Geometry, colours and structure still have to match exactly."""
    def tag(m):
        close, name, attrs, selfc = m.groups()
        if close:
            return f'</{name}>'
        d = {}
        for am in re.finditer(r'([\w:-]+)\s*=\s*"([^"]*)"', attrs):
            d[am.group(1)] = am.group(2)
        style = d.pop('style', '')
        for decl in style.split(';'):
            if ':' in decl:
                k, v = decl.split(':', 1)
                d[k.strip()] = v.strip()          # style overrides the attribute
        d = {k: re.sub(r'\s+', ' ', v).strip() for k, v in d.items()}
        return '<' + name + ''.join(f' {k}="{d[k]}"' for k in sorted(d)) + ('/' if selfc else '') + '>'
    out = re.sub(r'<(/?)([\w:-]+)([^>]*?)(/?)>', tag, markup)
    return re.sub(r'>\s+<', '><', re.sub(r'\s+', ' ', out)).strip()


def strip_tf(markup):
    m = re.match(r'(<\w+\b[^>]*?)\s+transform="([^"]*)"', markup)
    if m:
        return markup.replace(f' transform="{m.group(2)}"', '', 1), m.group(2)
    return markup, None


def master_index():
    idx = collections.defaultdict(dict)       # id -> {set: canonical markup}
    for sname, body in bs.read_sets().items():
        for i, blk in bs.element_blocks(body).items():
            idx[i][sname] = canon(blk)
    return idx


def blank_comments(text):
    return re.sub(r'<!--.*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)


def element_spans(markup, base):
    out, depth, cur, start = [], 0, None, None
    for m in re.finditer(r'<(/?)([\w:-]+)([^>]*?)(/?)>', markup):
        close, _n, attrs, selfclose = m.groups()
        if close:
            depth -= 1
            if depth == 0 and cur is not None:
                out.append((cur, base + start, base + m.end()))
                cur = None
            continue
        if depth == 0:
            idm = re.search(r'\sid="([^"]+)"', attrs)
            start = m.start()
            cur = idm.group(1) if idm else None
            if selfclose and cur:
                out.append((cur, base + start, base + m.end()))
                cur = None
        if not selfclose:
            depth += 1
    return out


def classify(text, idx, adopt=()):
    """-> (todo, drift): todo = [(id, a, b, sets, transform)], drift = [ids]"""
    blank = blank_comments(text)
    todo, drift = [], []
    for dm in re.finditer(r'<defs[^>]*>(.*?)</defs>', blank, re.S):
        body = re.sub(r'<style\b[^>]*>.*?</style>', lambda m: ' ' * len(m.group(0)), dm.group(1), flags=re.S)
        for i, a, b in element_spans(body, dm.start(1)):
            if i not in idx:
                continue
            n = canon(blank[a:b])
            hit = [s for s, v in idx[i].items() if v == n]
            tf = None
            if not hit:
                raw = norm(blank[a:b])
                _stripped, tf = strip_tf(raw)
                if tf:
                    n2 = canon(_stripped)
                    hit = [s for s, v in idx[i].items() if v == n2]
            if hit:
                todo.append((i, a, b, hit, tf))
            elif i in adopt:                      # master wins: drop the page's differing copy
                todo.append((i, a, b, list(idx[i]), None))
            else:
                drift.append(i)
    return todo, drift


def migrate(path, idx, write, adopt=()):
    text = open(path, encoding='utf-8').read()
    todo, drift = classify(text, idx, adopt)
    if not todo:
        return None, 'nothing to migrate' + (' (drift: ' + ', '.join(drift) + ')' if drift else '')
    new = text
    for i, a, b, hit, tf in sorted(todo, key=lambda t: -t[1]):
        new = new[:a] + new[b:]
    tfmap = {i: tf for i, _a, _b, _h, tf in todo if tf}
    idsets = {t[0]: set(t[3]) for t in todo}
    remaining, chosen = set(idsets), []
    while remaining:
        cnt = collections.Counter(s for i in remaining for s in idsets[i])
        best = sorted(cnt.items(), key=lambda x: (-x[1], x[0]))[0][0]
        chosen.append(best)
        remaining = {i for i in remaining if best not in idsets[i]}
    new = re.sub(r'[ \t]*<svg\b[^>]*(?:width="0"|aria-hidden="true")[^>]*>\s*<defs[^>]*>\s*</defs>\s*</svg>[ \t]*\n?',
                 '', new)
    existing = re.search(r"Shapes\.use\(([^)]*)\)", new)
    if existing:                               # page already on the library: just make sure the sets are listed
        have = set(re.findall(r"'([\w-]+)'", existing.group(1).split('{')[0]))
        missing = [c for c in chosen if c not in have]
        if missing and not (set(idsets) <= {'glow'}):     # every set carries glow, so glow alone needs nothing
            head, _, tail = existing.group(1).partition('{')
            add = ', '.join("'" + c + "'" for c in missing)
            repl = head.rstrip().rstrip(',') + ', ' + add + ((', {' + tail) if tail else '')
            new = new[:existing.start(1)] + repl + new[existing.end(1):]
    else:
        rel = os.path.relpath(os.path.join(ROOT, 'cert_iii', 'assets', 'shapes.js'), os.path.dirname(path)).replace(os.sep, '/')
        mt = re.search(r'([ \t]*)<script src="[^"]*assets/theme-init\.js"></script>\n', new)
        if not mt:
            return None, 'no theme-init.js tag to anchor on'
        new = new[:mt.end()] + f'{mt.group(1)}<script src="{rel}"></script>\n' + new[mt.end():]
        args = ', '.join("'" + s_ + "'" for s_ in chosen)
        if tfmap:
            args += ', { transform: { ' + ', '.join(f"'{k}': '{v}'" for k, v in sorted(tfmap.items())) + ' } }'
        # Insert the call just before the page's first inline <script> after <body>: by then every
        # page-local <defs> has been parsed, so Shapes.use() skips ids the page defines itself
        # (kept-local drift stays in force) — yet it still runs before the page's own script.
        mb = re.search(r'<body[^>]*>\n', new)
        if not mb:
            return None, 'no <body> line'
        ms = re.search(r'[ \t]*<script(?![^>]*\bsrc=)[^>]*>', new[mb.end():])
        at = mb.end() + ms.start() if ms else (new.rfind('</body>') if '</body>' in new else len(new))
        new = new[:at] + f'  <script>Shapes.use({args});</script>\n' + new[at:]
    if write:
        open(path, 'w', encoding='utf-8').write(new)
    return dict(removed=len(todo), sets=chosen, transforms=len(tfmap), kept_local=sorted(set(drift)),
                lines=text.count('\n') - new.count('\n')), 'ok'


def all_pages():
    for p in sorted(glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)):
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        if any(s in '/' + rel for s in SKIP):
            continue
        yield p


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pages', nargs='*')
    ap.add_argument('--adopt', default='', help='comma list of ids where the MASTER wins over a differing page copy')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--list', action='store_true')
    g.add_argument('--dry', action='store_true')
    g.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    idx = master_index()
    adopt = set(x for x in a.adopt.split(',') if x)
    paths = [os.path.abspath(p) for p in a.pages] if a.pages else list(all_pages())
    if a.list:
        keep = set()
        kp = os.path.join(HERE, 'shapes_intentional.txt')
        if os.path.exists(kp):
            for line in open(kp, encoding='utf-8'):
                line = line.strip()
                if line and not line.startswith('#') and '|' in line:
                    keep.add(tuple(line.split('|', 1)))
        clean = 0
        for p in paths:
            todo, drift = classify(open(p, encoding='utf-8').read(), idx)
            rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
            intentional = [d for d in drift if (rel, d) in keep]
            drift = [d for d in drift if (rel, d) not in keep]
            if not todo and not drift and not intentional:
                continue
            clean += not drift
            tag = 'OK   ' if not drift and not intentional else ('KEEP ' if not drift else 'DRIFT')
            print(tag, rel, f'match={len(todo)}',
                  ('drift=' + ','.join(drift[:6])) if drift else '',
                  ('intentional=' + ','.join(intentional)) if intentional else '')
        print(f'{clean} pages fully migratable')
        return 0
    for p in paths:
        if not a.pages:
            todo, drift = classify(open(p, encoding='utf-8').read(), idx, adopt)
            if not todo:
                continue
        res, msg = migrate(p, idx, write=a.apply, adopt=adopt)
        print(os.path.relpath(p, ROOT), '->', res if res else 'SKIP: ' + msg)
    return 0


if __name__ == '__main__':
    sys.exit(main())
