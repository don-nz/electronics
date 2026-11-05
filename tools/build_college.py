#!/usr/bin/env python3
"""Build self-contained single-file copies of student pages for the college folder.

Why: the teacher opens files from a USB stick or email, without the shared
assets/ folder, and wants the NSW TAFE look rather than the site's own theme.

    python3 tools/build_college.py PAGE.html [PAGE.html ...] [--out DIR]

Default --out is build/college (git-ignored). Output names get a _college
suffix. Nothing in cert_iii/UEEEC0069/college/ is touched — review the result,
then copy it across yourself.

Two kinds of page are handled:

  Waveform-builder pages (they load assets/waveform-builder.js — the timing-diagram
  drills) are CONVERTED: the student page's own markup and script are kept, so the
  college copy always has the same behaviour, and are dressed in the TAFE theme:
    - tools/college/theme.css      replaces assets/quiz-common.css (palette, Public Sans,
                                   .main-wrap/.card-top-bar layout, light/dark, print)
    - tools/college/theme-toggle.js replaces assets/theme-init.js
    - the page skeleton is rewritten (breadcrumb, .quiz-wrap, progress bar and footer
      become the college top bar and copyright line; button classes are mapped)
    - assets/waveform-builder.js and the trimmed assets/shapes.js are inlined as they are
    - the page's own <style> goes first so the TAFE theme wins any clash, and the page
      script has the student-only "← Back" breadcrumb code removed
  To change how the college pages look, edit tools/college/theme.css and rebuild.

  Any other page is BUNDLED: every local <link rel=stylesheet> and <script src> is
  inlined as it is, assets/shapes.js trimmed to the sets the page asks for, and the
  breadcrumb script dropped. That keeps the site's own styling, so it is not a
  college look.

Limits: relative url(...) references inside inlined CSS are left alone (the
suite uses none); google-font <link>s stay as they are (they degrade to system
fonts offline).
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKIP = {'breadcrumb.js'}

COLLEGE_FONTS = ('<link href="https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600'
                 '&family=Share+Tech+Mono&display=swap" rel="stylesheet">')
TOP_BAR = '''<div class="card-top-bar">
      <a class="back-link" href="./index.html">← All exercises</a>
      <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle dark and light theme">
        <span id="themeIcon">🌙</span> <span id="themeLabel">Dark Mode</span>
      </button>
    </div>
'''
COPYRIGHT = '<p class="site-copyright">&copy; 2026 Anderson Home Technology. All rights reserved.</p>'


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


def inline_js(js):
    return '<script>\n' + js.replace('</script', '<\\/script') + '\n</script>'


def sub_once(pattern, repl, text, what, flags=re.S, path=''):
    """re.sub that insists the pattern is found — a student page that no longer matches the
    skeleton this tool expects should fail loudly, not produce a quietly broken college page."""
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'build_college: could not find {what} in {path or "the page"} — update tools/build_college.py')
    return new


def build_college(path, out_dir):
    """Convert a waveform-builder student page into a standalone college page."""
    page = read(path)
    base = os.path.dirname(os.path.abspath(path))
    asset = lambda name: read(os.path.normpath(os.path.join(base, '../../../../assets', name)))

    title = re.search(r'<title>.*?</title>', page, re.S).group(0)
    page_css = '\n'.join(re.findall(r'<style>(.*?)</style>', page, re.S))
    theme_css = read(os.path.join(HERE, 'college', 'theme.css'))
    theme_js = read(os.path.join(HERE, 'college', 'theme-toggle.js'))
    shapes = trim_shapes(asset('shapes.js'), page) if 'shapes.js' in page else ''

    body = page[page.index('<body'):page.rindex('</body>')]
    body = re.sub(r'<div class="crumb"[^>]*></div>\s*', '', body)
    body = re.sub(r'<footer>.*?</footer>\s*', '', body, flags=re.S)
    body = sub_once(r'<div class="progress-wrap"[^>]*>.*?</div>\s*', '', body, 'the progress bar / "← Back" link', path=path)
    body = sub_once(r'<div class="quiz-wrap single-col" id="quizWrap">\s*<div class="questions-col">\s*',
                    '<div class="main-wrap">\n    ' + TOP_BAR + '\n    ', body, 'the .quiz-wrap / .questions-col wrapper', path=path)
    body = sub_once(r'\s*</div>\s*</div>((?:\s*<!--.*?-->)*\s*<div id="printWorksheet")', r'\n  </div>\1', body, 'the end of the wrapper before #printWorksheet', path=path)
    body = re.sub(r'btn btn-(?:shuffle|summary)', 'btn btn-secondary', body)
    body = body.replace('class="btn" id="printBtn"', 'class="btn btn-secondary" id="printBtn"')

    # the page's own script (the last inline one): drop the student-only breadcrumb "← Back" code
    scripts = list(re.finditer(r'<script>(.*?)</script>', body, re.S))
    last = scripts[-1]
    js = re.sub(r"\n\s*if \(history\.length > 1\) \{[^}]*menuLink[^}]*\}\s*\n\s*function goBack\(e\)[^\n]*\n", '\n', last.group(1))
    body = body[:last.start()] + inline_js(theme_js) + '\n  <script>' + js + '</script>' + body[last.end():]

    head = ('<!DOCTYPE html>\n<html lang="en">\n\n<head>\n  <meta charset="UTF-8">\n'
            '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            f'  {title}\n  {COLLEGE_FONTS}\n  <link rel="icon" href="data:,">\n'
            f'  <style>\n{page_css}\n{theme_css}\n  </style>\n')
    if shapes:
        head += '  ' + inline_js(shapes) + '\n'
    head += '  ' + inline_js(asset('waveform-builder.js')) + '\n</head>\n\n'
    out_html = head + body.rstrip() + '\n  ' + COPYRIGHT + '\n</body>\n\n</html>\n'

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, os.path.basename(path)[:-5] + '_college.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(out_html)
    return out


def bundle(path, out_dir):
    """Inline every local stylesheet and script as it is (site styling, not the college theme)."""
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
        return inline_js(js)

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


def build(path, out_dir):
    if 'waveform-builder.js' in read(path):
        return build_college(path, out_dir)
    return bundle(path, out_dir)


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
