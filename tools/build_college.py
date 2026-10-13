#!/usr/bin/env python3
"""Build self-contained single-file copies of student pages for the college folder.

Why: the teacher opens files from a USB stick or email, without the shared
assets/ folder. Each output file has every local <link rel=stylesheet> and
<script src> inlined, assets/shapes.js trimmed to the sets the page asks for,
and the breadcrumb script dropped (its links point into the full site).

    python3 tools/build_college.py PAGE.html [PAGE.html ...] [--out DIR]

Default --out is build/college (git-ignored). Output names get a _college
suffix. Nothing in cert_iii/UEEEC0069/college/ is touched — review the result,
then copy it across yourself.

Limits: relative url(...) references inside inlined CSS are left alone (the
suite uses none); google-font <link>s stay as they are (they degrade to system
fonts offline).
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKIP = {'breadcrumb.js'}


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def trim_shapes(js, page):
    """Keep only the SETS entries named in the page's Shapes.use(...) calls."""
    wanted = set()
    for call in re.findall(r'Shapes\.use\(([^;]*?)\)\s*;', page):
        wanted.update(re.findall(r'[\'"]([a-z0-9-]+)[\'"]', call))
    head, rest = js.split('var SETS = {', 1)
    body, tail = rest.split('\n  };', 1)
    lines = [l for l in body.split('\n') if l.strip()]
    keep = [l for l in lines if re.match(r'\s*"([^"]+)":', l) and re.match(r'\s*"([^"]+)":', l).group(1) in wanted]
    if keep:
        keep[-1] = keep[-1].rstrip(',')
    return head + 'var SETS = {\n' + '\n'.join(keep) + '\n  };' + tail


def build(path, out_dir):
    page = read(path)
    base = os.path.dirname(os.path.abspath(path))

    def script(m):
        src = m.group(1)
        if re.match(r'[a-z]+:|//', src):
            return m.group(0)
        name = os.path.basename(src)
        if name in SKIP:
            return ''
        js = read(os.path.normpath(os.path.join(base, src)))
        if name == 'shapes.js':
            js = trim_shapes(js, page)
        return '<script>\n' + js.replace('</script', '<\\/script') + '\n</script>'

    def css(m):
        tag = m.group(0)
        h = re.search(r'href="([^"]+)"', tag)
        if not h or re.match(r'[a-z]+:|//', h.group(1)) or 'stylesheet' not in tag:
            return tag
        return '<style>\n' + read(os.path.normpath(os.path.join(base, h.group(1)))) + '\n</style>'

    page = re.sub(r'<script\s+src="([^"]+)"[^>]*>\s*</script>', script, page)
    page = re.sub(r'<link\b[^>]*>', css, page)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, os.path.basename(path)[:-5] + '_college.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    return out


def main(argv):
    out_dir = os.path.join(ROOT, 'build', 'college')
    if '--out' in argv:
        i = argv.index('--out')
        out_dir = argv[i + 1]
        del argv[i:i + 2]
    if not argv:
        print(__doc__)
        return 2
    for p in argv:
        o = build(p, out_dir)
        print(f'{p} -> {o} ({os.path.getsize(o) // 1024} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
