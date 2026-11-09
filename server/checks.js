// =============================================================
// HugoMed - ukaguzi wa ziara (msingi wa Claims Pre-Audit)
// Unaangalia makosa ya kitabibu na ya madai wakati daktari anaandika.
// Unatumika na skrini ya daktari sasa, na na madai ya bima baadaye.
//
// Kila finding: { code, severity: 'error'|'warning', message }
// Mfumo unakamata makosa tu; haubadilishi chochote wenyewe.
// =============================================================

const db = require('./db');

const COUNTABLE_UNITS = ['tab', 'cap', 'sachet'];
const ANTIMALARIALS = ['artemether', 'lumefantrine', 'artesunate', 'quinine', 'dihydroartemisinin', 'amodiaquine'];
const MALARIA_TESTS = ['malaria', 'mrdt', 'blood slide', ' bs '];
const PREGNANCY_TESTS = ['ujauzito', 'pregnancy', 'upt', 'hcg'];

// Makundi ya mzio: neno la mzio -> majina ya dawa za kundi hilo
const ALLERGY_GROUPS = [
  { words: ['penicillin', 'penisilini'], drugs: ['penicillin', 'amoxicillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'augmentin', 'amoxiclav', 'clavulan'] },
  { words: ['sulfa', 'sulpha', 'cotrimoxazole', 'septrin'], drugs: ['cotrimoxazole', 'sulfamethoxazole', 'sulphadoxine', 'sulfadoxine', 'septrin', 'bactrim'] },
  { words: ['nsaid', 'aspirin', 'ibuprofen', 'diclofenac'], drugs: ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'indomethacin'] },
  { words: ['quinine'], drugs: ['quinine'] }
];

function has(text, words) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  return words.some((w) => t.includes(w));
}

function isPositive(result) {
  const r = String(result || '').toLowerCase();
  if (!r) return null;
  if (r.includes('negative') || r.includes('neg')) return false;
  if (r.includes('positive') || r.includes('pos') || r.includes('+') || r.includes('pf')) return true;
  return null;
}

async function runChecks(tenantId, visitId) {
  const v = await db.query(
    `SELECT v.*, py.type AS payer_type, py.name AS payer_name,
            p.sex, p.date_of_birth, p.allergies,
            pp.last_verified_at, pp.valid_until,
            d.full_name AS doctor_name, d.professional_reg_no, d.license_expiry
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       LEFT JOIN payers py ON py.id = v.payer_id
       LEFT JOIN patient_payers pp ON pp.id = v.patient_payer_id
       LEFT JOIN users d ON d.id = v.assigned_doctor_id
      WHERE v.id = $1 AND v.tenant_id = $2`,
    [visitId, tenantId]
  );
  const visit = v.rows[0];
  if (!visit) return null;

  const [dx, orders] = await Promise.all([
    db.query('SELECT icd10_code, description FROM diagnoses WHERE visit_id = $1', [visitId]),
    db.query(
      `SELECT o.*, s.name, s.category, s.unit, s.code,
              (SELECT lr.result FROM lab_results lr WHERE lr.order_id = o.id AND lr.verified_at IS NOT NULL ORDER BY lr.id DESC LIMIT 1) AS result
         FROM orders o JOIN services s ON s.id = o.service_id
        WHERE o.visit_id = $1 AND o.status <> 'cancelled'`,
      [visitId]
    )
  ]);

  const drugs = orders.rows.filter((o) => o.type === 'drug');
  const labs = orders.rows.filter((o) => o.type === 'lab');
  const insured = visit.payer_type && visit.payer_type !== 'cash';

  const findings = [];
  const passed = [];
  let total = 0;

  function rule(name, failures) {
    total += 1;
    if (failures.length) findings.push(...failures);
    else passed.push(name);
  }

  // 1. Diagnosis
  rule('Diagnosis ipo', dx.rows.length ? [] : [{ code: 'DX_REQUIRED', severity: 'error', message: 'Hakuna diagnosis (ICD-10). Ongeza angalau moja.' }]);

  // 2. Dozi na idadi ya dawa
  if (drugs.length) {
    const qty = [];
    const incomplete = [];
    drugs.forEach((o) => {
      if (!COUNTABLE_UNITS.includes(o.unit)) return;
      if (!o.dose_units || !o.frequency_per_day || !o.days) {
        incomplete.push({ code: 'DOSE_INCOMPLETE', severity: 'warning', message: o.name + ': dozi, mara kwa siku au idadi ya siku haijajazwa.' });
        return;
      }
      const expected = Number(o.dose_units) * Number(o.frequency_per_day) * Number(o.days);
      if (Math.abs(expected - Number(o.quantity)) > 0.001) {
        qty.push({
          code: 'DOSE_QTY', severity: 'error',
          message: o.name + ': ' + Number(o.dose_units) + ' × ' + o.frequency_per_day + ' × siku ' + o.days + ' = ' + expected + ', lakini idadi iliyoandikwa ni ' + Number(o.quantity) + '.'
        });
      }
    });
    rule('Dozi na idadi zinalingana', qty);

    // Dawa ileile imeandikwa zaidi ya mara moja
    const seen = {};
    const dups = [];
    drugs.forEach((o) => {
      if (seen[o.service_id]) dups.push({ code: 'DUPLICATE_DRUG', severity: 'error', message: o.name + ' imeandikwa zaidi ya mara moja kwenye ziara hii. Ondoa moja.' });
      seen[o.service_id] = true;
    });
    rule('Hakuna dawa iliyorudiwa', dups);
    rule('Maelekezo ya dawa yamekamilika', incomplete);
  }

  // 3. Mzio
  if (drugs.length && visit.allergies) {
    const clash = [];
    const uniqueDrugs = drugs.filter((o, i) => drugs.findIndex((x) => x.service_id === o.service_id) === i);
    uniqueDrugs.forEach((o) => {
      const name = o.name.toLowerCase();
      ALLERGY_GROUPS.forEach((g) => {
        if (has(visit.allergies, g.words) && g.drugs.some((d) => name.includes(d))) {
          clash.push({ code: 'ALLERGY', severity: 'error', message: o.name + ' inagongana na mzio wa mgonjwa (' + visit.allergies + ').' });
        }
      });
      // Jina la dawa limeandikwa moja kwa moja kwenye mzio
      const first = name.split(/[\s/]/)[0];
      if (first.length > 3 && String(visit.allergies).toLowerCase().includes(first) && !clash.some((c) => c.message.startsWith(o.name))) {
        clash.push({ code: 'ALLERGY', severity: 'error', message: o.name + ' imeandikwa kwenye mzio wa mgonjwa (' + visit.allergies + ').' });
      }
    });
    rule('Hakuna mgongano na mzio', clash);
  }

  // 4. Dawa ya malaria bila kipimo cha malaria
  if (drugs.some((o) => has(o.name, ANTIMALARIALS))) {
    const tests = labs.filter((o) => has(' ' + o.name + ' ', MALARIA_TESTS) || ['LAB-MRDT', 'LAB-BS'].includes(o.code));
    const out = [];
    if (!tests.length) {
      out.push({ code: 'MALARIA_TEST', severity: 'warning', message: 'Dawa ya malaria imeandikwa bila kipimo cha malaria (mRDT au BS).' });
    } else {
      const results = tests.map((t) => isPositive(t.result));
      if (results.every((r) => r === false)) {
        out.push({ code: 'MALARIA_NEGATIVE', severity: 'error', message: 'Kipimo cha malaria ni negative, lakini dawa ya malaria imeandikwa.' });
      } else if (results.every((r) => r === null)) {
        out.push({ code: 'MALARIA_PENDING', severity: 'warning', message: 'Matokeo ya kipimo cha malaria bado hayajahakikiwa.' });
      }
    }
    rule('Dawa ya malaria ina kipimo', out);
  }

  // 5. Jinsia na vipimo / diagnosis
  {
    const out = [];
    if (visit.sex === 'M') {
      labs.filter((o) => has(o.name, PREGNANCY_TESTS)).forEach((o) => out.push({ code: 'SEX_MISMATCH', severity: 'error', message: o.name + ' kwa mgonjwa wa kiume.' }));
      dx.rows.filter((d) => d.icd10_code.startsWith('O')).forEach((d) => out.push({ code: 'SEX_MISMATCH', severity: 'error', message: 'Diagnosis ya ujauzito (' + d.icd10_code + ') kwa mgonjwa wa kiume.' }));
    }
    if (visit.sex === 'F') {
      labs.filter((o) => has(o.name, ['psa'])).forEach((o) => out.push({ code: 'SEX_MISMATCH', severity: 'error', message: o.name + ' kwa mgonjwa wa kike.' }));
      dx.rows.filter((d) => d.icd10_code.startsWith('N40')).forEach((d) => out.push({ code: 'SEX_MISMATCH', severity: 'error', message: 'Diagnosis ya tezi dume (' + d.icd10_code + ') kwa mgonjwa wa kike.' }));
    }
    rule('Vipimo vinalingana na jinsia', out);
  }

  // 6. Daktari wa ziara (madai ya bima yanahitaji daktari na namba yake)
  if (insured && !visit.assigned_doctor_id) {
    rule('Daktari amerekodiwa', [{ code: 'NO_DOCTOR', severity: 'error', message: 'Ziara haina daktari aliyerekodiwa. Dai la ' + visit.payer_name + ' linahitaji daktari na namba yake ya usajili.' }]);
  }
  if (visit.assigned_doctor_id) {
    const out = [];
    if (visit.license_expiry && new Date(visit.license_expiry) < new Date(new Date().toDateString())) {
      out.push({ code: 'LICENSE_EXPIRED', severity: 'error', message: 'Leseni ya ' + visit.doctor_name + ' imeisha. Wasiliana na Admin wa hospitali.' });
    }
    if (insured && !visit.professional_reg_no) {
      out.push({ code: 'DOCTOR_REG', severity: 'warning', message: 'Namba ya usajili wa kitaaluma ya ' + visit.doctor_name + ' haipo. Inahitajika kwenye dai la ' + visit.payer_name + '.' });
    }
    rule('Taarifa za daktari zimekamilika', out);
  }

  // 7. NHIF: kila huduma inayodaiwa iwe na item code
  if (visit.payer_type === 'nhif') {
    const items = await db.query(
      `SELECT ii.description FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
        WHERE inv.visit_id = $1 AND ii.payer_amount > 0 AND (ii.payer_item_code IS NULL OR ii.payer_item_code = '')`,
      [visitId]
    );
    rule('Huduma zina NHIF item code', items.rows.map((r) => ({ code: 'ITEM_CODE', severity: 'error', message: r.description + ': haina NHIF item code. Iweke kwenye Price lists, kisha "Kagua upya".' })));
  }

  // 8. Kadi ya bima imehakikiwa siku ya ziara
  if (insured) {
    const out = [];
    const arrived = new Date(visit.arrived_at).toDateString();
    if (!visit.last_verified_at || new Date(visit.last_verified_at).toDateString() !== arrived) {
      out.push({ code: 'CARD_NOT_VERIFIED', severity: 'warning', message: 'Kadi ya ' + visit.payer_name + ' haikuhakikiwa siku ya ziara.' });
    }
    rule('Kadi imehakikiwa', out);
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  return {
    payer_type: visit.payer_type || 'cash',
    payer_name: visit.payer_name || 'Cash',
    findings,
    passed,
    errors,
    warnings,
    score: total ? Math.round((passed.length / total) * 100) : 100
  };
}

module.exports = { runChecks };
