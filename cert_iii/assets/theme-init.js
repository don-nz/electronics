/* ══════════════════════════════════════════════════════════════════════
   Cert III — shared light/dark theme toggle.

   Runs INLINE (not defer) and as early in <head> as possible — the first
   part below reads the saved preference and sets data-theme on <html>
   before the page paints, so there is no flash of the wrong theme.

   The toggle button itself is injected at runtime (as a fixed-position
   element, not tied to any per-page markup) so adding the toggle to a page
   is just one <script src="…/assets/theme-init.js"></script> tag — no HTML
   changes needed. Every page already loads quiz-common.css or
   nav-common.css, both of which define the .theme-toggle/.theme-toggle-icon-*
   rules this button uses.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
    var KEY = 'cert3-theme';

    if (localStorage.getItem(KEY) === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }

    window.toggleTheme = function () {
        var isLight = document.documentElement.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem(KEY, 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem(KEY, 'light');
        }
    };

    function injectButton() {
        if (document.querySelector('.theme-toggle')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-toggle';
        btn.title = 'Toggle light/dark theme';
        btn.setAttribute('aria-label', 'Toggle light/dark theme');
        btn.onclick = window.toggleTheme;
        btn.innerHTML = '<span class="theme-toggle-icon-sun">☀</span><span class="theme-toggle-icon-moon">☾</span>';

        // Sit inline at the end of the breadcrumb row, matching the page's own
        // content width — not pinned to the viewport corner, which drifts far
        // from the breadcrumb text on wide screens.
        var crumb = document.getElementById('crumb');
        if (crumb && crumb.parentNode) {
            var row = document.createElement('div');
            row.className = 'crumb-row';
            crumb.parentNode.insertBefore(row, crumb);
            row.appendChild(crumb);
            row.appendChild(btn);
        } else {
            btn.classList.add('theme-toggle-fixed');
            document.body.appendChild(btn);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectButton);
    } else {
        injectButton();
    }
})();
