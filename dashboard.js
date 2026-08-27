import { el } from '../ui-helpers.js';
import * as db from '../db.js';
import { importState } from './import.js';

export async function renderDashboardScreen(navigate) {
  const patients = await db.getAllPatients();
  const settings = await db.getSettings();
  const threshold = settings.confidenceThreshold ?? 90;

  const coblation = patients.filter(p => p.Surgical_Technique === 'Coblation').length;
  const coldSteel = patients.filter(p => p.Surgical_Technique === 'Cold Steel').length;
  const needingReview = patients.filter(p => (p.Extraction_Confidence ?? 100) < threshold).length;
  const last = [...patients].sort((a, b) => new Date(b.Date_Added || 0) - new Date(a.Date_Added || 0))[0];
  const pendingInQueue = importState.queue.filter(q => q.status === 'ready' || q.status === 'needs_review').length;

  const screen = el('div', { class: 'screen' });
  screen.append(
    el('div', { class: 'screen-header' }, [
      el('div', {}, [
        el('h1', {}, 'Dashboard'),
        el('div', { class: 'desc' }, 'Coblation vs Cold Steel tonsillectomy outcomes study'),
      ]),
      el('button', { class: 'primary', onclick: () => navigate('import') }, '+ Import Questionnaire'),
    ]),
  );

  const statGrid = el('div', { class: 'grid grid-4' }, [
    statCard('Total Patients', patients.length),
    statCard('Coblation', coblation),
    statCard('Cold Steel', coldSteel),
    statCard('Need Review', needingReview, needingReview > 0 ? 'var(--conf-medium)' : undefined),
  ]);
  screen.appendChild(statGrid);

  if (pendingInQueue > 0) {
    screen.appendChild(el('div', { class: 'card', style: 'margin-top:14px; display:flex; justify-content:space-between; align-items:center;' }, [
      el('div', {}, [
        el('div', { style: 'font-weight:600;' }, `${pendingInQueue} extracted questionnaire${pendingInQueue > 1 ? 's' : ''} waiting for review`),
        el('div', { class: 'hint' }, 'Not yet added to the dataset.'),
      ]),
      el('button', { class: 'primary', onclick: () => navigate('import') }, 'Review Now'),
    ]));
  }

  const bottomGrid = el('div', { class: 'grid grid-2', style: 'margin-top:14px;' });
  bottomGrid.append(
    el('div', { class: 'card' }, [
      el('h2', {}, 'Last Imported Patient'),
      last
        ? el('div', {}, [
            el('div', { class: 'mono', style: 'font-size:16px; font-weight:600;' }, last.Study_ID),
            el('div', { class: 'hint' }, `${last.Surgical_Technique || '—'} · Age ${last.Age ?? '—'} · Added ${last.Date_Added ? new Date(last.Date_Added).toLocaleString() : '—'}`),
            el('button', { class: 'ghost', style: 'margin-top:10px;', onclick: () => navigate('review', { studyId: last.Study_ID }) }, 'View / Edit'),
          ])
        : el('p', { class: 'hint' }, 'No patients added yet.'),
    ]),
    el('div', { class: 'card' }, [
      el('h2', {}, 'Quick Actions'),
      el('div', { style: 'display:flex; flex-direction:column; gap:8px; margin-top:8px;' }, [
        el('button', { onclick: () => navigate('database') }, 'Search Patient Database'),
        el('button', { onclick: () => navigate('excel') }, 'Import / Export Excel'),
        el('button', { onclick: () => navigate('settings') }, 'Settings & API Key'),
      ]),
    ]),
  );
  screen.appendChild(bottomGrid);

  return screen;
}

function statCard(label, value, color) {
  return el('div', { class: 'card stat-card' }, [
    el('div', { class: 'value', style: color ? `color:${color};` : '' }, String(value)),
    el('div', { class: 'label' }, label),
  ]);
}
