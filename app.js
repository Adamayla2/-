import { renderDashboardScreen } from './screens/dashboard.js';
import { renderImportScreen } from './screens/import.js';
import { renderReviewScreen } from './screens/review.js';
import { renderDatabaseScreen } from './screens/database.js';
import { renderExcelScreen } from './screens/excel-manage.js';
import { renderSettingsScreen } from './screens/settings.js';

const ROUTES = {
  dashboard: renderDashboardScreen,
  import: renderImportScreen,
  review: renderReviewScreen,
  database: renderDatabaseScreen,
  excel: renderExcelScreen,
  settings: renderSettingsScreen,
};

const main = document.getElementById('main-content');
let renderToken = 0;

export async function navigate(route, params = {}) {
  if (!ROUTES[route]) route = 'dashboard';
  document.querySelectorAll('.rail-link').forEach(btn => btn.classList.toggle('active', btn.dataset.route === route));

  const token = ++renderToken;
  main.innerHTML = '<div class="screen" style="padding:40px; text-align:center; color:var(--ink-muted);">Loading\u2026</div>';
  try {
    const node = await ROUTES[route](navigate, params);
    if (token !== renderToken) return; // a newer navigation started while this one was loading
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  } catch (e) {
    if (token !== renderToken) return;
    console.error(e);
    main.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'card';
    errBox.style.borderColor = 'var(--conf-low)';
    errBox.innerHTML = `<h2 style="color:var(--conf-low);">Something went wrong loading this screen</h2><p class="hint">${escapeHtml(e.message || String(e))}</p>`;
    main.appendChild(errBox);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

document.getElementById('rail-nav').addEventListener('click', e => {
  const btn = e.target.closest('.rail-link');
  if (btn) navigate(btn.dataset.route);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {/* offline shell is a nice-to-have, not required */});
  });
}

navigate('dashboard');
