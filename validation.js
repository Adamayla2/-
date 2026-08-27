/**
 * validation.js
 * Pure functions only (no DOM, no fetch) so they can be unit-tested with
 * plain Node — see /test/logic.test.js.
 */
import { getField } from './schema.js';

/**
 * Validate a single field value against its schema rule.
 * Returns { ok: boolean, message?: string, severity: 'error'|'warning' }
 */
export function validateField(fieldId, value) {
  const field = getField(fieldId);
  if (!field) return { ok: true };
  const v = field.validate || {};

  if (v.required && (value === null || value === undefined || value === '')) {
    return { ok: false, severity: 'error', message: 'Required field is missing.' };
  }
  if (value === null || value === undefined || value === '') {
    return { ok: true }; // optional & blank is fine
  }

  if (field.type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return { ok: false, severity: 'error', message: 'Must be a number.' };
    }
    if (v.integer && !Number.isInteger(num)) {
      return { ok: false, severity: 'error', message: 'Must be a whole number.' };
    }
    if (typeof v.min === 'number' && num < v.min) {
      return { ok: false, severity: 'error', message: `Must be ≥ ${v.min}.` };
    }
    if (typeof v.max === 'number' && num > v.max) {
      return { ok: false, severity: 'error', message: `Must be ≤ ${v.max}.` };
    }
    if (typeof v.softMax === 'number' && num > v.softMax) {
      return { ok: true, severity: 'warning', message: `Unusually high (>${v.softMax}). Please double-check.` };
    }
  }

  if (field.type === 'select' && field.options && !field.options.includes(value)) {
    return { ok: false, severity: 'error', message: `Must be one of: ${field.options.join(', ')}` };
  }

  return { ok: true };
}

/**
 * Cross-field / record-level checks that can't be expressed per-field.
 * `record` is a flat { fieldId: value } object (already unwrapped from
 * the {value, status, confidence} extraction shape).
 * Returns an array of { fieldIds: [...], severity, message }
 */
export function validateRecord(record) {
  const issues = [];

  const dry = numOrNull(record.Dry_Gauze_Weight_g);
  const wet = numOrNull(record.Wet_Gauze_Weight_g);
  if (dry !== null && wet !== null && wet < dry) {
    issues.push({
      fieldIds: ['Dry_Gauze_Weight_g', 'Wet_Gauze_Weight_g'],
      severity: 'error',
      message: 'Wet gauze weight is less than dry gauze weight — please re-check these two measurements.',
    });
  }

  const bloodLoss = computeEstimatedBloodLoss(record);
  if (bloodLoss !== null && bloodLoss < 0) {
    issues.push({
      fieldIds: ['Dry_Gauze_Weight_g', 'Wet_Gauze_Weight_g', 'Suction_Volume_mL', 'Irrigation_Volume_mL'],
      severity: 'error',
      message: 'Check suction/irrigation and gauze measurements.',
    });
  }

  // Indication should be exactly one of the three (the form is single-select)
  const indicationCount = ['Indication_Recurrent_Tonsillitis', 'Indication_Obstructive_Sleep_Symptoms', 'Indication_Both']
    .filter(id => record[id] === true).length;
  if (indicationCount === 0) {
    issues.push({ fieldIds: ['Indication_Recurrent_Tonsillitis'], severity: 'warning', message: 'No indication checkbox detected.' });
  } else if (indicationCount > 1) {
    issues.push({ fieldIds: ['Indication_Recurrent_Tonsillitis'], severity: 'warning', message: 'More than one indication box appears checked — please confirm which applies.' });
  }

  if (!record.Surgical_Technique) {
    issues.push({ fieldIds: ['Surgical_Technique'], severity: 'error', message: 'Surgical technique is required for this study.' });
  }
  if (!record.Study_ID) {
    issues.push({ fieldIds: ['Study_ID'], severity: 'error', message: 'Study ID is required.' });
  }

  return issues;
}

export function computeGauzeBloodLoss(record) {
  const dry = numOrNull(record.Dry_Gauze_Weight_g);
  const wet = numOrNull(record.Wet_Gauze_Weight_g);
  if (dry === null || wet === null) return null;
  return round1(wet - dry);
}

export function computeEstimatedBloodLoss(record) {
  const gauze = computeGauzeBloodLoss(record);
  const suction = numOrNull(record.Suction_Volume_mL);
  const irrigation = numOrNull(record.Irrigation_Volume_mL);
  if (gauze === null || suction === null || irrigation === null) return null;
  return round1(gauze + suction - irrigation);
}

export function computeHemorrhageNone(record) {
  if (typeof record.Primary_Hemorrhage !== 'boolean' || typeof record.Secondary_Hemorrhage !== 'boolean') {
    return null; // unknown, not confidently "none"
  }
  return !record.Primary_Hemorrhage && !record.Secondary_Hemorrhage;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
