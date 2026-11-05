// Dark/light toggle for the college pages (the student pages use assets/theme-init.js instead).
// The preference is the same localStorage key the hand-made college pages used.
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('tafe-quiz-theme', isDark ? 'dark' : 'light');
  updateThemeToggleUI(isDark);
}

function updateThemeToggleUI(isDark) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon && label) {
    icon.textContent = isDark ? '☀️' : '🌙';
    label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  }
}

(function initTheme() {
  const isDark = localStorage.getItem('tafe-quiz-theme') === 'dark';
  document.body.classList.toggle('dark-theme', isDark);
  updateThemeToggleUI(isDark);
})();
