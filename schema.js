/**
 * schema.js
 * ---------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for the questionnaire data model.
 *
 * This file is read by:
 *   - extraction.js   -> builds the AI extraction prompt + validates the JSON it returns
 *   - validation.js   -> range/logic checks
 *   - excel.js        -> canonical Excel column order + column-mapping suggestions
 *   - screens/review.js -> renders the editable review form
 *
 * If you ever need to change a field, change it HERE ONLY. Everything else
 * derives from this file, so the prompt, the form, and the spreadsheet
 * never drift out of sync with each other.
 *
 * TWO DELIBERATE DEPARTURES FROM THE ORIGINAL SPEC — READ THIS:
 *
 * 1) PostOp exam "injuries to ant. pillars / tongue / uvula / soft palate /
 *    tooth" is printed on the real form as ONE checkbox, not five. A single
 *    checkmark cannot tell you which structure was injured. Rather than
 *    guess, this schema keeps the five per-site columns the spec asked for
 *    (for when a clinician has handwritten the specific site next to the
 *    box) PLUS one extra field, PostOp_Exam_Injury_Any, which is the field
 *    that can actually be read reliably off the form. If no site is
 *    handwritten, the five site columns stay blank/"not specified" rather
 *    than being guessed at, and PostOp_Exam_Injury_Any carries the finding.
 *
 * 2) The form has no "None" checkbox for hemorrhage — only Primary and
 *    Secondary. Hemorrhage_None is therefore a COMPUTED field (true only
 *    when both Primary and Secondary are confidently known to be
 *    unchecked), never something the AI is asked to "find" on the page.
 *
 * See README.md "Data model notes" for the full explanation.
 * ---------------------------------------------------------------------------
 */

// ---- Field-status vocabulary used everywhere (extraction, review, DB) -----
export const STATUS = {
  EXTRACTED: 'extracted',   // read with reasonable confidence
  BLANK: 'blank',           // confidently blank on the form
  UNCERTAIN: 'uncertain',   // illegible / ambiguous, needs a human
  NOT_APPLICABLE: 'na',     // e.g. site-injury columns when only the combined box is checked
};

export const SECTIONS = [
  { id: 'demographics', label_en: 'Demographic Data', label_ar: 'البيانات الديموغرافية' },
  { id: 'indication', label_en: 'Indication for Tonsillectomy', label_ar: 'دواعي استئصال اللوزتين' },
  { id: 'technique', label_en: 'Surgical Technique', label_ar: 'التقنية الجراحية' },
  { id: 'blood_loss', label_en: 'Intra-operative Blood Loss', label_ar: 'فقدان الدم أثناء العملية' },
  { id: 'operative_time', label_en: 'Operative Time', label_ar: 'مدة العملية' },
  { id: 'intraop_complications', label_en: 'Intraoperative Complications', label_ar: 'مضاعفات أثناء العملية' },
  { id: 'postop_exam', label_en: 'Post-operative Examination (Day 2–3)', label_ar: 'الفحص بعد العملية' },
  { id: 'hemorrhage', label_en: 'Postoperative Hemorrhage', label_ar: 'النزيف بعد العملية' },
  { id: 'pain', label_en: 'Post-operative Pain', label_ar: 'الألم بعد العملية' },
  { id: 'recovery', label_en: 'Recovery', label_ar: 'التعافي' },
  { id: 'satisfaction', label_en: 'Patient/Parent Satisfaction', label_ar: 'رضى المريض والأبوين' },
];

/**
 * type:
 *   'text' | 'number' | 'select' | 'boolean' | 'note'
 * validate:
 *   min/max for numbers, required, integer
 * computed:
 *   fn(record) -> value   (never sent to the AI, never editable by hand — see review.js)
 */
const painTimepoints = [
  { key: '6h', label_en: 'After 6 hours', label_ar: 'بعد ٦ ساعات' },
  { key: 'Day1', label_en: 'After 1 day', label_ar: 'بعد يوم' },
  { key: 'Day3', label_en: 'After 3 days', label_ar: 'بعد ثلاث ايام' },
  { key: 'Day7', label_en: 'After 7 days', label_ar: 'بعد سبعة ايام' },
  { key: 'Day14', label_en: 'After 14 days', label_ar: 'بعد اربعة عشر يوم' },
];
const painMeasures = [
  { key: 'Rest', label_en: 'Rest', label_ar: 'عند الراحة' },
  { key: 'Drinking', label_en: 'Drinking', label_ar: 'عند الشراب' },
  { key: 'Eating', label_en: 'Eating', label_ar: 'عند الاكل' },
];

const painFields = [];
for (const tp of painTimepoints) {
  for (const m of painMeasures) {
    painFields.push({
      id: `Pain_${tp.key}_${m.key}`,
      section: 'pain',
      label_en: `Pain – ${tp.label_en} – ${m.label_en}`,
      label_ar: `${tp.label_ar} — ${m.label_ar}`,
      type: 'number',
      unit: '/10',
      validate: { min: 0, max: 10, integer: true },
      page: 2,
    });
  }
}

export const FIELDS = [
  // ---------------- Demographics ----------------
  { id: 'Study_ID', section: 'demographics', label_en: 'Study ID', label_ar: 'رقم الدراسة',
    type: 'text', validate: { required: true }, page: 1, isKey: true },
  { id: 'Age', section: 'demographics', label_en: 'Age', label_ar: 'العمر', unit: 'years',
    type: 'number', validate: { required: true, min: 0, max: 100, integer: true }, page: 1 },
  { id: 'Gender', section: 'demographics', label_en: 'Gender', label_ar: 'الجنس',
    type: 'select', options: ['Male', 'Female'], validate: { required: true }, page: 1 },
  { id: 'Residence', section: 'demographics', label_en: 'Residence', label_ar: 'السكن',
    type: 'select', options: ['City', 'Rural'], validate: {}, page: 1 },
  { id: 'Phone_Number', section: 'demographics', label_en: 'Phone Number', label_ar: 'رقم الهاتف',
    type: 'text', validate: {}, page: 1 },

  // ---------------- Indication (single-select on the form) ----------------
  { id: 'Indication_Recurrent_Tonsillitis', section: 'indication', label_en: 'Recurrent tonsillitis',
    label_ar: 'التهاب اللوزتين المتكرر', type: 'boolean', group: 'indication', page: 1 },
  { id: 'Indication_Obstructive_Sleep_Symptoms', section: 'indication', label_en: 'Obstructive sleep symptoms',
    label_ar: 'أعراض انسداد النوم', type: 'boolean', group: 'indication', page: 1 },
  { id: 'Indication_Both', section: 'indication', label_en: 'Both', label_ar: 'كلاهما',
    type: 'boolean', group: 'indication', page: 1 },

  // ---------------- Surgical technique (single-select) ----------------
  { id: 'Surgical_Technique', section: 'technique', label_en: 'Surgical technique', label_ar: 'التقنية الجراحية',
    type: 'select', options: ['Coblation', 'Cold Steel'], validate: { required: true }, page: 1 },

  // ---------------- Blood loss ----------------
  { id: 'Dry_Gauze_Weight_g', section: 'blood_loss', label_en: 'Weight of dry gauze', label_ar: 'وزن الشاش الجاف',
    unit: 'g', type: 'number', validate: { min: 0 }, page: 1 },
  { id: 'Wet_Gauze_Weight_g', section: 'blood_loss', label_en: 'Weight of wet gauze', label_ar: 'وزن الشاش المبلل',
    unit: 'g', type: 'number', validate: { min: 0 }, page: 1 },
  { id: 'Suction_Volume_mL', section: 'blood_loss', label_en: 'Total suction volume', label_ar: 'حجم الشفط الكلي',
    unit: 'mL', type: 'number', validate: { min: 0 }, page: 1 },
  { id: 'Irrigation_Volume_mL', section: 'blood_loss', label_en: 'Irrigation volume', label_ar: 'حجم الغسيل',
    unit: 'mL', type: 'number', validate: { min: 0 }, page: 1 },
  { id: 'Gauze_Blood_Loss_mL', section: 'blood_loss', label_en: 'Gauze blood loss (computed)',
    label_ar: 'فقدان الدم بالشاش (محسوب)', unit: 'mL', type: 'number', computed: true,
    formula: 'Wet_Gauze_Weight_g - Dry_Gauze_Weight_g' },
  { id: 'Estimated_Blood_Loss_mL', section: 'blood_loss', label_en: 'Total estimated blood loss (computed)',
    label_ar: 'إجمالي فقدان الدم المقدر (محسوب)', unit: 'mL', type: 'number', computed: true,
    formula: 'Gauze_Blood_Loss_mL + Suction_Volume_mL - Irrigation_Volume_mL' },

  // ---------------- Operative time ----------------
  { id: 'Operative_Time_Min', section: 'operative_time', label_en: 'Operative time', label_ar: 'مدة العملية',
    unit: 'min', type: 'number', validate: { min: 0, softMax: 180 }, page: 1,
    help_en: 'From gag insertion to gag removal.' },

  // ---------------- Intraoperative complications (multi-select) ----------------
  { id: 'Intraoperative_Complication_None', section: 'intraop_complications', label_en: 'None', label_ar: 'لا يوجد',
    type: 'boolean', group: 'intraop', page: 1 },
  { id: 'Intraoperative_Excessive_Bleeding', section: 'intraop_complications', label_en: 'Excessive bleeding',
    label_ar: 'نزيف شديد', type: 'boolean', group: 'intraop', page: 1 },
  { id: 'Intraoperative_Thermal_or_Surgical_Injury', section: 'intraop_complications',
    label_en: 'Thermal or surgical injury to surrounding structures', label_ar: 'إصابة حرارية أو جراحية للأنسجة المحيطة',
    type: 'boolean', group: 'intraop', page: 1 },

  // ---------------- Post-op exam (multi-select) ----------------
  { id: 'PostOp_Exam_White_Membrane', section: 'postop_exam', label_en: 'White membrane on tonsillar beds',
    label_ar: 'غشاء أبيض على قاع اللوزتين', type: 'boolean', group: 'postop_exam', page: 1 },
  { id: 'PostOp_Exam_Bleeding_Points_or_Clots', section: 'postop_exam', label_en: 'Bleeding points or clots on tonsillar beds',
    label_ar: 'نقاط نزيف أو جلطات على قاع اللوزتين', type: 'boolean', group: 'postop_exam', page: 1 },
  { id: 'PostOp_Exam_Bad_Odor', section: 'postop_exam', label_en: 'Bad odor', label_ar: 'رائحة كريهة',
    type: 'boolean', group: 'postop_exam', page: 1 },
  { id: 'PostOp_Exam_Injury_Any', section: 'postop_exam',
    label_en: 'Injuries to ant. pillars / tongue / uvula / soft palate / tooth (as printed on the form)',
    label_ar: 'إصابات في الدعامة الأمامية/اللسان/اللهاة/الحنك الرخو/السن (كما في النموذج)',
    type: 'boolean', group: 'postop_exam', page: 1,
    help_en: 'This is the one checkbox that actually exists on the form. The five fields below are only filled in if a site is handwritten next to it.' },
  { id: 'PostOp_Exam_Anterior_Pillar_Injury', section: 'postop_exam', label_en: 'Anterior pillar injury (if site specified)',
    label_ar: 'إصابة الدعامة الأمامية', type: 'boolean', group: 'postop_exam_site', page: 1 },
  { id: 'PostOp_Exam_Tongue_Injury', section: 'postop_exam', label_en: 'Tongue injury (if site specified)',
    label_ar: 'إصابة اللسان', type: 'boolean', group: 'postop_exam_site', page: 1 },
  { id: 'PostOp_Exam_Uvula_Injury', section: 'postop_exam', label_en: 'Uvula injury (if site specified)',
    label_ar: 'إصابة اللهاة', type: 'boolean', group: 'postop_exam_site', page: 1 },
  { id: 'PostOp_Exam_Soft_Palate_Injury', section: 'postop_exam', label_en: 'Soft palate injury (if site specified)',
    label_ar: 'إصابة الحنك الرخو', type: 'boolean', group: 'postop_exam_site', page: 1 },
  { id: 'PostOp_Exam_Tooth_Injury', section: 'postop_exam', label_en: 'Tooth injury (if site specified)',
    label_ar: 'إصابة السن', type: 'boolean', group: 'postop_exam_site', page: 1 },

  // ---------------- Hemorrhage ----------------
  { id: 'Primary_Hemorrhage', section: 'hemorrhage', label_en: 'Primary hemorrhage (within 24h)',
    label_ar: 'نزيف أولي (خلال ٢٤ ساعة)', type: 'boolean', group: 'hemorrhage', page: 1 },
  { id: 'Secondary_Hemorrhage', section: 'hemorrhage', label_en: 'Secondary hemorrhage (after 24h)',
    label_ar: 'نزيف ثانوي (بعد ٢٤ ساعة)', type: 'boolean', group: 'hemorrhage', page: 1 },
  { id: 'Hemorrhage_None', section: 'hemorrhage', label_en: 'No hemorrhage (computed)', label_ar: 'لا يوجد نزيف (محسوب)',
    type: 'boolean', computed: true, formula: '!Primary_Hemorrhage && !Secondary_Hemorrhage' },
  { id: 'Need_Admission', section: 'hemorrhage', label_en: 'Need for admission', label_ar: 'الحاجة إلى الدخول',
    type: 'boolean', page: 1 },
  { id: 'Reoperation', section: 'hemorrhage', label_en: 'Re-operation', label_ar: 'إعادة العملية',
    type: 'boolean', page: 1 },
  { id: 'Transfusion', section: 'hemorrhage', label_en: 'Transfusion', label_ar: 'نقل الدم',
    type: 'boolean', page: 1 },
  { id: 'Other_Complications', section: 'hemorrhage', label_en: 'Other complications', label_ar: 'مضاعفات أخرى',
    type: 'text', page: 1 },

  // ---------------- Pain table (generated above) ----------------
  ...painFields,

  // ---------------- Recovery ----------------
  { id: 'Day_Stopped_Analgesia', section: 'recovery', label_en: 'Day stopped analgesia',
    label_ar: 'اليوم الذي توقف فيه عن المسكنات', type: 'number', validate: { min: 0 }, page: 2 },
  { id: 'Day_Pain_Free', section: 'recovery', label_en: 'Day/date completely pain free',
    label_ar: 'اليوم الذي أصبح فيه بلا ألم نهائياً', type: 'text', page: 2 },
  { id: 'Day_Tolerate_Liquids', section: 'recovery', label_en: 'Day could tolerate liquids without pain',
    label_ar: 'اليوم الذي تحمل فيه السوائل بلا ألم', type: 'number', validate: { min: 0 }, page: 2 },
  { id: 'Day_Tolerate_Solids', section: 'recovery', label_en: 'Day could tolerate solids without pain',
    label_ar: 'اليوم الذي تحمل فيه الطعام الصلب بلا ألم', type: 'number', validate: { min: 0 }, page: 2 },
  { id: 'Day_Return_School_Work', section: 'recovery', label_en: 'Day returned to school/work',
    label_ar: 'اليوم الذي عاد فيه للمدرسة/العمل', type: 'number', validate: { min: 0 }, page: 2 },

  // ---------------- Satisfaction ----------------
  { id: 'Patient_Parent_Satisfaction', section: 'satisfaction', label_en: 'Patient/parent satisfaction',
    label_ar: 'رضى المريض والأبوين', type: 'select',
    options: ['Very satisfied', 'Satisfied', 'Not satisfied'], page: 2 },
];

// Fields the AI is actually asked to read off the page (excludes computed fields)
export const EXTRACTABLE_FIELDS = FIELDS.filter(f => !f.computed);

// Checkbox groups where only ONE option should end up true (radio-button semantics)
export const EXCLUSIVE_GROUPS = ['indication'];
// Checkbox groups where MANY options may be true at once
export const MULTI_GROUPS = ['intraop', 'postop_exam', 'postop_exam_site', 'hemorrhage'];

// System/audit columns appended to every row, not shown in the review form
export const SYSTEM_FIELDS = [
  'Extraction_Confidence', 'Reviewed_By_User', 'Date_Added',
];

// Final Excel column order (spec order, with the two documented departures)
export const EXCEL_COLUMNS = [
  ...FIELDS.map(f => f.id),
  ...SYSTEM_FIELDS,
];

export function getField(id) {
  return FIELDS.find(f => f.id === id);
}

export function fieldsBySection(sectionId) {
  return FIELDS.filter(f => f.section === sectionId && !f.computed);
}
