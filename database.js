import { el, toast, confirmDialog } from '../ui-helpers.js';
import * as db from '../db.js';

export async function renderDatabaseScreen(navigate) {
  const allPatients = await db.getAllPatients();
  allPatients.sort((a, b) => new Date(b.Date_Added || 0) - new Date(a.Date_Added || 0));

  const screen = el('div', { class: 'screen' });
  screen.append(
    el('div', { class: 'screen-header' }, [
      el('div', {}, [el('h1', {}, 'Patient Database'), el('div', { class: 'desc' }, `${allPatients.length} patient${allPatients.length === 1 ? '' : 's'} in the dataset`)]),
      el('button', { class: 'primary', onclick: () => navigate('import') }, '+ Import Questionnaire'),
    ]),
  );

  const filters = el('div', { class: 'card', style: 'display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;' });
  const searchInput = el('input', { type: 'text', placeholder: 'Search Study ID or phone…', style: 'max-width:220px;' });
  const techSelect = el('select', { style: 'max-width:160px;' }, [
    el('option', { value: '' }, 'All techniques'),
    el('option', { value: 'Coblation' }, 'Coblation'),
    el('option', { value: 'Cold Steel' }, 'Cold Steel'),
  ]);
  const genderSelect = el('select', { style: 'max-width:140px;' }, [
    el('option', { value: '' }, 'All genders'),
    el('option', { value: 'Male' }, 'Male'),
    el('option', { value: 'Female' }, 'Female'),
  ]);
  const ageMin = el('input', { type: 'number', placeholder: 'Min age', style: 'max-width:100px;' });
  const ageMax = el('input', { type: 'number', placeholder: 'Max age', style: 'max-width:100px;' });
  filters.append(
    labeled('Search', searchInput), labeled('Technique', techSelect), labeled('Gender', genderSelect),
    labeled('Age from', ageMin), labeled('Age to', ageMax),
  );
  screen.appendChild(filters);

  const tableCard = el('div', { class: 'card', style: 'margin-top:14px;' });
  const tableScroll = el('div', { class: 'table-scroll' });
  tableCard.appendChild(tableScroll);
  screen.appendChild(tableCard);

  function applyFilters() {
    const q = searchInput.value.trim().toLowerCase();
    const tech = techSelect.value;
    const gender = genderSelect.value;
    const min = ageMin.value ? Number(ageMin.value) : null;
    const max = ageMax.value ? Number(ageMax.value) : null;

    return allPatients.filter(p => {
      if (q && !(String(p.Study_ID || '').toLowerCase().includes(q) || String(p.Phone_Number || '').toLowerCase().includes(q))) return false;
      if (tech && p.Surgical_Technique !== tech) return false;
      if (gender && p.Gender !== gender) return false;
      if (min !== null && (p.Age ?? -Infinity) < min) return false;
      if (max !== null && (p.Age ?? Infinity) > max) return false;
      return true;
    });
  }

  function renderTable() {
    const rows = applyFilters();
    tableScroll.innerHTML = '';
    if (rows.length === 0) {
      tableScroll.appendChild(el('div', { class: 'empty-state' }, [
        el('h3', {}, 'No matching patients'),
        el('p', {}, allPatients.length === 0 ? 'Import your first questionnaire to get started.' : 'Try adjusting the filters above.'),
      ]));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      'Study ID', 'Age', 'Gender', 'Technique', 'Est. Blood Loss', 'Op Time', 'Confidence', 'Added', '',
    ].map(h => el('th', {}, h)))));
    const tbody = el('tbody');
    for (const p of rows) {
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'mono', style: 'font-weight:600;' }, p.Study_ID),
        el('td', { class: 'mono' }, p.Age ?? '—'),
        el('td', {}, p.Gender || '—'),
        el('td', {}, p.Surgical_Technique ? el('span', { class: `badge technique-${p.Surgical_Technique === 'Coblation' ? 'coblation' : 'cold-steel'}` }, p.Surgical_Technique) : '—'),
        el('td', { class: 'mono' }, p.Estimated_Blood_Loss_mL != null ? `${p.Estimated_Blood_Loss_mL} mL` : '—'),
        el('td', { class: 'mono' }, p.Operative_Time_Min != null ? `${p.Operative_Time_Min} min` : '—'),
        el('td', { class: 'mono' }, p.Extraction_Confidence != null ? `${p.Extraction_Confidence}%` : '—'),
        el('td', { class: 'hint' }, p.Date_Added ? new Date(p.Date_Added).toLocaleDateString() : '—'),
        el('td', { style: 'display:flex; gap:6px;' }, [
          el('button', { class: 'ghost', onclick: () => navigate('review', { studyId: p.Study_ID }) }, 'View'),
          el('button', { class: 'ghost', title: 'Delete this patient', onclick: () => handleDelete(p) }, '🗑'),
        ]),
      ]));
    }
    table.appendChild(tbody);
    tableScroll.appendChild(table);
  }

  async function handleDelete(patient) {
    const ok = await confirmDialog({
      title: `Delete patient ${patient.Study_ID}?`,
      body: 'A backup snapshot is taken automatically first, so this can be recovered from Excel Management → Backups if needed. This removes the record from the live dataset.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    const all = await db.getAllPatients();
    await db.snapshotBackup(all, `before-delete-${patient.Study_ID}`);
    await db.deletePatient(patient.Study_ID);
    toast(`Patient ${patient.Study_ID} deleted (backup saved).`);
    navigate('database');
  }

  [searchInput, techSelect, genderSelect, ageMin, ageMax].forEach(input => {
    input.addEventListener('input', renderTable);
    input.addEventListener('change', renderTable);
  });

  renderTable();
  return screen;
}

function labeled(labelText, input) {
  return el('div', {}, [el('label', {}, labelText), input]);
}
