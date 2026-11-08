// =============================================================
// HugoMed - ziara na safari ya mgonjwa (foleni, token, triage)
//   GET  /api/visits?stage=triage           foleni ya leo (au hatua moja)
//   GET  /api/visits/meta/doctors           madaktari walio hai
//   GET  /api/visits/:id                    ziara moja (mgonjwa, vitals, hatua)
//   POST /api/visits                        kuanza ziara na kutoa token
//   POST /api/visits/:id/vitals             triage: vitals, kisha kwa daktari
//   POST /api/visits/:id/cancel             kusitisha ziara
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer'));

const TZ = 'Africa/Dar_es_Salaam';
const TODAY = `(v.arrived_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`;
const STAGES = ['reception', 'triage', 'doctor', 'lab', 'results', 'billing', 'pharmacy', 'completed', 'cancelled'];
const PRIORITIES = ['normal', 'urgent', 'emergency'];
const OPEN = "v.stage NOT IN ('completed', 'cancelled')";

// Kuhamisha ziara hatua nyingine na kurekodi muda wake
async function moveStage(client, visit, stage, userId, note) {
  await client.query(
    `UPDATE visits SET stage = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END WHERE id = $2`,
    [stage, visit.id]
  );
  await client.query(
    'INSERT INTO visit_events (tenant_id, visit_id, stage, user_id, note) VALUES ($1, $2, $3, $4, $5)',
    [visit.tenant_id, visit.id, stage, userId, note || null]
  );
}

const LIST_SQL = `
  SELECT v.id, v.visit_no, v.token, v.department, v.priority, v.stage, v.arrived_at,
         v.patient_id, v.assigned_doctor_id,
         p.mrn, p.first_name, p.middle_name, p.last_name, p.sex, p.date_of_birth, p.phone, p.allergies,
         py.name AS payer_name, py.type AS payer_type,
         d.full_name AS doctor_name,
         ev.stage_since,
         FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ev.stage_since, v.arrived_at))) / 60)::int AS waiting_minutes
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
    LEFT JOIN payers py ON py.id = v.payer_id
    LEFT JOIN users d ON d.id = v.assigned_doctor_id
    LEFT JOIN LATERAL (SELECT MAX(e.at) AS stage_since FROM visit_events e WHERE e.visit_id = v.id) ev ON TRUE`;

const ORDER = `ORDER BY CASE WHEN v.stage IN ('completed', 'cancelled') THEN 1 ELSE 0 END, CASE v.priority WHEN 'emergency' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END, v.arrived_at`;

// ---------- Foleni ----------
router.get('/', asyncHandler(async (req, res) => {
  const params = [req.user.tenant_id];
  let where = `v.tenant_id = $1 AND (${TODAY} OR ${OPEN})`;
  if (req.query.stage && STAGES.includes(req.query.stage)) {
    params.push(req.query.stage);
    where += ` AND v.stage = $${params.length}`;
  }
  if (req.query.mine === '1' && req.user.role === 'doctor') {
    params.push(req.user.id);
    where += ` AND (v.assigned_doctor_id = $${params.length} OR v.assigned_doctor_id IS NULL)`;
  }
  const { rows } = await db.query(`${LIST_SQL} WHERE ${where} ${ORDER}`, params);

  const counts = await db.query(
    `SELECT v.stage, COUNT(*)::int AS n FROM visits v WHERE v.tenant_id = $1 AND (${TODAY} OR ${OPEN}) GROUP BY v.stage`,
    [req.user.tenant_id]
  );
  const byStage = {};
  counts.rows.forEach((r) => { byStage[r.stage] = r.n; });
  res.json({ status: 'ok', items: rows, counts: byStage });
}));

router.get('/meta/doctors', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, full_name FROM users WHERE tenant_id = $1 AND role = 'doctor' AND is_active = TRUE ORDER BY full_name`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

// ---------- Ziara moja ----------
router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`${LIST_SQL} WHERE v.id = $1 AND v.tenant_id = $2`, [Number(req.params.id), req.user.tenant_id]);
  const visit = rows[0];
  if (!visit) return res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
  const [vitals, events, patient] = await Promise.all([
    db.query('SELECT * FROM vitals WHERE visit_id = $1 ORDER BY recorded_at DESC LIMIT 1', [visit.id]),
    db.query(
      `SELECT e.stage, e.at, e.note, u.full_name AS user_name FROM visit_events e
         LEFT JOIN users u ON u.id = e.user_id WHERE e.visit_id = $1 ORDER BY e.at`,
      [visit.id]
    ),
    db.query('SELECT chronic_conditions FROM patients WHERE id = $1', [visit.patient_id])
  ]);
  visit.chronic_conditions = patient.rows[0] ? patient.rows[0].chronic_conditions : null;
  res.json({ status: 'ok', visit, vitals: vitals.rows[0] || null, events: events.rows });
}));

// ---------- Kuanza ziara ----------
router.post('/', requireRole('hospital_admin', 'receptionist', 'nurse'), asyncHandler(async (req, res) => {
  const tenant = req.user.tenant_id;
  const b = req.body || {};

  const pt = await db.query('SELECT id, first_name, last_name FROM patients WHERE id = $1 AND tenant_id = $2', [b.patient_id, tenant]);
  const patient = pt.rows[0];
  if (!patient) return res.status(404).json({ status: 'error', message: 'Mgonjwa hayupo.' });

  // Mlipaji wa ziara hii
  let payerId = null;
  let patientPayerId = null;
  if (b.patient_payer_id) {
    const pp = await db.query(
      `SELECT pp.*, py.is_active, py.name FROM patient_payers pp JOIN payers py ON py.id = pp.payer_id
        WHERE pp.id = $1 AND pp.patient_id = $2 AND pp.tenant_id = $3`,
      [b.patient_payer_id, patient.id, tenant]
    );
    const row = pp.rows[0];
    if (!row) return res.status(400).json({ status: 'error', message: 'Kadi ya mlipaji haipo kwa mgonjwa huyu.' });
    if (!row.is_active) return res.status(400).json({ status: 'error', message: row.name + ' imezimwa na hospitali.' });
    if (row.valid_until && new Date(row.valid_until) < new Date(new Date().toDateString())) {
      return res.status(400).json({ status: 'error', message: 'Kadi ya ' + row.name + ' imeisha muda. Mgonjwa alipe cash au alete kadi hai.' });
    }
    payerId = row.payer_id;
    patientPayerId = row.id;
  } else {
    const cash = await db.query("SELECT id FROM payers WHERE tenant_id = $1 AND type = 'cash' LIMIT 1", [tenant]);
    payerId = cash.rows[0] ? cash.rows[0].id : null;
  }

  // Mgonjwa asiwe na ziara mbili zilizo wazi kwa wakati mmoja
  const open = await db.query(`SELECT v.token FROM visits v WHERE v.patient_id = $1 AND ${OPEN}`, [patient.id]);
  if (open.rows.length) {
    return res.status(409).json({ status: 'error', message: 'Mgonjwa huyu tayari ana ziara iliyo wazi (token ' + open.rows[0].token + ').' });
  }

  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  const department = String(b.department || 'OPD').slice(0, 60);

  const visit = await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2000, $1)', [tenant]);
    const seq = await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM visits v WHERE v.tenant_id = $1 AND ${TODAY}`,
      [tenant]
    );
    const n = seq.rows[0].n;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    const ymd = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const token = (priority === 'emergency' ? 'E-' : 'A-') + String(n).padStart(3, '0');
    const visitNo = 'V' + ymd + '-' + String(n).padStart(4, '0');

    const ins = await client.query(
      `INSERT INTO visits (tenant_id, patient_id, visit_no, payer_id, patient_payer_id, department, token, priority, stage, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reception', $9) RETURNING *`,
      [tenant, patient.id, visitNo, payerId, patientPayerId, department, token, priority, req.user.id]
    );
    const v = ins.rows[0];
    await client.query('INSERT INTO visit_events (tenant_id, visit_id, stage, user_id, note) VALUES ($1, $2, $3, $4, $5)',
      [tenant, v.id, 'reception', req.user.id, 'Amesajiliwa mapokezi']);
    // Dharura inaweza kwenda moja kwa moja kwa daktari
    const firstStage = b.skip_triage && priority === 'emergency' ? 'doctor' : 'triage';
    await moveStage(client, v, firstStage, req.user.id);
    v.stage = firstStage;
    return v;
  });

  await audit.log(req, 'create_visit', { entity: 'visits', entityId: visit.id, after: { token: visit.token, patient: patient.first_name + ' ' + patient.last_name } });
  res.status(201).json({ status: 'ok', visit });
}));

// ---------- Triage ----------
function num(v, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return NaN;
  return n;
}

router.post('/:id/vitals', requireRole('hospital_admin', 'nurse', 'doctor'), asyncHandler(async (req, res) => {
  const tenant = req.user.tenant_id;
  const { rows } = await db.query('SELECT * FROM visits WHERE id = $1 AND tenant_id = $2', [Number(req.params.id), tenant]);
  const visit = rows[0];
  if (!visit) return res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
  if (['completed', 'cancelled'].includes(visit.stage)) return res.status(400).json({ status: 'error', message: 'Ziara hii imeshafungwa.' });

  const b = req.body || {};
  const v = {
    temperature_c: num(b.temperature_c, 30, 45),
    weight_kg: num(b.weight_kg, 0.3, 350),
    height_cm: num(b.height_cm, 20, 250),
    bp_systolic: num(b.bp_systolic, 40, 300),
    bp_diastolic: num(b.bp_diastolic, 20, 200),
    pulse: num(b.pulse, 20, 250),
    spo2: num(b.spo2, 40, 100)
  };
  const bad = Object.entries(v).find(([, val]) => Number.isNaN(val));
  if (bad) return res.status(400).json({ status: 'error', message: 'Kipimo hiki si sahihi: ' + bad[0] + '. Kiangalie tena.' });
  if (v.temperature_c === null && v.bp_systolic === null && v.pulse === null && v.weight_kg === null) {
    return res.status(400).json({ status: 'error', message: 'Jaza angalau kipimo kimoja.' });
  }

  let doctorId = null;
  if (b.assigned_doctor_id) {
    const d = await db.query("SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'doctor' AND is_active = TRUE", [b.assigned_doctor_id, tenant]);
    if (!d.rows[0]) return res.status(400).json({ status: 'error', message: 'Daktari aliyechaguliwa hayupo.' });
    doctorId = d.rows[0].id;
  }

  const sendToDoctor = b.send_to_doctor !== false;

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO vitals (tenant_id, visit_id, temperature_c, weight_kg, height_cm, bp_systolic, bp_diastolic, pulse, spo2, complaint, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenant, visit.id, v.temperature_c, v.weight_kg, v.height_cm, v.bp_systolic, v.bp_diastolic, v.pulse, v.spo2, b.complaint || null, req.user.id]
    );
    if (b.allergies !== undefined || b.chronic_conditions !== undefined) {
      await client.query(
        `UPDATE patients SET allergies = COALESCE($1, allergies), chronic_conditions = COALESCE($2, chronic_conditions), updated_at = NOW() WHERE id = $3`,
        [b.allergies === undefined ? null : (b.allergies || null), b.chronic_conditions === undefined ? null : (b.chronic_conditions || null), visit.patient_id]
      );
    }
    await client.query(
      `UPDATE visits SET department = COALESCE($1, department), priority = COALESCE($2, priority), assigned_doctor_id = COALESCE($3, assigned_doctor_id) WHERE id = $4`,
      [b.department || null, PRIORITIES.includes(b.priority) ? b.priority : null, doctorId, visit.id]
    );
    if (sendToDoctor && visit.stage === 'triage') await moveStage(client, visit, 'doctor', req.user.id, 'Triage imekamilika');
  });

  await audit.log(req, 'record_vitals', { entity: 'visits', entityId: visit.id, after: v });
  res.json({ status: 'ok', message: sendToDoctor ? 'Vitals zimehifadhiwa. Mgonjwa yuko kwenye foleni ya daktari.' : 'Vitals zimehifadhiwa.' });
}));

// ---------- Kusitisha ----------
router.post('/:id/cancel', requireRole('hospital_admin', 'receptionist', 'nurse'), asyncHandler(async (req, res) => {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ status: 'error', message: 'Andika sababu ya kusitisha.' });
  const { rows } = await db.query('SELECT * FROM visits WHERE id = $1 AND tenant_id = $2', [Number(req.params.id), req.user.tenant_id]);
  const visit = rows[0];
  if (!visit) return res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
  if (['completed', 'cancelled'].includes(visit.stage)) return res.status(400).json({ status: 'error', message: 'Ziara hii imeshafungwa.' });

  await db.transaction(async (client) => {
    await client.query('UPDATE visits SET cancel_reason = $1 WHERE id = $2', [reason, visit.id]);
    await moveStage(client, visit, 'cancelled', req.user.id, reason);
  });
  await audit.log(req, 'cancel_visit', { entity: 'visits', entityId: visit.id, before: { stage: visit.stage }, after: { stage: 'cancelled', reason } });
  res.json({ status: 'ok', message: 'Ziara imesitishwa.' });
}));

module.exports = { router, moveStage };
