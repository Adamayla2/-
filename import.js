import { el, toast } from '../ui-helpers.js';
import { pdfFileToImageFiles } from '../pdf-render.js';
import { getSettings } from '../db.js';

/**
 * Batch queue item shape:
 * { id, label, page1: File|null, page2: File|null, status: 'queued'|'extracting'|'ready'|'needs_review'|'error', error? }
 * Kept in module-level state so navigating away and back doesn't lose the
 * queue (until the user actually reloads the page).
 */
export const importState = {
  queue: [],
};

export function renderImportScreen(navigate) {
  const screen = el('div', { class: 'screen' });
  screen.append(
    el('div', { class: 'screen-header' }, [
      el('div', {}, [
        el('h1', {}, 'Import Questionnaire'),
        el('div', { class: 'desc' }, 'Upload photos, scans, or PDFs of completed paper forms. One or two pages per patient.'),
      ]),
    ])
  );

  const dropzone = el('div', { class: 'dropzone' }, [
    el('p', {}, [el('strong', {}, 'Drag & drop images or PDFs here')]),
    el('p', { class: 'hint' }, 'JPG, PNG, WEBP, or PDF · one image, multiple images, or a two-page form · multiple patients at once'),
    el('div', { style: 'margin-top:12px; display:flex; gap:8px; justify-content:center;' }, [
      el('button', { class: 'primary', onclick: () => fileInput.click() }, 'Choose Files'),
    ]),
  ]);
  const fileInput = el('input', { type: 'file', accept: 'image/*,.pdf', multiple: 'true', class: 'visually-hidden', onchange: e => handleFiles(e.target.files) });
  dropzone.appendChild(fileInput);

  ['dragover', 'dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.toggle('dragover', evt === 'dragover');
      if (evt === 'drop') handleFiles(e.dataTransfer.files);
    });
  });

  const queueCard = el('div', { class: 'card' }, [
    el('h2', {}, 'Batch Queue'),
    el('p', { class: 'hint' }, 'Files are grouped automatically by filename (e.g. Patient_001_page1.jpg + Patient_001_page2.jpg). Fix any grouping below before extracting — nothing is sent for extraction until you press Extract.'),
  ]);
  const queueList = el('div', { id: 'queue-list', style: 'margin-top:12px;' });
  queueCard.appendChild(queueList);

  const actionsRow = el('div', { style: 'display:flex; gap:8px; margin-top:14px;' }, [
    el('button', { class: 'primary', onclick: () => extractAll(navigate) }, 'Extract All Queued'),
    el('button', { class: 'ghost', onclick: () => { importState.queue = []; renderQueue(); } }, 'Clear Queue'),
  ]);
  queueCard.appendChild(actionsRow);

  screen.append(dropzone, queueCard);
  renderQueue();
  return screen;

  // -- local functions -------------------------------------------------
  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const pages = await pdfFileToImageFiles(file);
          addFilesAsPatients(pages, file.name);
        } catch (e) {
          toast(`Couldn't render ${file.name}: ${e.message}`, { error: true });
        }
      } else {
        addFilesAsPatients([file], file.name);
      }
    }
    renderQueue();
  }

  function addFilesAsPatients(files, originalName) {
    // Group by a filename prefix (strip _page1/_p1/_pg2/etc + extension) so
    // "Patient_001_page1.jpg" and "Patient_001_page2.jpg" land in the same
    // queue item automatically. Anything that doesn't match a pair pattern
    // becomes its own single-page item that the user can merge manually.
    for (const file of files) {
      const stem = file.name.replace(/\.(jpe?g|png|webp)$/i, '');
      const m = stem.match(/^(.*?)[_\-\s]?(?:page|pg|p)[_\-\s]?([12])$/i);
      const groupKey = m ? m[1] : stem;
      const pageNum = m ? Number(m[2]) : null;

      let item = importState.queue.find(q => q.groupKey === groupKey && q.status === 'queued');
      if (!item) {
        item = { id: crypto.randomUUID(), groupKey, label: groupKey, page1: null, page2: null, status: 'queued' };
        importState.queue.push(item);
      }
      if (pageNum === 2 || (pageNum === null && item.page1)) item.page2 = file;
      else item.page1 = file;
    }
  }

  function renderQueue() {
    queueList.innerHTML = '';
    if (importState.queue.length === 0) {
      queueList.appendChild(el('p', { class: 'hint' }, 'No files queued yet.'));
      return;
    }
    importState.queue.forEach((item, idx) => queueList.appendChild(renderQueueItem(item, idx)));
  }

  function renderQueueItem(item) {
    const thumbs = el('div', { class: 'thumbs' });
    if (item.page1) thumbs.appendChild(el('img', { src: URL.createObjectURL(item.page1), alt: 'Page 1' }));
    if (item.page2) thumbs.appendChild(el('img', { src: URL.createObjectURL(item.page2), alt: 'Page 2' }));

    const statusColors = {
      queued: 'background:var(--surface-sunken); color:var(--ink-muted);',
      extracting: 'background:var(--conf-medium-bg); color:var(--conf-medium);',
      ready: 'background:var(--conf-high-bg); color:var(--conf-high);',
      needs_review: 'background:var(--conf-low-bg); color:var(--conf-low);',
      error: 'background:var(--conf-low-bg); color:var(--conf-low);',
    };
    const statusLabel = {
      queued: 'Queued', extracting: 'Extracting…', ready: 'Extracted — Ready',
      needs_review: 'Extracted — Needs Review', error: 'Error',
    };

    const row = el('div', { class: 'queue-item' }, [
      thumbs,
      el('div', { class: 'info' }, [
        el('div', { style: 'font-weight:500;' }, item.label + (item.page2 ? ' (2 pages)' : ' (1 page)')),
        item.error ? el('div', { class: 'hint', style: 'color:var(--conf-low);' }, item.error) : null,
      ]),
      el('span', { class: 'status-tag', style: statusColors[item.status] }, statusLabel[item.status]),
    ]);

    const btnRow = el('div', { style: 'display:flex; gap:6px;' });
    if (item.status === 'ready' || item.status === 'needs_review') {
      btnRow.appendChild(el('button', { class: 'primary', onclick: () => navigate('review', { itemId: item.id }) }, 'Review'));
    }
    if (!item.page2) {
      btnRow.appendChild(el('button', { class: 'ghost', title: 'Attach a second page to this patient', onclick: () => attachSecondPage(item) }, '+ Page 2'));
    }
    btnRow.appendChild(el('button', { class: 'ghost', onclick: () => { importState.queue = importState.queue.filter(q => q.id !== item.id); renderQueue(); } }, 'Remove'));
    row.appendChild(btnRow);
    return row;
  }

  function attachSecondPage(item) {
    const input = el('input', { type: 'file', accept: 'image/*,.pdf', class: 'visually-hidden' });
    input.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.type === 'application/pdf') {
        const pages = await pdfFileToImageFiles(f);
        item.page2 = pages[0];
      } else {
        item.page2 = f;
      }
      renderQueue();
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  async function extractAll(navigateFn) {
    const settings = await getSettings();
    if (!settings.apiKey) {
      toast('Add your Anthropic API key in Settings before extracting.', { error: true });
      navigateFn('settings');
      return;
    }
    const pending = importState.queue.filter(q => q.status === 'queued');
    if (pending.length === 0) { toast('Nothing queued to extract.'); return; }

    for (const item of pending) {
      item.status = 'extracting';
      renderQueue();
      try {
        const { runExtractionForQueueItem } = await import('./review.js');
        await runExtractionForQueueItem(item, settings);
        const anyUncertain = Object.values(item.result.fields).some(f => f.status === 'uncertain');
        item.status = anyUncertain ? 'needs_review' : 'ready';
      } catch (e) {
        item.status = 'error';
        item.error = describeExtractionError(e);
      }
      renderQueue();
    }
    const firstReady = importState.queue.find(q => q.status === 'ready' || q.status === 'needs_review');
    if (firstReady) navigateFn('review', { itemId: firstReady.id });
  }
}

export function describeExtractionError(e) {
  if (e.message === 'NO_API_KEY') return 'No API key configured.';
  if (e.message?.startsWith('API_ERROR_401')) return 'Anthropic rejected the API key (401). Check Settings.';
  if (e.message?.startsWith('API_ERROR_429')) return 'Rate limited — wait a moment and retry.';
  if (e.message?.startsWith('API_ERROR')) return `API error (${e.message}).`;
  if (e.message === 'UNPARSEABLE_JSON') return 'The model response could not be parsed. Try Re-analyze.';
  return e.message || 'Unknown error.';
}
