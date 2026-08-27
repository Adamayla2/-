/**
 * db.js
 * Thin IndexedDB wrapper. Everything lives on-device — nothing here ever
 * makes a network call. The only network call in the whole app is the one
 * in extraction.js, straight to Anthropic, with whatever image the user is
 * actively reviewing.
 */
import { findDuplicateStudyId } from './db-logic.js';

const DB_NAME = 'tonsil_research_db';
const DB_VERSION = 2;
const STORES = {
  patients: 'Study_ID',
  audit: 'id',          // autoIncrement
  settings: 'key',
  mappings: 'id',        // autoIncrement, { sourceHeaders, mapping, savedAt }
  backups: 'id',         // autoIncrement, { createdAt, rows }
  drafts: 'draftKey',    // draftKey = queue item id, so Save Draft survives a reload
};

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('patients')) {
        db.createObjectStore('patients', { keyPath: 'Study_ID' });
      }
      if (!db.objectStoreNames.contains('audit')) {
        db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('mappings')) {
        db.createObjectStore('mappings', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('backups')) {
        db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'draftKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export async function getAllPatients() {
  const store = await tx('patients');
  return wrap(store.getAll());
}

export async function getPatient(studyId) {
  const store = await tx('patients');
  return wrap(store.get(studyId));
}

/** Never overwrites silently — throws if a record with this Study ID already exists. */
export async function addPatient(record) {
  const existing = await getAllPatients();
  const dup = findDuplicateStudyId(existing, record.Study_ID);
  if (dup) {
    const err = new Error('DUPLICATE_STUDY_ID');
    err.existing = dup;
    throw err;
  }
  const store = await tx('patients', 'readwrite');
  await wrap(store.add(record));
  return record;
}

/** Explicit, separate function from addPatient — an update must be a conscious choice. */
export async function updatePatientExplicit(record) {
  const store = await tx('patients', 'readwrite');
  await wrap(store.put(record));
  return record;
}

export async function deletePatient(studyId) {
  const store = await tx('patients', 'readwrite');
  await wrap(store.delete(studyId));
}

export async function findDuplicate(studyId) {
  const existing = await getAllPatients();
  return findDuplicateStudyId(existing, studyId);
}

// ---------------------------------------------------------------------------
// Audit log — minimal, no raw personal data (see README "Privacy")
// ---------------------------------------------------------------------------

export async function logAudit(entry) {
  const store = await tx('audit', 'readwrite');
  await wrap(store.add({
    study_id: entry.study_id,
    date_extracted: entry.date_extracted || null,
    date_confirmed: entry.date_confirmed || null,
    original_filename: entry.original_filename || null,
    extraction_confidence: entry.extraction_confidence ?? null,
    user_edited: !!entry.user_edited,
    fields_modified: entry.fields_modified || [],
    action: entry.action, // 'confirmed' | 'updated' | 'skipped'
    at: new Date().toISOString(),
  }));
}

export async function getAuditLog() {
  const store = await tx('audit');
  return wrap(store.getAll());
}

// ---------------------------------------------------------------------------
// Settings (API key, thresholds, privacy toggle, language)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  apiKey: '',
  confidenceThreshold: 90,
  deleteImagesAfterExtraction: true,
  extractionModel: 'claude-sonnet-5',
};

export async function getSettings() {
  const store = await tx('settings');
  const rows = await wrap(store.getAll());
  const map = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function setSetting(key, value) {
  const store = await tx('settings', 'readwrite');
  await wrap(store.put({ key, value }));
}

// ---------------------------------------------------------------------------
// Column mappings (remembered after the user confirms them once)
// ---------------------------------------------------------------------------

export async function saveColumnMapping(sourceHeaders, mapping) {
  const store = await tx('mappings', 'readwrite');
  await wrap(store.add({ sourceHeaders, mapping, savedAt: new Date().toISOString() }));
}

export async function getLastColumnMapping() {
  const store = await tx('mappings');
  const rows = await wrap(store.getAll());
  return rows.length ? rows[rows.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Backups — snapshot taken automatically before every write that changes
// the dataset (import or append), per spec requirement #7.
// ---------------------------------------------------------------------------

export async function snapshotBackup(rows, label) {
  const store = await tx('backups', 'readwrite');
  await wrap(store.add({ createdAt: new Date().toISOString(), label, rows }));
  await pruneOldBackups();
}

export async function getBackups() {
  const store = await tx('backups');
  return wrap(store.getAll());
}

async function pruneOldBackups(keep = 30) {
  const store = await tx('backups', 'readwrite');
  const all = await wrap(store.getAll());
  if (all.length <= keep) return;
  const toRemove = all.slice(0, all.length - keep);
  for (const b of toRemove) await wrap(store.delete(b.id));
}

// ---------------------------------------------------------------------------
// Drafts — "Save Draft" on the review screen. Images are intentionally NOT
// stored here (see privacy setting); only the editable field state + label.
// ---------------------------------------------------------------------------

export async function saveDraft(draftKey, payload) {
  const store = await tx('drafts', 'readwrite');
  await wrap(store.put({ draftKey, ...payload, savedAt: new Date().toISOString() }));
}

export async function getDraft(draftKey) {
  const store = await tx('drafts');
  return wrap(store.get(draftKey));
}

export async function getAllDrafts() {
  const store = await tx('drafts');
  return wrap(store.getAll());
}

export async function deleteDraft(draftKey) {
  const store = await tx('drafts', 'readwrite');
  await wrap(store.delete(draftKey));
}

// ---------------------------------------------------------------------------
// Bulk import from an existing Excel file. NEVER overwrites: rows whose
// Study ID already exists in the local dataset are skipped and returned to
// the caller so the user can reconcile them manually (Patient Database ->
// duplicate-detection flow), rather than silently colliding.
// ---------------------------------------------------------------------------

export async function bulkImportNewOnly(rows) {
  const existing = await getAllPatients();
  const existingIds = new Set(existing.map(r => normalizeKey(r.Study_ID)));
  const added = [];
  const skipped = [];
  for (const row of rows) {
    if (!row.Study_ID) { skipped.push({ row, reason: 'missing Study ID' }); continue; }
    if (existingIds.has(normalizeKey(row.Study_ID))) { skipped.push({ row, reason: 'duplicate Study ID' }); continue; }
    added.push(row);
    existingIds.add(normalizeKey(row.Study_ID));
  }
  if (added.length) {
    const db = await openDb();
    const store = db.transaction('patients', 'readwrite').objectStore('patients');
    for (const row of added) store.add(row);
    await new Promise((resolve, reject) => {
      store.transaction.oncomplete = resolve;
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }
  return { added, skipped };
}
function normalizeKey(id) { return String(id ?? '').trim().toLowerCase(); }

/** Destructive — wipes every store except settings (API key etc. survive). Caller must confirm with the user first. */
export async function eraseAllData() {
  const database = await openDb();
  const storesToClear = ['patients', 'audit', 'mappings', 'backups', 'drafts'];
  await Promise.all(storesToClear.map(name => new Promise((resolve, reject) => {
    const req = database.transaction(name, 'readwrite').objectStore(name).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  })));
}

/** Destructive — wipes `patients` and replaces with backup.rows. Caller must confirm with the user first. */
export async function clearAndReplacePatients(rows) {
  const db = await openDb();
  const store = db.transaction('patients', 'readwrite').objectStore('patients');
  await wrap(store.clear());
  for (const row of rows) {
    if (row.Study_ID) store.put(row);
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}
