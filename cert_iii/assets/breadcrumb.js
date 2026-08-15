/* ══════════════════════════════════════════════════════════════════════
   Cert III — shared dynamic breadcrumb builder.

   Fills a <div class="crumb" id="crumb"></div> by reading the page's own
   file:// path, so the ancestor trail (Electronics / Cert III / ...) never
   has to be hand-written or kept in sync across pages.

   How it works: everything from "cert_iii/" onward in the path is split
   into folders. Each folder is looked up in LABELS below — folders not in
   the map (e.g. "lessons", "general") are structural only and skipped,
   they don't produce a crumb level, but still count for relative-path
   depth. If the current page IS a folder's own index.html, that folder's
   label becomes the final (unlinked) segment automatically. Otherwise
   (a quiz page, or any file not named index.html) the final segment can't
   be derived from the filename, so it must be supplied via
   data-current="..." on the #crumb div.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
    var LABELS = {
        cert_iii: 'Cert III',
        UEEEC0066: 'UEEEC0066',
        UEEEC0069: 'UEEEC0069',
        bjt: 'BJT'
    };

    function titleCase(s) {
        return s.replace(/[_-]+/g, ' ').replace(/\w\S*/g, function (t) {
            return t.charAt(0).toUpperCase() + t.slice(1);
        });
    }

    function build() {
        var el = document.getElementById('crumb');
        if (!el) return;

        var path = decodeURIComponent(location.pathname);
        var marker = 'cert_iii/';
        var idx = path.indexOf(marker);
        if (idx === -1) return;

        var segments = path.slice(idx).split('/');
        segments.pop(); // drop the filename itself
        var folders = segments; // e.g. ['cert_iii', 'UEEEC0066', 'bjt', 'npn']
        var depth = folders.length;
        var filename = decodeURIComponent(location.pathname).split('/').pop();
        var isIndexPage = (filename === 'index.html');

        var parts = [{ label: 'Electronics', ups: depth }];

        var ancestorCount = isIndexPage ? depth - 1 : depth;
        for (var i = 0; i < ancestorCount; i++) {
            var label = LABELS[folders[i]];
            if (!label) continue; // structural folder, not a crumb level
            parts.push({ label: label, ups: depth - (i + 1) });
        }

        var currentLabel = el.getAttribute('data-current');
        if (!currentLabel) {
            var lastFolder = folders[depth - 1];
            currentLabel = LABELS[lastFolder] || titleCase(lastFolder);
        }

        var html = parts.map(function (p) {
            var href = (p.ups > 0 ? new Array(p.ups + 1).join('../') : '') + 'index.html';
            return '<a href="' + href + '">' + p.label + '</a>';
        }).join(' / ');

        html += (html ? ' / ' : '') + '<span>' + currentLabel + '</span>';
        el.innerHTML = html;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
