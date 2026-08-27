/**
 * excel.js
 * Reads/writes .xlsx/.xls/.csv entirely in the browser using SheetJS (the
 * `XLSX` global loaded from a CDN in index.html — see README for the offline
 * caveat). Column-mapping suggestion logic is a pure function so it can be
 * unit-tested without SheetJS or a browser (see /test/logic.test.js).
 */
import { EXCEL_COLUMNS, FIELDS } from './schema.js';

// ---------------------------------------------------------------------------
// Column-mapping suggestions (pure, testable)
// ---------------------------------------------------------------------------

// Hand-curated aliases for the columns most likely to already exist under a
// different name in someone's pre-existing spreadsheet. Anything not listed
// here falls back to a normalized substring match against the field's own
// label — and if nothing matches, the mapping is left null for the user to
// set manually, rather than guessing.
const ALIASES = {
  Study_ID: ['patient id', 'id', 'patient no', 'subject id', 'case no', 'study no'],
  Age: ['age yrs', 'age years', 'patient age'],
  Gender: ['sex'],
  Operative_Time_Min: ['operative time', 'ot', 'surgery time', 'operation time', 'duration min'],
  Surgical_Technique: ['technique', 'surgery type', 'method', 'group'],
  Dry_Gauze_Weight_g: ['dry gauze', 'dry gauze weight'],
  Wet_Gauze_Weight_g: ['wet gauze', 'wet gauze weight'],
  Suction_Volume_mL: ['suction', 'suction volume'],
  Irrigation_Volume_mL: ['irrigation', 'irrigation volume'],
  Estimated_Blood_Loss_mL: ['blood loss', 'ebl', 'total blood loss'],
  Phone_Number: ['phone', 'contact number', 'mobile'],
  Patient_Parent_Satisfaction: ['satisfaction'],
};

function normalize(s) {
  return String(s ?? '').toLowerCase().trim().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Given the header row of an existing spreadsheet, suggest a mapping to our
 * canonical column ids. Returns { [existingHeader]: canonicalId | null }.
 * The caller (screens/excel-manage.js) always shows this to the user for
 * confirmation/adjustment before anything is imported.
 */
export function suggestColumnMapping(existingHeaders) {
  const result = {};
  const allTargets = EXCEL_COLUMNS.map(id => ({ id, norm: normalize(id.replace(/_/g, ' ')) }));
  const fieldLabels = FIELDS.map(f => ({ id: f.id, norm: normalize(f.label_en) }));

  for (const header of existingHeaders) {
    const h = normalize(header);
    let match = null;

    // 1) exact id match (case/format-insensitive)
    match = allTargets.find(t => t.norm === h)?.id;

    // 2) curated alias match
    if (!match) {
      for (const [id, aliases] of Object.entries(ALIASES)) {
        if (aliases.some(a => normalize(a) === h)) { match = id; break; }
      }
    }

    // 3) label containment match (e.g. "Op Time (minutes)" contains "operative time"-ish tokens)
    if (!match) {
      const found = fieldLabels.find(f => h.includes(f.norm) || f.norm.includes(h));
      if (found) match = found.id;
    }

    result[header] = match || null;
  }
  return result;
}

// ---------------------------------------------------------------------------
// File I/O (browser only — needs the global XLSX from SheetJS)
// ---------------------------------------------------------------------------

function requireXLSX() {
  if (typeof window === 'undefined' || !window.XLSX) {
    throw new Error('SheetJS did not load. Check your internet connection and reload the app.');
  }
  return window.XLSX;
}

/** Parse an uploaded .xlsx/.xls/.csv File into { headers, rows } (rows = array of plain objects). */
export async function readWorkbook(file) {
  const XLSX = requireXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const headers = rows.length
    ? Object.keys(rows[0])
    : (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []);
  return { sheetName, headers, rows };
}

/** Apply a confirmed header->canonicalId mapping to raw imported rows. */
export function applyColumnMapping(rows, mapping) {
  return rows.map(row => {
    const out = {};
    for (const [header, canonicalId] of Object.entries(mapping)) {
      if (canonicalId) out[canonicalId] = row[header] ?? null;
    }
    return out;
  });
}

/** Build a downloadable .xlsx Blob from the full dataset (existing + appended rows). */
export function buildWorkbookBlob(allRows) {
  const XLSX = requireXLSX();
  const ordered = allRows.map(row => {
    const o = {};
    for (const col of EXCEL_COLUMNS) o[col] = row[col] ?? null;
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(ordered, { header: EXCEL_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Patients');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timestampedFilename(prefix) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}_${stamp}.xlsx`;
}
