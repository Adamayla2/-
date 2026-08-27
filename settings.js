import { el, toast, confirmDialog } from '../ui-helpers.js';
import * as db from '../db.js';

export async function renderSettingsScreen(navigate) {
  const settings = await db.getSettings();
  const patients = await db.getAllPatients();
  const audit = await db.getAuditLog();
  const backups = await db.getBackups();
  const lastMapping = await db.getLastColumnMapping();

  const screen = el('div', { class: 'screen' });
  screen.appendChild(el('div', { class: 'screen-header' }, [el('h1', {}, 'Settings')]));

  // ---- API configuration -------------------------------------------
  const apiCard = el('div', { class: 'card' }, [el('h2', {}, 'AI Extraction — Anthropic API')]);
  const keyInput = el('input', { type: 'password', value: settings.apiKey || '', placeholder: 'sk-ant-...' });
  const showKeyBtn = el('button', { class: 'ghost', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } }, 'Show/Hide');
  const modelSelect = el('select', {}, [
    el('option', { value: 'claude-sonnet-5' }, 'Claude Sonnet 5 — recommended (balanced accuracy & cost)'),
    el('option', { value: 'claude-opus-5' }, 'Claude Opus 5 — highest accuracy, slower/costlier'),
    el('option', { value: 'claude-haiku-4-5-20251001' }, 'Claude Haiku 4.5 — fastest & cheapest'),
  ]);
  modelSelect.value = settings.extractionModel || 'claude-sonnet-5';

  apiCard.append(
    el('label', {}, 'API Key'),
    el('div', { style: 'display:flex; gap:8px;' }, [keyInput, showKeyBtn]),
    el('p', { class: 'hint', style: 'margin-top:6px;' }, [
      'Get a key at ', el('a', { href: 'https://console.anthropic.com', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'),
      '. Stored only in this browser\u2019s local database \u2014 it is sent with every extraction request directly to api.anthropic.com and nowhere else. See the note below about what this means.',
    ]),
    el('label', { style: 'margin-top:14px;' }, 'Extraction model'),
    modelSelect,
    el('div', { style: 'margin-top:14px;' }, [
      el('button', { class: 'primary', onclick: saveApiSettings }, 'Save'),
    ]),
    el('details', { style: 'margin-top:14px; font-size:12px; color:var(--ink-muted);' }, [
      el('summary', { style: 'cursor:pointer;' }, 'Why is the key stored in the browser? Is that safe?'),
      el('p', { style: 'margin-top:8px;' }, 'This app has no server of its own \u2014 that\u2019s deliberate, so nothing about your patients ever passes through a third-party backend. The tradeoff is that the browser needs your key to call Anthropic directly. On a device only you use, this is a normal and accepted pattern for personal tools. Do not deploy this build to a shared or public URL with your key saved in it.'),
    ]),
  );
  screen.appendChild(apiCard);

  // ---- Extraction & review --------------------------------------------
  const reviewCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [el('h2', {}, 'Extraction & Review')]);
  const thresholdInput = el('input', { type: 'number', min: '0', max: '100', value: settings.confidenceThreshold ?? 90 });
  const deleteImagesToggle = el('input', { type: 'checkbox' });
  deleteImagesToggle.checked = settings.deleteImagesAfterExtraction !== false;
  reviewCard.append(
    el('label', {}, 'Confidence threshold for "needs review" (%)'),
    thresholdInput,
    el('p', { class: 'hint' }, 'Extracted fields below this confidence are highlighted for manual review, in addition to anything the AI itself marked uncertain.'),
    el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:14px; font-size:13px; color:var(--ink);' }, [
      deleteImagesToggle, 'Delete uploaded images after extraction (recommended \u2014 default on)',
    ]),
    el('button', { class: 'primary', style: 'margin-top:14px;', onclick: saveReviewSettings }, 'Save'),
  );
  screen.appendChild(reviewCard);

  // ---- Excel mapping memory --------------------------------------------
  const mappingCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [
    el('h2', {}, 'Remembered Excel Column Mapping'),
    lastMapping
      ? el('div', {}, [
          el('p', { class: 'hint' }, `Saved ${new Date(lastMapping.savedAt).toLocaleString()} for a file with ${lastMapping.sourceHeaders.length} columns.`),
          el('button', { class: 'ghost', onclick: () => toast('Column mappings are managed automatically when you import a matching file again from Excel Management.') }, 'View in Excel Management'),
        ])
      : el('p', { class: 'hint' }, 'None yet \u2014 set one the first time you import an existing Excel file.'),
  ]);
  screen.appendChild(mappingCard);

  // ---- Data & privacy ----------------------------------------------
  const dataCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [
    el('h2', {}, 'Local Data'),
    el('p', { class: 'hint' }, `${patients.length} patients \u00b7 ${audit.length} audit log entries \u00b7 ${backups.length} backup snapshots \u2014 all stored on this device only.`),
    el('div', { style: 'display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;' }, [
      el('button', { onclick: () => navigate('excel') }, 'Go to Excel Management'),
      el('button', { class: 'danger', onclick: handleClearAll }, 'Erase All Local Data'),
    ]),
  ]);
  screen.appendChild(dataCard);

  return screen;

  async function saveApiSettings() {
    await db.setSetting('apiKey', keyInput.value.trim());
    await db.setSetting('extractionModel', modelSelect.value);
    toast('API settings saved.');
  }
  async function saveReviewSettings() {
    const v = Math.max(0, Math.min(100, Number(thresholdInput.value) || 90));
    await db.setSetting('confidenceThreshold', v);
    await db.setSetting('deleteImagesAfterExtraction', deleteImagesToggle.checked);
    toast('Preferences saved.');
  }
  async function handleClearAll() {
    const first = await confirmDialog({
      title: 'Erase all local data?',
      body: `This permanently deletes all ${patients.length} patients, the audit log, and all ${backups.length} backups from this browser. Export a copy first if you want to keep anything. This cannot be undone.`,
      confirmLabel: 'Erase Everything', danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Are you absolutely sure?',
      body: 'There is no backup of a backup. Type nothing needed \u2014 just confirm once more.',
      confirmLabel: 'Yes, erase permanently', danger: true,
    });
    if (!second) return;
    await db.eraseAllData();
    toast('All local data erased.');
    navigate('dashboard');
  }
}
