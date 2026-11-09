// =============================================================
// HugoMed - Daktari (OPD)
//   GET    /api/opd/icd10?q=                         kutafuta ICD-10
//   GET    /api/opd/visits/:id                       kila kitu cha ziara + EMR + ukaguzi
//   PUT    /api/opd/visits/:id/note                  clinical notes, rufaa, kurudi
//   POST   /api/opd/visits/:id/diagnoses             kuongeza diagnosis
//   DELETE /api/opd/visits/:id/diagnoses/:did        kuondoa diagnosis
//   POST   /api/opd/visits/:id/orders                kuagiza kipimo / dawa / huduma
//   DELETE /api/opd/visits/:id/orders/:oid           kuondoa agizo (kama halijaanza)
//   POST   /api/opd/visits/:id/finish                kumaliza na kumpeleka hatua inayofuata
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const icd10 = require('./icd10');
const { runChecks } = require('./checks');
const { moveStage } = require('./visits');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('doctor', 'hospital_admin', 'nurse'));
const DOCTORS = ['doctor', 'hospital_admin'];
const ACTIVE = ['doctor', 'results', 'admitted'];

router.get('/icd10', (req, res) => {
  res.json({ status: 'ok', items: icd10.search(req.query.q) });
});

// Ziara ya hospitali hii, au 404
async function getVisit(req, res) {
  const { rows } = await db.query('SELECT * FROM visits WHERE id = $1 AND tenant_id = $2', [Number(req.params.id), req.user.tenant_id]);
  if (!rows[0]) {
    res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
    return null;
  }
  return rows[0];
}

// Ziara iwe iko kwa daktari ili kuandika
async function getActiveVisit(req, res) {
  const visit = await getVisit(req, res);
  if (!visit) return null;
  if (!ACTIVE.includes(visit.stage)) {
    res.status(400).json({ status: 'error', message: 'Mgonjwa huyu hayuko kwa daktari sasa (' + visit.stage + ').' });
    return null;
  }
  // Daktari anayeandika kwenye ziara isiyo na daktari anarekodiwa kama daktari wake
  if (req.user.role === 'doctor' && !visit.assigned_doctor_id) {
    await db.query('UPDATE visits SET assigned_doctor_id = $1 WHERE id = $2', [req.user.id, visit.id]);
    visit.assigned_doctor_id = req.user.id;
  }
  return visit;
}

// ---------- Kila kitu cha ziara ----------
router.get('/visits/:id', asyncHandler(async (req, res) => {
  let visit = await getVisit(req, res);
  if (!visit) return;

  // Daktari akifungua mgonjwa ambaye hana daktari, anamchukua
  if (req.user.role === 'doctor' && !visit.assigned_doctor_id && ACTIVE.includes(visit.stage)) {
    await db.query('UPDATE visits SET assigned_doctor_id = $1 WHERE id = $2', [req.user.id, visit.id]);
    visit.assigned_doctor_id = req.user.id;
  }

  const tenant = req.user.tenant_id;
  const [patient, payer, doctor, vitals, note, dx, orders, history, checks] = await Promise.all([
    db.query('SELECT * FROM patients WHERE id = $1', [visit.patient_id]),
    db.query('SELECT name, type FROM payers WHERE id = $1', [visit.payer_id]),
    db.query('SELECT full_name FROM users WHERE id = $1', [visit.assigned_doctor_id]),
    db.query('SELECT * FROM vitals WHERE visit_id = $1 ORDER BY recorded_at DESC LIMIT 1', [visit.id]),
    db.query('SELECT * FROM clinical_notes WHERE visit_id = $1 ORDER BY id DESC LIMIT 1', [visit.id]),
    db.query('SELECT * FROM diagnoses WHERE visit_id = $1 ORDER BY id', [visit.id]),
    db.query(
      `SELECT o.*, s.name, s.category, s.unit, s.code,
              lr.result, lr.verified_at
         FROM orders o JOIN services s ON s.id = o.service_id
         LEFT JOIN LATERAL (SELECT result, verified_at FROM lab_results WHERE order_id = o.id ORDER BY id DESC LIMIT 1) lr ON TRUE
        WHERE o.visit_id = $1 AND o.status <> 'cancelled'
        ORDER BY o.type, o.id`,
      [visit.id]
    ),
    db.query(
      `SELECT v.id, v.arrived_at, v.department, v.stage, py.name AS payer_name, u.full_name AS doctor_name,
              COALESCE((SELECT json_agg(json_build_object('code', d.icd10_code, 'description', d.description)) FROM diagnoses d WHERE d.visit_id = v.id), '[]'::json) AS diagnoses,
              COALESCE((SELECT json_agg(json_build_object('name', s.name, 'type', o.type, 'quantity', o.quantity, 'result', (SELECT lr.result FROM lab_results lr WHERE lr.order_id = o.id AND lr.verified_at IS NOT NULL ORDER BY lr.id DESC LIMIT 1)))
                          FROM orders o JOIN services s ON s.id = o.service_id WHERE o.visit_id = v.id AND o.status <> 'cancelled'), '[]'::json) AS orders,
              (SELECT cn.notes FROM clinical_notes cn WHERE cn.visit_id = v.id ORDER BY cn.id DESC LIMIT 1) AS notes
         FROM visits v
         LEFT JOIN payers py ON py.id = v.payer_id
         LEFT JOIN users u ON u.id = v.assigned_doctor_id
        WHERE v.patient_id = $1 AND v.tenant_id = $2 AND v.id <> $3 AND v.stage <> 'cancelled'
        ORDER BY v.arrived_at DESC LIMIT 10`,
      [visit.patient_id, tenant, visit.id]
    ),
    runChecks(tenant, visit.id)
  ]);

  res.json({
    status: 'ok',
    visit: Object.assign(visit, {
      payer_name: payer.rows[0] ? payer.rows[0].name : 'Cash',
      payer_type: payer.rows[0] ? payer.rows[0].type : 'cash',
      doctor_name: doctor.rows[0] ? doctor.rows[0].full_name : null
    }),
    patient: patient.rows[0],
    vitals: vitals.rows[0] || null,
    note: note.rows[0] || null,
    diagnoses: dx.rows,
    orders: orders.rows,
    history: history.rows,
    checks
  });
}));

// ---------- Clinical notes ----------
router.put('/visits/:id/note', requireRole(...DOCTORS), asyncHandler(async (req, res) => {
  const visit = await getActiveVisit(req, res);
  if (!visit) return;
  const b = req.body || {};
  const existing = await db.query('SELECT id FROM clinical_notes WHERE visit_id = $1 ORDER BY id DESC LIMIT 1', [visit.id]);
  const vals = [b.complaint || null, b.notes || null, b.referral || null, b.follow_up_date || null];
  if (existing.rows[0]) {
    await db.query(
      `UPDATE clinical_notes SET complaint = $1, notes = $2, referral = $3, follow_up_date = $4, doctor_id = $5 WHERE id = $6`,
      [...vals, req.user.id, existing.rows[0].id]
    );
  } else {
    await db.query(
      `INSERT INTO clinical_notes (tenant_id, visit_id, complaint, notes, referral, follow_up_date, doctor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [visit.tenant_id, visit.id, ...vals, req.user.id]
    );
  }
  res.json({ status: 'ok', message: 'Notes zimehifadhiwa.' });
}));

// ---------- Diagnosis ----------
router.post('/visits/:id/diagnoses', requireRole(...DOCTORS), asyncHandler(async (req, res) => {
  const visit = await getActiveVisit(req, res);
  if (!visit) return;
  const code = String((req.body && req.body.icd10_code) || '').trim().toUpperCase();
  if (!icd10.ICD10_PATTERN.test(code)) {
    return res.status(400).json({ status: 'error', message: 'Code ya ICD-10 si sahihi. Mfano sahihi: B50.9, I10, O80.' });
  }
  const dup = await db.query('SELECT 1 FROM diagnoses WHERE visit_id = $1 AND icd10_code = $2', [visit.id, code]);
  if (dup.rows.length) return res.status(409).json({ status: 'error', message: code + ' tayari imeongezwa.' });

  const description = String(req.body.description || '').trim() || icd10.lookup(code) || null;
  const { rows } = await db.query(
    `INSERT INTO diagnoses (tenant_id, visit_id, icd10_code, description, is_provisional, doctor_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [visit.tenant_id, visit.id, code, description, req.body.is_provisional === true, req.user.id]
  );
  await audit.log(req, 'add_diagnosis', { entity: 'visits', entityId: visit.id, after: { code, description } });
  res.status(201).json({ status: 'ok', diagnosis: rows[0] });
}));

router.delete('/visits/:id/diagnoses/:did', requireRole(...DOCTORS), asyncHandler(async (req, res) => {
  const visit = await getActiveVisit(req, res);
  if (!visit) return;
  const { rows } = await db.query('DELETE FROM diagnoses WHERE id = $1 AND visit_id = $2 RETURNING icd10_code', [Number(req.params.did), visit.id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Diagnosis haipo.' });
  await audit.log(req, 'remove_diagnosis', { entity: 'visits', entityId: visit.id, before: { code: rows[0].icd10_code } });
  res.json({ status: 'ok' });
}));

// ---------- Maagizo ----------
function positive(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

router.post('/visits/:id/orders', requireRole(...DOCTORS), asyncHandler(async (req, res) => {
  const visit = await getActiveVisit(req, res);
  if (!visit) return;
  const b = req.body || {};
  const svc = await db.query('SELECT * FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE', [b.service_id, visit.tenant_id]);
  const service = svc.rows[0];
  if (!service) return res.status(400).json({ status: 'error', message: 'Chagua kipimo, dawa au huduma kutoka kwenye orodha.' });

  const typeMap = { lab: 'lab', drug: 'drug', procedure: 'procedure', radiology: 'radiology', consultation: 'consultation' };
  const type = typeMap[service.category] || 'procedure';

  let doseUnits = null, freq = null, days = null, quantity = positive(b.quantity);
  if (type === 'drug') {
    doseUnits = positive(b.dose_units);
    freq = positive(b.frequency_per_day);
    days = positive(b.days);
    if ([doseUnits, freq, days, quantity].some(Number.isNaN)) {
      return res.status(400).json({ status: 'error', message: 'Dozi, mara kwa siku, siku na idadi viwe namba kubwa kuliko sifuri.' });
    }
    // Idadi isipoandikwa, mfumo unaihesabu
    if (quantity === null && doseUnits && freq && days) quantity = doseUnits * freq * days;
  }
  if (Number.isNaN(quantity)) return res.status(400).json({ status: 'error', message: 'Idadi si sahihi.' });
  if (quantity === null) quantity = 1;

  if (type !== 'drug') {
    const dup = await db.query("SELECT 1 FROM orders WHERE visit_id = $1 AND service_id = $2 AND status <> 'cancelled'", [visit.id, service.id]);
    if (dup.rows.length) return res.status(409).json({ status: 'error', message: service.name + ' tayari kimeagizwa kwenye ziara hii.' });
  }

  const { rows } = await db.query(
    `INSERT INTO orders (tenant_id, visit_id, service_id, type, dose, dose_units, frequency_per_day, days, quantity, instructions, ordered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [visit.tenant_id, visit.id, service.id, type, b.dose || null, doseUnits, freq ? Math.round(freq) : null, days ? Math.round(days) : null, quantity, b.instructions || null, req.user.id]
  );
  await audit.log(req, 'create_order', { entity: 'visits', entityId: visit.id, after: { service: service.name, quantity, dose_units: doseUnits, frequency_per_day: freq, days } });
  res.status(201).json({ status: 'ok', order: rows[0] });
}));

router.delete('/visits/:id/orders/:oid', requireRole(...DOCTORS), asyncHandler(async (req, res) => {
  const visit = await getActiveVisit(req, res);
  if (!visit) return;
  const { rows } = await db.query('SELECT o.*, s.name FROM orders o JOIN services s ON s.id = o.service_id WHERE o.id = $1 AND o.visit_id = $2', [Number(req.params.oid), visit.id]);
  const order = rows[0];
  if (!order) return res.status(404).json({ status: 'error', message: 'Agizo halipo.' });
  if (order.status !== 'ordered') return res.status(400).json({ status: 'error', message: order.name + ' tayari kimeanza kushughulikiwa; hakiwezi kuondolewa.' });
  await db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
  await audit.log(req, 'cancel_order', { entity: 'visits', entityId: visit.id, before: { service: order.name, quantity: order.quantity } });
  res.json({ status: 'ok' });
}));

// ---------- Kumaliza ----------
router.post('/visits/:id/finish', requireRole(...DOCTORS), asyncHandler(async (req, res) => {
  const visit = await getActiveVisit(req, res);
  if (!visit) return;
  if (visit.stage === 'admitted') {
    return res.status(400).json({ status: 'error', message: 'Mgonjwa amelazwa. Tumia "Discharge" kwenye ukurasa wa IPD.' });
  }

  const checks = await runChecks(visit.tenant_id, visit.id);
  if (checks.findings.some((f) => f.code === 'DX_REQUIRED')) {
    return res.status(400).json({ status: 'error', message: 'Ongeza angalau diagnosis moja kabla ya kumaliza.' });
  }
  const errors = checks.findings.filter((f) => f.severity === 'error');
  const override = String((req.body && req.body.override_reason) || '').trim();
  if (errors.length && !override) {
    return res.status(400).json({
      status: 'error',
      code: 'has_errors',
      message: 'Kuna makosa ' + errors.length + ' ya ukaguzi. Yarekebishe, au andika sababu ya kitabibu ya kuendelea.',
      findings: errors
    });
  }

  const pending = await db.query("SELECT COUNT(*)::int AS n FROM orders WHERE visit_id = $1 AND type IN ('lab', 'radiology') AND status IN ('ordered', 'paid', 'in_progress')", [visit.id]);
  const next = pending.rows[0].n > 0 ? 'lab' : 'billing';
  const note = next === 'lab' ? 'Amepelekwa maabara' : 'Daktari amemaliza';

  await db.transaction(async (client) => {
    await moveStage(client, visit, next, req.user.id, override ? note + ' · Sababu ya kuendelea licha ya makosa: ' + override : note);
  });
  await audit.log(req, 'finish_consultation', {
    entity: 'visits', entityId: visit.id,
    before: { stage: visit.stage },
    after: { stage: next, score: checks.score, errors: errors.length, override_reason: override || undefined }
  });

  const label = next === 'lab' ? 'Mgonjwa amepelekwa maabara. Matokeo yakihakikiwa, atarudi kwako.' : 'Mgonjwa amepelekwa malipo.';
  res.json({ status: 'ok', next, message: label });
}));

module.exports = router;
