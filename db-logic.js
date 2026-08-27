/**
 * db-logic.js
 * Pure helper functions used by db.js (the IndexedDB wrapper). Kept separate
 * from anything that touches `indexedDB` so these can be unit-tested with
 * plain Node — see /test/logic.test.js.
 */

/** Normalize a Study ID for comparison: trim + collapse case/whitespace. */
export function normalizeStudyId(id) {
  return String(id ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Look for an existing record with the same Study ID (normalized).
 * `existingRecords` is an array of plain row objects (as read from IndexedDB
 * or an imported Excel file). Returns the matching record or null.
 */
export function findDuplicateStudyId(existingRecords, studyId) {
  const target = normalizeStudyId(studyId);
  if (!target) return null;
  return existingRecords.find(r => normalizeStudyId(r.Study_ID) === target) || null;
}
