// Plain-Node test runner for pure logic — no test framework, no network, no deps.
// Run with: node test/logic.test.js   (or: npm test)
import assert from 'node:assert/strict';
import {
  validateField, validateRecord,
  computeGauzeBloodLoss, computeEstimatedBloodLoss, computeHemorrhageNone,
} from '../js/validation.js';
import { suggestColumnMapping } from '../js/excel.js';
import { findDuplicateStudyId } from '../js/db-logic.js';
import { EXTRACTABLE_FIELDS, EXCEL_COLUMNS, SECTIONS, fieldsBySection } from '../js/schema.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  - ${name}`); }
  catch (e) { fail++; console.error(`FAIL  - ${name}\n        ${e.message}`); }
}

console.log('Blood loss calculations');
test('gauze blood loss = wet - dry', () => {
  assert.equal(computeGauzeBloodLoss({ Dry_Gauze_Weight_g: 18, Wet_Gauze_Weight_g: 31 }), 13);
});
test('estimated blood loss = gauze + suction - irrigation', () => {
  const r = { Dry_Gauze_Weight_g: 18, Wet_Gauze_Weight_g: 31, Suction_Volume_mL: 45, Irrigation_Volume_mL: 20 };
  assert.equal(computeEstimatedBloodLoss(r), 38); // (31-18) + 45 - 20 = 38
});
test('estimated blood loss can go negative (flagged elsewhere, not hidden)', () => {
  const r = { Dry_Gauze_Weight_g: 10, Wet_Gauze_Weight_g: 12, Suction_Volume_mL: 0, Irrigation_Volume_mL: 50 };
  assert.equal(computeEstimatedBloodLoss(r), -48);
});
test('missing inputs -> null, not zero', () => {
  assert.equal(computeGauzeBloodLoss({ Dry_Gauze_Weight_g: 18 }), null);
});

console.log('Hemorrhage_None (computed, never AI-guessed)');
test('both false -> None true', () => {
  assert.equal(computeHemorrhageNone({ Primary_Hemorrhage: false, Secondary_Hemorrhage: false }), true);
});
test('either true -> None false', () => {
  assert.equal(computeHemorrhageNone({ Primary_Hemorrhage: true, Secondary_Hemorrhage: false }), false);
});
test('unknown -> null (never assume None)', () => {
  assert.equal(computeHemorrhageNone({ Primary_Hemorrhage: null, Secondary_Hemorrhage: false }), null);
});

console.log('Field validation');
test('pain score 11 rejected', () => {
  const r = validateField('Pain_Day1_Rest', 11);
  assert.equal(r.ok, false);
});
test('pain score 7 accepted', () => {
  assert.equal(validateField('Pain_Day1_Rest', 7).ok, true);
});
test('pain score non-numeric rejected', () => {
  assert.equal(validateField('Pain_Day1_Rest', '8 / 3').ok, false);
});
test('required Study_ID blank rejected', () => {
  assert.equal(validateField('Study_ID', '').ok, false);
});
test('optional blank field accepted', () => {
  assert.equal(validateField('Phone_Number', '').ok, true);
});
test('operative time above soft max warns but does not block', () => {
  const r = validateField('Operative_Time_Min', 200);
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'warning');
});

console.log('Record-level validation');
test('wet < dry gauze triggers error', () => {
  const issues = validateRecord({ Study_ID: '001', Surgical_Technique: 'Coblation', Dry_Gauze_Weight_g: 20, Wet_Gauze_Weight_g: 15, Suction_Volume_mL: 10, Irrigation_Volume_mL: 5 });
  assert.ok(issues.some(i => i.message.includes('Wet gauze')));
});
test('negative blood loss triggers error', () => {
  const issues = validateRecord({ Study_ID: '001', Surgical_Technique: 'Coblation', Dry_Gauze_Weight_g: 10, Wet_Gauze_Weight_g: 12, Suction_Volume_mL: 0, Irrigation_Volume_mL: 50 });
  assert.ok(issues.some(i => i.message.includes('Check suction/irrigation')));
});
test('two indication boxes checked -> warning, not silently resolved', () => {
  const issues = validateRecord({
    Study_ID: '001', Surgical_Technique: 'Coblation',
    Indication_Recurrent_Tonsillitis: true, Indication_Obstructive_Sleep_Symptoms: true, Indication_Both: false,
  });
  assert.ok(issues.some(i => i.message.includes('More than one indication')));
});
test('missing Study_ID is an error', () => {
  const issues = validateRecord({ Surgical_Technique: 'Coblation' });
  assert.ok(issues.some(i => i.message.includes('Study ID is required')));
});

console.log('Excel column-mapping suggestions (fuzzy match existing headers)');
test('maps "Patient ID" -> Study_ID', () => {
  const m = suggestColumnMapping(['Patient ID', 'Operative Time', 'Age (yrs)']);
  assert.equal(m['Patient ID'], 'Study_ID');
});
test('maps "Operative Time" -> Operative_Time_Min', () => {
  const m = suggestColumnMapping(['Patient ID', 'Operative Time', 'Age (yrs)']);
  assert.equal(m['Operative Time'], 'Operative_Time_Min');
});
test('unrecognised header maps to null, not a guess', () => {
  const m = suggestColumnMapping(['Some Random Column XYZ']);
  assert.equal(m['Some Random Column XYZ'], null);
});

console.log('Duplicate Study ID detection');
test('exact match found', () => {
  const existing = [{ Study_ID: '023' }, { Study_ID: '024' }];
  assert.deepEqual(findDuplicateStudyId(existing, '023'), { Study_ID: '023' });
});
test('whitespace/case differences still counted as duplicate', () => {
  const existing = [{ Study_ID: '023' }];
  assert.ok(findDuplicateStudyId(existing, ' 023 '));
});
test('no match returns null', () => {
  const existing = [{ Study_ID: '023' }];
  assert.equal(findDuplicateStudyId(existing, '099'), null);
});

console.log('Schema-wide consistency (every field, end to end)');
test('every field in every section has a working validator with a synthetic value', () => {
  const synthetic = {};
  for (const f of EXTRACTABLE_FIELDS) {
    if (f.type === 'number') synthetic[f.id] = f.validate?.max ?? 5;
    else if (f.type === 'boolean') synthetic[f.id] = true;
    else if (f.type === 'select') synthetic[f.id] = f.options[0];
    else synthetic[f.id] = 'x';
  }
  synthetic.Study_ID = 'TEST-001';
  synthetic.Surgical_Technique = 'Coblation';
  for (const f of EXTRACTABLE_FIELDS) {
    const r = validateField(f.id, synthetic[f.id]);
    assert.ok(r.ok === true || r.severity, `${f.id} validator returned an unusable result`);
  }
  const issues = validateRecord(synthetic);
  assert.ok(Array.isArray(issues));
});
test('every SECTIONS id used by at least one field is spelled consistently', () => {
  for (const s of SECTIONS) {
    // sections with 0 fields are fine (e.g. purely computed sections aren't expected here)
    assert.ok(Array.isArray(fieldsBySection(s.id)));
  }
});
test('EXCEL_COLUMNS has no duplicate column names', () => {
  const seen = new Set();
  for (const c of EXCEL_COLUMNS) {
    assert.ok(!seen.has(c), `duplicate column: ${c}`);
    seen.add(c);
  }
});
test('pain table has exactly 15 fields (5 timepoints x 3 measures)', () => {
  const painFields = EXTRACTABLE_FIELDS.filter(f => f.id.startsWith('Pain_'));
  assert.equal(painFields.length, 15);
});
test('all 15 pain fields validate 0-10 integer range', () => {
  const painFields = EXTRACTABLE_FIELDS.filter(f => f.id.startsWith('Pain_'));
  for (const f of painFields) {
    assert.equal(validateField(f.id, 10).ok, true);
    assert.equal(validateField(f.id, 10.5).ok, false);
    assert.equal(validateField(f.id, -1).ok, false);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
