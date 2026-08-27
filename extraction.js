/**
 * extraction.js
 * The only part of this app that talks to the network. Everything else is
 * local. This calls the Anthropic Messages API directly from the browser
 * using the user's own API key (entered in Settings, stored only in this
 * browser's IndexedDB — see README "Privacy & the API key" for the tradeoffs
 * of that approach and why it's the right one for a single-user local tool).
 */
import { EXTRACTABLE_FIELDS, STATUS } from './schema.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// ---------------------------------------------------------------------------
// Prompt construction — built FROM schema.js so it can never drift out of
// sync with the form fields, and so editing schema.js is the only place you
// ever need to touch when the questionnaire changes.
// ---------------------------------------------------------------------------

function fieldSpecLine(f) {
  let desc = `"${f.id}": ${f.type}`;
  if (f.type === 'select') desc += ` (one of: ${f.options.join(' | ')})`;
  if (f.type === 'boolean') desc += ' (true only if the checkbox is clearly marked/checked)';
  if (f.unit) desc += `, unit ${f.unit}`;
  if (f.validate?.min !== undefined || f.validate?.max !== undefined) {
    desc += ` [valid range ${f.validate.min ?? '-'}–${f.validate.max ?? '-'}]`;
  }
  desc += ` — EN: "${f.label_en}"`;
  if (f.label_ar) desc += ` / AR: "${f.label_ar}"`;
  if (f.help_en) desc += ` (${f.help_en})`;
  return desc;
}

function buildPrompt() {
  const bySection = {};
  for (const f of EXTRACTABLE_FIELDS) {
    (bySection[f.section] ||= []).push(f);
  }

  const sectionBlocks = Object.entries(bySection).map(([section, fields]) => {
    return `# ${section}\n` + fields.map(f => '- ' + fieldSpecLine(f)).join('\n');
  }).join('\n\n');

  return `You are extracting data from a completed PAPER research questionnaire for a clinical study titled "Evaluation of outcomes of tonsillectomy using Coblation versus cold steel method". The form is bilingual (English printed labels with Arabic translations). You will be shown one or two photographed/scanned pages of ONE patient's completed form.

Read the handwritten and checked-box answers exactly as marked. Do not infer, guess, or fill in anything that is not actually marked or written on the page.

FIELDS TO EXTRACT:

${sectionBlocks}

IMPORTANT RULES:
1. If a field is clearly left blank on the form, set status to "blank" and value to null. This is NOT an error — most forms have some blank fields.
2. If something IS written/marked but you cannot read it with confidence (ambiguous handwriting, e.g. could be "8" or "3"), set status to "uncertain", value to null, and put your best candidate readings in "note" (e.g. "looks like 8 or 3"). NEVER pick one value and present it as certain.
3. If you can read a field clearly, set status to "extracted", put the value, and set confidence 0-100 reflecting how sure you are.
4. For checkbox groups where the form only allows one answer (Gender, Residence, Indication for tonsillectomy, Surgical technique, Patient/parent satisfaction), only ONE of the related fields should be true. If more than one box genuinely appears checked, extract exactly what you see and lower confidence rather than silently picking one.
5. For checkbox groups where multiple boxes can be checked at once (intraoperative complications, post-op exam findings, hemorrhage), extract each independently.
6. "PostOp_Exam_Injury_Any" corresponds to the ONE printed checkbox "injuries to ant. pillars, tongue, uvula, soft palate, tooth". The five separate site fields (PostOp_Exam_Anterior_Pillar_Injury, _Tongue_Injury, _Uvula_Injury, _Soft_Palate_Injury, _Tooth_Injury) should ONLY be set to true if a specific site is separately handwritten/circled/annotated on the form near that checkbox — do not distribute one generic checkmark across all five. If no site is specified, leave all five as status "na" (not determinable from the form) and rely on PostOp_Exam_Injury_Any alone.
7. Do not calculate or output Gauze_Blood_Loss_mL, Estimated_Blood_Loss_mL, or Hemorrhage_None — those are computed by the application, not extracted by you.
8. The pain table has 5 rows (timepoints) x 3 columns (Rest / Drinking / Eating). Map each handwritten number to its exact row and column — do not shift values between cells. Every pain score must be 0-10; if a written number is outside that range, treat it as uncertain rather than extracting an invalid score.
9. Study ID is critical — read it very carefully, it's the primary identifier for this patient's record. If two images are provided, use both to confirm they belong to the same patient before extracting page 2 fields; if you cannot confirm the pages are the same patient, set "page_association_uncertain" to true at the top level and explain in "page_association_note".

OUTPUT FORMAT — respond with ONLY a single JSON object, no markdown fences, no explanation before or after. Shape:
{
  "page_association_uncertain": false,
  "page_association_note": "",
  "fields": {
    "<field_id>": { "value": <string|number|boolean|null>, "status": "extracted"|"blank"|"uncertain"|"na", "confidence": <0-100>, "note": "<string, empty if nothing to note>" },
    ...one entry for every field listed above, using its exact id...
  }
}`;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function mediaTypeFor(file) {
  const t = file.type;
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(t)) return t;
  return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// The API call
// ---------------------------------------------------------------------------

/**
 * @param {File[]} imageFiles - one or two page images (already preprocessed
 *   canvas exports, see preprocess.js), already resolved to Blob/File.
 * @param {string} apiKey
 * @param {string} model
 * @returns {Promise<{page_association_uncertain, page_association_note, fields, raw}>}
 */
export async function extractQuestionnaire(imageFiles, apiKey, model = 'claude-sonnet-5') {
  if (!apiKey) {
    const err = new Error('NO_API_KEY');
    throw err;
  }
  const imageBlocks = [];
  for (const file of imageFiles) {
    const b64 = await fileToBase64(file);
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaTypeFor(file), data: b64 },
    });
  }

  const body = {
    model,
    max_tokens: 8000,
    system: 'You are a meticulous clinical-research data abstractor. You transcribe exactly what is on the page and never fabricate a value. Output strict JSON only.',
    messages: [
      {
        role: 'user',
        content: [...imageBlocks, { type: 'text', text: buildPrompt() }],
      },
      // Prefill forces the response to start as a JSON object, which is the
      // most reliable way to get JSON-only output from the Messages API.
      { role: 'assistant', content: '{' },
    ],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`API_ERROR_${res.status}`);
    err.detail = text;
    throw err;
  }

  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('EMPTY_RESPONSE');

  // We prefilled with "{", so stitch it back on before parsing.
  const jsonText = '{' + textBlock.text;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const err = new Error('UNPARSEABLE_JSON');
    err.raw = jsonText;
    throw err;
  }

  return normalizeExtractionResult(parsed);
}

/**
 * Guarantees every schema field is present in the output, even if the model
 * omitted one — missing fields become status "uncertain" so they surface for
 * review rather than silently vanishing.
 */
function normalizeExtractionResult(parsed) {
  const fields = {};
  const rawFields = parsed.fields || {};
  for (const f of EXTRACTABLE_FIELDS) {
    const r = rawFields[f.id];
    if (!r) {
      fields[f.id] = { value: null, status: STATUS.UNCERTAIN, confidence: 0, note: 'Model did not return this field.' };
    } else {
      fields[f.id] = {
        value: r.value ?? null,
        status: r.status || STATUS.UNCERTAIN,
        confidence: typeof r.confidence === 'number' ? r.confidence : 0,
        note: r.note || '',
      };
    }
  }
  return {
    page_association_uncertain: !!parsed.page_association_uncertain,
    page_association_note: parsed.page_association_note || '',
    fields,
  };
}

export { buildPrompt as _buildPromptForDebug };
