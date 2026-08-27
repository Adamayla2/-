import { el, toast, confirmDialog } from '../ui-helpers.js';
import { EXCEL_COLUMNS } from '../schema.js';
import { readWorkbook, suggestColumnMapping, applyColumnMapping, buildWorkbookBlob, downloadBlob, timestampedFilename } from '../excel.js';
import * as db from '../db.js';

export async function renderExcelScreen(navigate) {
  const screen = el('div', { class: 'screen' });
  screen.append(el('div', { class: 'screen-header' }, [
    el('div', {}, [el('h1', {}, 'Excel Management'), el('div', { class: 'desc' }, 'Import an existing dataset, export the current one, or restore from a backup.')]),
  ]));

  // ---- Import -----------------------------------------------------------
  const importCard = el('div', { class: 'card' }, [
    el('h2', {}, 'Import Existing Excel'),
    el('p', { class: 'hint' }, 'Supports .xlsx, .xls, .csv. Column names don\u2019t need to match exactly \u2014 you\u2019ll confirm the mapping before anything is imported. New Study IDs are added; Study IDs that already exist in your dataset are skipped, never overwritten.'),
  ]);
  const importFileInput = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
  importFileInput.addEventListener('change', () => handleImportFile(importFileInput.files[0]));
  importCard.appendChild(importFileInput);
  const mappingHost = el('div', { style: 'margin-top:14px;' });
  importCard.appendChild(mappingHost);
  screen.appendChild(importCard);

  // ---- Export -------------------------------------------------------------
  const patients = await db.getAllPatients();
  const settings = await db.getSettings();
  const exportCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [
    el('h2', {}, 'Export Current Dataset'),
    el('p', { class: 'hint' }, `${patients.length} patient${patients.length === 1 ? '' : 's'} currently in the local dataset.`),
  ]);
  const autoExportToggle = el('input', { type: 'checkbox' });
  autoExportToggle.checked = !!settings.autoExportXlsx;
  autoExportToggle.addEventListener('change', () => db.setSetting('autoExportXlsx', autoExportToggle.checked));
  exportCard.append(
    el('div', { style: 'display:flex; gap:8px; margin-top:8px;' }, [
      el('button', { class: 'primary', onclick: exportNow }, 'Download .xlsx'),
    ]),
    el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:12px; font-size:12px; color:var(--ink-muted);' }, [
      autoExportToggle, 'Also auto-download a fresh .xlsx every time a patient is confirmed (off by default \u2014 otherwise processing hundreds of patients means hundreds of downloaded files).',
    ]),
  );
  screen.appendChild(exportCard);

  // ---- Backups --------------------------------------------------------
  const backups = await db.getBackups();
  const backupsCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [
    el('h2', {}, 'Backups'),
    el('p', { class: 'hint' }, 'A snapshot is taken automatically before every add, update, delete, or import. Most recent 30 are kept.'),
  ]);
  if (backups.length === 0) {
    backupsCard.appendChild(el('p', { class: 'hint' }, 'No backups yet.'));
  } else {
    const list = el('div', { style: 'margin-top:10px; display:flex; flex-direction:column; gap:6px; max-height:260px; overflow:auto;' });
    [...backups].reverse().forEach(b => {
      list.appendChild(el('div', { style: 'display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid var(--line); border-radius:4px;' }, [
        el('div', {}, [
          el('div', { style: 'font-size:13px;' }, b.label || 'snapshot'),
          el('div', { class: 'hint' }, `${new Date(b.createdAt).toLocaleString()} \u00b7 ${b.rows.length} rows`),
        ]),
        el('div', { style: 'display:flex; gap:6px;' }, [
          el('button', { class: 'ghost', onclick: () => downloadBlob(buildWorkbookBlob(b.rows), `backup_${b.id}.xlsx`) }, 'Download'),
          el('button', { class: 'ghost', onclick: () => handleRestore(b) }, 'Restore'),
        ]),
      ]));
    });
    backupsCard.appendChild(list);
  }
  screen.appendChild(backupsCard);

  return screen;

  // -----------------------------------------------------------------------
  async function exportNow() {
    const all = await db.getAllPatients();
    downloadBlob(buildWorkbookBlob(all), timestampedFilename('patients'));
    toast(`Exported ${all.length} patients.`);
  }

  async function handleImportFile(file) {
    if (!file) return;
    mappingHost.innerHTML = '';
    let parsed;
    try {
      parsed = await readWorkbook(file);
    } catch (e) {
      toast(`Couldn\u2019t read ${file.name}: ${e.message}`, { error: true });
      return;
    }
    if (parsed.rows.length === 0) {
      toast('That file has no data rows.', { error: true });
      return;
    }

    const lastMapping = await db.getLastColumnMapping();
    const remembered = lastMapping && sameHeaders(lastMapping.sourceHeaders, parsed.headers) ? lastMapping.mapping : null;
    const suggestion = remembered || suggestColumnMapping(parsed.headers);

    mappingHost.appendChild(renderMappingUI(parsed, suggestion));
  }

  function renderMappingUI(parsed, suggestion) {
    const wrap = el('div', {});
    wrap.appendChild(el('h3', {}, `Confirm Column Mapping — ${parsed.rows.length} rows found`));
    const rowsHost = el('div', {});
    const currentMapping = { ...suggestion };

    for (const header of parsed.headers) {
      const row = el('div', { class: 'mapping-row' + (currentMapping[header] ? '' : ' unmapped') });
      const select = el('select', {});
      select.appendChild(el('option', { value: '' }, '\u2014 do not import this column \u2014'));
      for (const col of EXCEL_COLUMNS) {
        const o = el('option', { value: col }, col);
        if (currentMapping[header] === col) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener('change', () => {
        currentMapping[header] = select.value || null;
        row.classList.toggle('unmapped', !select.value);
      });
      row.append(el('div', { class: 'mono' }, header), el('span', { class: 'arrow' }, '\u2192'), select);
      rowsHost.appendChild(row);
    }
    wrap.appendChild(rowsHost);

    const actions = el('div', { style: 'display:flex; gap:8px; margin-top:14px;' }, [
      el('button', { class: 'primary', onclick: () => confirmImport(parsed, currentMapping, wrap) }, 'Confirm Mapping & Import'),
      el('button', { class: 'ghost', onclick: () => { mappingHost.innerHTML = ''; } }, 'Cancel'),
    ]);
    wrap.appendChild(actions);
    return wrap;
  }

  async function confirmImport(parsed, mapping, mappingNode) {
    await db.saveColumnMapping(parsed.headers, mapping);
    const mappedRows = applyColumnMapping(parsed.rows, mapping);

    const existing = await db.getAllPatients();
    await db.snapshotBackup(existing, `before-import-${parsed.sheetName || 'excel'}`);
    const { added, skipped } = await db.bulkImportNewOnly(mappedRows);

    mappingNode.innerHTML = '';
    mappingNode.appendChild(el('div', { class: 'card', style: 'background:var(--conf-high-bg); border-color:transparent;' }, [
      el('div', { style: 'font-weight:600; color:var(--conf-high);' }, `Imported ${added.length} new patient${added.length === 1 ? '' : 's'}.`),
      skipped.length ? el('div', { class: 'hint', style: 'margin-top:6px;' }, `${skipped.length} row(s) skipped (duplicate or missing Study ID) \u2014 not overwritten. Review them in Patient Database if needed.`) : null,
    ]));
    toast(`Import complete: ${added.length} added, ${skipped.length} skipped.`);
  }

  async function handleRestore(backup) {
    const ok = await confirmDialog({
      title: `Restore from ${new Date(backup.createdAt).toLocaleString()}?`,
      body: `This replaces your ENTIRE current dataset (${patients.length} patients) with this backup's ${backup.rows.length} patients. Your current data is snapshotted first, so this is itself reversible, but please make sure this is what you want.`,
      confirmLabel: 'Restore', danger: true,
    });
    if (!ok) return;
    const current = await db.getAllPatients();
    await db.snapshotBackup(current, 'before-restore');
    await db.clearAndReplacePatients(backup.rows);
    toast(`Restored ${backup.rows.length} patients.`);
    navigate('dashboard');
  }
}

function sameHeaders(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((h, i) => h === b[i]);
}
