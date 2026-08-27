import { el, toast, openModal, confirmDialog, confidenceBadge, statusClass } from '../ui-helpers.js';
import { FIELDS, SECTIONS, EXTRACTABLE_FIELDS, fieldsBySection, getField, STATUS } from '../schema.js';
import { validateField, validateRecord, computeGauzeBloodLoss, computeEstimatedBloodLoss, computeHemorrhageNone } from '../validation.js';
import { extractQuestionnaire } from '../extraction.js';
import { loadImageFromFile, rotateToCanvas, autoContrast, canvasToFile } from '../preprocess.js';
import * as db from '../db.js';
import { importState, describeExtractionError } from './import.js';

// ---------------------------------------------------------------------------
// Extraction runner (called from import.js) — preprocesses then calls the API
// ---------------------------------------------------------------------------
export async function runExtractionForQueueItem(item, settings) {
  item.rotation = item.rotation || { page1: 0, page2: 0 };
  const filesToSend = [];
  for (const key of ['page1', 'page2']) {
    const rawFile = item[key];
    if (!rawFile) continue;
    const img = await loadImageFromFile(rawFile);
    const canvas = rotateToCanvas(img, item.rotation[key] || 0);
    autoContrast(canvas, 0, 12); // gentle default boost for faint pen/pencil marks
    filesToSend.push(await canvasToFile(canvas, rawFile.name, 'image/jpeg', 0.92));
  }
  const result = await extractQuestionnaire(filesToSend, settings.apiKey, settings.extractionModel);
  item.result = result;
  item.fieldsState = structuredClone(result.fields);
  item.extractedAt = new Date().toISOString();
  return result;
}

function fieldsFromSavedRecord(record) {
  const fields = {};
  for (const f of EXTRACTABLE_FIELDS) {
    fields[f.id] = { value: record[f.id] ?? null, status: STATUS.EXTRACTED, confidence: 100, note: '' };
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export async function renderReviewScreen(navigate, params = {}) {
  let item = null;

  if (params.itemId) {
    item = importState.queue.find(q => q.id === params.itemId);
    if (item && !item.fieldsState && item.result) item.fieldsState = structuredClone(item.result.fields);
  } else if (params.studyId) {
    const record = await db.getPatient(params.studyId);
    if (record) {
      const fields = fieldsFromSavedRecord(record);
      item = {
        id: 'saved-' + record.Study_ID, label: record.Study_ID,
        page1: null, page2: null, savedMode: true,
        result: { page_association_uncertain: false, page_association_note: '', fields: structuredClone(fields) },
        fieldsState: fields,
      };
    }
  }

  if (!item) {
    return el('div', { class: 'screen' }, [
      el('div', { class: 'empty-state' }, [
        el('h3', {}, 'No extraction selected'),
        el('p', {}, 'Upload a questionnaire to review, or open an existing patient from the database.'),
        el('button', { class: 'primary', onclick: () => navigate('import') }, 'Go to Import'),
      ]),
    ]);
  }
  if (!item.result) {
    return el('div', { class: 'screen' }, [
      el('div', { class: 'empty-state' }, [el('h3', {}, 'Not extracted yet'), el('p', {}, 'Go back to the import queue and extract this item first.')]),
    ]);
  }

  const refs = { rows: new Map(), badges: new Map(), inputs: new Map(), computed: new Map(), computedRow: new Map() };
  const settings = await db.getSettings();

  const screen = el('div', { class: 'screen' });

  // ---- header -------------------------------------------------------
  const header = el('div', { class: 'review-toolbar' });
  const studyIdVal = item.fieldsState.Study_ID?.value || '(no Study ID read)';
  header.append(
    el('div', {}, [
      el('h1', {}, `Patient: Study ID ${studyIdVal}`),
      item.result.page_association_uncertain
        ? el('div', { class: 'hint', style: 'color:var(--conf-low);' }, `⚠ Page association uncertain: ${item.result.page_association_note || 'please confirm both pages belong to this patient.'}`)
        : null,
    ]),
    el('div', { id: 'summary-pills', class: 'review-status-pills' }),
  );
  screen.appendChild(header);

  // ---- layout ---------------------------------------------------------
  const layout = el('div', { class: 'review-layout' });
  const imagePane = renderImagePane(item, navigate);
  const dataPane = el('div', {});

  const overrideWrap = el('div', { class: 'card', style: 'display:none; background:var(--conf-low-bg); border-color:rgba(178,58,52,0.3);' });
  const overrideCheckbox = el('input', { type: 'checkbox', id: 'override-uncertain' });
  overrideCheckbox.addEventListener('change', refreshConfirmState);
  overrideWrap.append(
    el('label', { for: 'override-uncertain', style: 'display:flex; gap:8px; align-items:flex-start; font-size:13px; color:var(--conf-low);' }, [
      overrideCheckbox,
      el('span', {}, 'Save anyway, with uncertain fields left unresolved. I understand these will be saved as-is and should be fixed later.'),
    ]),
  );

  for (const section of SECTIONS) {
    const block = renderSection(section, item, refs);
    if (block) dataPane.appendChild(block);
  }
  dataPane.appendChild(overrideWrap);

  layout.append(imagePane, dataPane);
  screen.appendChild(layout);

  // ---- action bar -----------------------------------------------------
  const issuesBanner = el('div', { style: 'display:none;' });
  const confirmBtn = el('button', { class: 'primary' }, item.savedMode ? 'Save Changes' : 'Confirm & Add to Dataset');
  const actionBar = el('div', { class: 'card', style: 'position:sticky; bottom:0; margin-top:16px;' }, [
    issuesBanner,
    el('div', { style: 'display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;' }, [
      el('button', { class: 'ghost', onclick: () => navigate(item.savedMode ? 'database' : 'import') }, 'Cancel'),
      !item.savedMode ? el('button', { class: 'ghost', onclick: () => handleSaveDraft(item) }, 'Save Draft') : null,
      !item.savedMode ? el('button', { class: 'ghost', onclick: () => imagePane._reanalyze?.() }, 'Re-analyze') : null,
      confirmBtn,
    ]),
  ]);
  screen.appendChild(actionBar);

  confirmBtn.addEventListener('click', () => handleConfirm(item, navigate, overrideCheckbox.checked, confirmBtn));
  document.addEventListener('field-changed', onGlobalFieldChanged);
  // Clean up the listener when this screen is torn down (app.js clears #main-content on navigate).
  const observer = new MutationObserver(() => {
    if (!document.body.contains(screen)) { document.removeEventListener('field-changed', onGlobalFieldChanged); observer.disconnect(); }
  });
  observer.observe(document.getElementById('main-content') || document.body, { childList: true });

  refreshSummary();
  refreshConfirmState();

  return screen;

  // ======================================================================
  // local closures — all share `item`, `refs`, `settings` from above
  // ======================================================================

  function onGlobalFieldChanged(e) {
    refreshRow(e.detail.fieldId);
    refreshComputed();
    refreshSummary();
    refreshConfirmState();
  }

  function refreshRow(fieldId) {
    const state = item.fieldsState[fieldId];
    if (!state) return;
    const row = refs.rows.get(fieldId);
    if (row) row.className = 'field-row ' + statusClass(state.status, state.confidence);
    const oldBadge = refs.badges.get(fieldId);
    if (oldBadge) {
      const newBadge = confidenceBadge(state.status, state.confidence);
      oldBadge.replaceWith(newBadge);
      refs.badges.set(fieldId, newBadge);
    }
  }

  function currentFlatRecord() {
    const record = {};
    for (const f of EXTRACTABLE_FIELDS) record[f.id] = item.fieldsState[f.id]?.value ?? null;
    return record;
  }

  function refreshComputed() {
    const record = currentFlatRecord();
    const gauze = computeGauzeBloodLoss(record);
    const est = computeEstimatedBloodLoss(record);
    const hemNone = computeHemorrhageNone(record);
    setComputed('Gauze_Blood_Loss_mL', gauze === null ? '—' : `${gauze} mL`);
    setComputed('Estimated_Blood_Loss_mL', est === null ? '—' : `${est} mL`);
    setComputed('Hemorrhage_None', hemNone === null ? '—' : (hemNone ? 'Yes' : 'No'));
    const estRow = refs.computedRow.get('Estimated_Blood_Loss_mL');
    if (estRow) estRow.classList.toggle('status-uncertain', est !== null && est < 0);
  }
  function setComputed(id, text) {
    const node = refs.computed.get(id);
    if (node) node.textContent = text;
  }

  function refreshSummary() {
    const threshold = settings.confidenceThreshold ?? 90;
    let extracted = 0, blank = 0, needsReview = 0, missingRequired = 0;
    for (const f of EXTRACTABLE_FIELDS) {
      const s = item.fieldsState[f.id];
      if (!s) continue;
      if (s.status === 'uncertain') needsReview++;
      else if (s.status === 'extracted' && s.confidence < threshold) needsReview++;
      else if (s.status === 'extracted') extracted++;
      else if (s.status === 'blank') {
        if (f.validate?.required) missingRequired++; else blank++;
      }
    }
    const pillsHost = header.querySelector('#summary-pills');
    pillsHost.innerHTML = '';
    pillsHost.append(
      el('span', { class: 'pill' }, `${extracted} extracted`),
      el('span', { class: 'pill' }, `${blank} blank (expected)`),
      needsReview ? el('span', { class: 'pill', style: 'background:var(--conf-medium-bg); color:var(--conf-medium); border-color:transparent;' }, `${needsReview} need review`) : null,
      missingRequired ? el('span', { class: 'pill', style: 'background:var(--conf-low-bg); color:var(--conf-low); border-color:transparent;' }, `${missingRequired} missing (required)`) : null,
    );
  }

  function getBlockingState() {
    const record = currentFlatRecord();
    const fieldIssues = EXTRACTABLE_FIELDS
      .map(f => ({ field: f, result: validateField(f.id, record[f.id]) }))
      .filter(x => x.result.severity === 'error' && x.result.ok !== true);
    const recordIssues = validateRecord(record).filter(i => i.severity === 'error');
    const uncertainCount = EXTRACTABLE_FIELDS.filter(f => item.fieldsState[f.id]?.status === 'uncertain').length;
    return { fieldIssues, recordIssues, uncertainCount, hasErrors: fieldIssues.length > 0 || recordIssues.length > 0 };
  }

  function refreshConfirmState() {
    const { fieldIssues, recordIssues, uncertainCount, hasErrors } = getBlockingState();
    overrideWrap.style.display = uncertainCount > 0 ? 'block' : 'none';
    const overrideOk = uncertainCount === 0 || overrideCheckbox.checked;
    confirmBtn.disabled = hasErrors || !overrideOk;

    const messages = [
      ...fieldIssues.map(x => `${x.field.label_en}: ${x.result.message}`),
      ...recordIssues.map(i => i.message),
    ];
    if (messages.length > 0) {
      issuesBanner.style.display = 'block';
      issuesBanner.innerHTML = '';
      issuesBanner.appendChild(el('div', { style: 'background:var(--conf-low-bg); color:var(--conf-low); border-radius:4px; padding:10px 12px; margin-bottom:10px; font-size:13px;' }, [
        el('div', { style: 'font-weight:600; margin-bottom:4px;' }, 'Fix before saving:'),
        el('ul', { style: 'margin:0; padding-left:18px;' }, messages.map(m => el('li', {}, m))),
      ]));
    } else {
      issuesBanner.style.display = 'none';
      issuesBanner.innerHTML = '';
    }
  }

  async function handleSaveDraft(item) {
    await db.saveDraft(item.id, { label: item.label, fieldsState: item.fieldsState, result: item.result });
    toast('Draft saved — you can come back to it later from the batch queue.');
  }

  async function handleConfirm(item, navigateFn, overrideUncertain, btn) {
    // Defensive re-check: never trust only the button's disabled state for
    // something this consequential — re-run the same checks that drive it.
    const blocking = getBlockingState();
    if (blocking.hasErrors) {
      toast('Fix the validation errors listed above before saving.', { error: true });
      refreshConfirmState();
      return;
    }
    if (blocking.uncertainCount > 0 && !overrideUncertain) {
      toast(`${blocking.uncertainCount} field(s) are still uncertain. Resolve them or check the override box.`, { error: true });
      refreshConfirmState();
      return;
    }

    const record = currentFlatRecord();
    record.Gauze_Blood_Loss_mL = computeGauzeBloodLoss(record);
    record.Estimated_Blood_Loss_mL = computeEstimatedBloodLoss(record);
    record.Hemorrhage_None = computeHemorrhageNone(record);
    const confidences = EXTRACTABLE_FIELDS
      .map(f => item.fieldsState[f.id])
      .filter(s => s && (s.status === 'extracted' || s.status === 'uncertain'))
      .map(s => s.confidence);
    record.Extraction_Confidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null;
    record.Reviewed_By_User = true;
    record.Date_Added = item.savedMode ? (await db.getPatient(record.Study_ID))?.Date_Added || new Date().toISOString() : new Date().toISOString();

    if (item.savedMode) {
      const existing = await db.getAllPatients();
      await db.snapshotBackup(existing, `before-update-${record.Study_ID}`);
      await db.updatePatientExplicit(record);
      await db.logAudit({
        study_id: record.Study_ID, date_confirmed: new Date().toISOString(),
        extraction_confidence: record.Extraction_Confidence,
        user_edited: Object.values(item.fieldsState).some(f => f.userEdited),
        fields_modified: Object.entries(item.fieldsState).filter(([, f]) => f.userEdited).map(([id]) => id),
        action: 'updated',
      });
      toast(`Patient ${record.Study_ID} updated.`);
      navigateFn('database');
      return;
    }

    const dup = await db.findDuplicate(record.Study_ID);
    if (dup) {
      showDuplicateModal(dup, record, item, navigateFn);
      return;
    }
    await commitNewPatient(record, item, navigateFn);
  }

  async function commitNewPatient(record, item, navigateFn) {
    const existing = await db.getAllPatients();
    await db.snapshotBackup(existing, `before-add-${record.Study_ID}`);
    await db.addPatient(record);
    await db.logAudit({
      study_id: record.Study_ID,
      date_extracted: item.extractedAt || null,
      date_confirmed: new Date().toISOString(),
      original_filename: [item.page1?.name, item.page2?.name].filter(Boolean).join(' + ') || null,
      extraction_confidence: record.Extraction_Confidence,
      user_edited: Object.values(item.fieldsState).some(f => f.userEdited),
      fields_modified: Object.entries(item.fieldsState).filter(([, f]) => f.userEdited).map(([id]) => id),
      action: 'confirmed',
    });

    if (settings.deleteImagesAfterExtraction) { item.page1 = null; item.page2 = null; }
    const qIdx = importState.queue.findIndex(q => q.id === item.id);
    if (qIdx >= 0) importState.queue.splice(qIdx, 1);
    await db.deleteDraft(item.id);

    toast(`Patient Study ID ${record.Study_ID} successfully added. Previous patients: ${existing.length}. New patient: ${record.Study_ID}. Total patients: ${existing.length + 1}.`);

    if (settings.autoExportXlsx) {
      const { buildWorkbookBlob, downloadBlob, timestampedFilename } = await import('../excel.js');
      const all = await db.getAllPatients();
      downloadBlob(buildWorkbookBlob(all), timestampedFilename('patients'));
    }

    const next = importState.queue.find(q => q.status === 'ready' || q.status === 'needs_review');
    navigateFn(next ? 'review' : 'dashboard', next ? { itemId: next.id } : undefined);
  }

  function showDuplicateModal(existing, newRecord, item, navigateFn) {
    const content = el('div', {}, [
      el('h2', {}, 'Duplicate Study ID detected'),
      el('p', { class: 'hint' }, `A record with Study ID "${existing.Study_ID}" already exists. The existing record is never overwritten automatically.`),
      el('div', { class: 'card', style: 'background:var(--surface-sunken); margin:10px 0;' }, [
        el('div', { class: 'mono', style: 'font-weight:600;' }, `Study ID: ${existing.Study_ID}`),
        el('div', { class: 'hint' }, `Technique: ${existing.Surgical_Technique || '—'} · Age: ${existing.Age ?? '—'} · Added: ${existing.Date_Added ? new Date(existing.Date_Added).toLocaleDateString() : '—'}`),
      ]),
    ]);
    const actions = el('div', { style: 'display:flex; flex-direction:column; gap:8px; margin-top:14px;' });
    const cancelBtn = el('button', { class: 'ghost', onclick: () => close() }, 'Cancel');
    const reviewBtn = el('button', { class: 'ghost', onclick: () => { close(); navigateFn('review', { studyId: existing.Study_ID }); } }, 'Review Existing Record');
    const overwriteBtn = el('button', { class: 'danger', onclick: async () => {
      close();
      const ok = await confirmDialog({
        title: 'Overwrite existing record?',
        body: `This replaces the existing data for Study ID ${existing.Study_ID}. A backup snapshot is taken automatically first, but this cannot be undone from inside the app afterward.`,
        confirmLabel: 'Overwrite', danger: true,
      });
      if (ok) {
        const all = await db.getAllPatients();
        await db.snapshotBackup(all, `before-overwrite-${existing.Study_ID}`);
        await db.updatePatientExplicit(newRecord);
        await db.logAudit({ study_id: newRecord.Study_ID, date_confirmed: new Date().toISOString(), action: 'updated', extraction_confidence: newRecord.Extraction_Confidence });
        toast(`Patient ${newRecord.Study_ID} updated (overwritten).`);
        navigateFn('database');
      }
    } }, 'Update Existing Record (overwrite)');
    const newIdBtn = el('button', { class: 'primary', onclick: () => {
      close();
      const input = refs.inputs.get('Study_ID');
      if (input) { input.focus(); input.select(); }
      toast('Enter a different Study ID, then press Confirm again.');
    } }, 'Add as New — Different Study ID');
    actions.append(cancelBtn, reviewBtn, overwriteBtn, newIdBtn);
    content.appendChild(actions);
    const close = openModal(content);
  }
}

// ---------------------------------------------------------------------------
// Section / field / image rendering
// ---------------------------------------------------------------------------
function renderSection(sectionDef, item, refs) {
  const fields = fieldsBySection(sectionDef.id);
  if (fields.length === 0) return null;
  const block = el('div', { class: 'section-block' }, [el('h3', {}, sectionDef.label_en)]);

  if (sectionDef.id === 'indication') {
    block.appendChild(renderExclusiveGroup(fields, item, refs));
  } else {
    for (const f of fields) block.appendChild(renderFieldRow(f, item, refs));
    if (sectionDef.id === 'blood_loss') {
      block.appendChild(renderComputedRow('Gauze_Blood_Loss_mL', refs));
      block.appendChild(renderComputedRow('Estimated_Blood_Loss_mL', refs));
    }
    if (sectionDef.id === 'hemorrhage') {
      block.appendChild(renderComputedRow('Hemorrhage_None', refs));
    }
  }
  return block;
}

function renderExclusiveGroup(fields, item, refs) {
  const wrap = el('div', { class: 'field-row' });
  const optionsWrap = el('div', { style: 'display:flex; flex-direction:column; gap:8px;' });
  for (const f of fields) {
    const state = item.fieldsState[f.id] || { value: false, status: STATUS.BLANK, confidence: 100 };
    const badge = confidenceBadge(state.status, state.confidence);
    badge.style.marginLeft = 'auto';
    refs.badges.set(f.id, badge);
    const radio = el('input', { type: 'radio', name: 'indication-group' });
    radio.checked = !!state.value;
    radio.addEventListener('change', () => {
      for (const other of fields) {
        const prev = item.fieldsState[other.id] || {};
        item.fieldsState[other.id] = { value: other.id === f.id, status: STATUS.EXTRACTED, confidence: 100, note: prev.note || '', userEdited: true };
      }
      // Notify for every field in the group, not just the one clicked — the
      // two that just got unchecked need their badges refreshed too.
      for (const other of fields) {
        document.dispatchEvent(new CustomEvent('field-changed', { detail: { fieldId: other.id } }));
      }
    });
    refs.inputs.set(f.id, radio);
    optionsWrap.appendChild(el('label', { style: 'display:flex; align-items:center; gap:8px; font-size:13px;' }, [
      radio, `${f.label_en}`, f.label_ar ? el('span', { class: 'ar-text hint' }, ` (${f.label_ar})`) : null, badge,
    ]));
  }
  wrap.appendChild(optionsWrap);
  return wrap;
}

function renderFieldRow(field, item, refs) {
  const state = item.fieldsState[field.id] || { value: null, status: STATUS.BLANK, confidence: 100, note: '' };
  const row = el('div', { class: 'field-row ' + statusClass(state.status, state.confidence) });
  refs.rows.set(field.id, row);

  const left = el('div', {}, [
    el('div', { class: 'field-label' }, [
      field.label_en,
      field.help_en ? el('span', { class: 'hint' }, ` — ${field.help_en}`) : null,
      field.label_ar ? el('span', { class: 'ar-text hint' }, [' · ', field.label_ar]) : null,
    ]),
    renderInput(field, state, item, refs),
    state.note ? el('div', { class: 'field-note' }, state.note) : null,
  ]);
  row.appendChild(left);

  const badge = confidenceBadge(state.status, state.confidence);
  refs.badges.set(field.id, badge);
  row.appendChild(badge);
  return row;
}

function renderInput(field, state, item, refs) {
  const onChange = (val) => {
    const prev = item.fieldsState[field.id] || {};
    item.fieldsState[field.id] = { value: val, status: STATUS.EXTRACTED, confidence: 100, note: prev.note || '', userEdited: true };
    document.dispatchEvent(new CustomEvent('field-changed', { detail: { fieldId: field.id } }));
  };

  if (field.type === 'boolean') {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!state.value;
    cb.addEventListener('change', () => onChange(cb.checked));
    refs.inputs.set(field.id, cb);
    return el('label', { style: 'display:flex; align-items:center; gap:6px; margin-top:2px;' }, [cb, el('span', { class: 'hint' }, 'Checked on form')]);
  }
  if (field.type === 'select') {
    const select = el('select', {});
    select.appendChild(el('option', { value: '' }, '—'));
    for (const opt of field.options) {
      const o = el('option', { value: opt }, opt);
      if (state.value === opt) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => onChange(select.value || null));
    refs.inputs.set(field.id, select);
    return select;
  }
  if (field.type === 'number') {
    const input = el('input', { type: 'number', value: state.value ?? '' });
    input.addEventListener('input', () => onChange(input.value === '' ? null : Number(input.value)));
    refs.inputs.set(field.id, input);
    return input;
  }
  const input = el('input', { type: 'text', value: state.value ?? '' });
  input.addEventListener('input', () => onChange(input.value || null));
  refs.inputs.set(field.id, input);
  return input;
}

function renderComputedRow(fieldId, refs) {
  const field = getField(fieldId);
  const valueNode = el('div', { class: 'computed-value' }, '—');
  const row = el('div', { class: 'field-row' }, [
    el('div', {}, [el('div', { class: 'field-label' }, field.label_en), valueNode]),
    el('span', { class: 'badge' }, 'computed'),
  ]);
  refs.computedRow.set(fieldId, row);
  refs.computed.set(fieldId, valueNode);
  return row;
}

function renderImagePane(item, navigate) {
  const pages = [item.page1, item.page2].filter(Boolean);
  const pane = el('div', { class: 'image-pane' });

  if (pages.length === 0) {
    pane.appendChild(el('div', { class: 'viewport' }, el('p', { class: 'hint' }, 'Original image not retained (per your privacy setting: images are deleted after extraction).')));
    return pane;
  }

  let activePage = 0;
  const toolbar = el('div', { class: 'toolbar' });
  const viewport = el('div', { class: 'viewport' });

  function renderActive() {
    viewport.innerHTML = '';
    viewport.appendChild(el('img', { src: URL.createObjectURL(pages[activePage]), alt: `Page ${activePage + 1}` }));
  }

  if (pages.length > 1) {
    toolbar.append(
      el('button', { class: 'ghost', onclick: () => { activePage = 0; renderActive(); } }, 'Page 1'),
      el('button', { class: 'ghost', onclick: () => { activePage = 1; renderActive(); } }, 'Page 2'),
    );
  }
  toolbar.append(
    el('button', { class: 'ghost', title: 'Rotate 90°', onclick: () => {
      item.rotation = item.rotation || { page1: 0, page2: 0 };
      const key = activePage === 0 ? 'page1' : 'page2';
      item.rotation[key] = ((item.rotation[key] || 0) + 90) % 360;
      toast('Rotation queued — press Re-analyze to extract from the rotated image.');
    } }, '⟳ Rotate'),
  );
  pane.append(toolbar, viewport);
  renderActive();

  pane._reanalyze = async () => {
    toast('Re-analyzing…');
    try {
      const settings = await db.getSettings();
      await runExtractionForQueueItem(item, settings);
      navigate('review', { itemId: item.id });
    } catch (e) {
      toast(describeExtractionError(e), { error: true });
    }
  };
  return pane;
}
