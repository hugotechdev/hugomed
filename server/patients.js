// =============================================================
// HugoMed - wagonjwa (Mapokezi)
//   GET   /api/patients?q=...                     kutafuta
//   GET   /api/patients/:id                       mgonjwa + walipaji + ziara
//   POST  /api/patients                           kusajili (na onyo la rekodi mbili)
//   PATCH /api/patients/:id                       kubadilisha taarifa
//   POST  /api/patients/:id/payers                kuongeza mlipaji (kadi ya NHIF, bima, kampuni)
//   POST  /api/patients/:id/payers/:ppid/verify   "nimehakiki kadi leo"
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'receptionist', 'nurse', 'doctor', 'cashier', 'claims_officer', 'lab_technician', 'pharmacist'));
const WRITERS = ['hospital_admin', 'receptionist', 'nurse'];

// Walipaji wa kila mgonjwa kama JSON
const PAYERS_JSON = `COALESCE((
  SELECT json_agg(json_build_object(
    'id', pp.id, 'payer_id', py.id, 'type', py.type, 'name', py.name,
    'member_number', pp.member_number, 'employee_number', pp.employee_number,
    'valid_until', pp.valid_until, 'is_primary', pp.is_primary,
    'last_verified_at', pp.last_verified_at, 'requires_preauth', py.requires_preauth,
    'copay_percent', py.copay_percent, 'payer_active', py.is_active
  ) ORDER BY pp.is_primary DESC, pp.id)
  FROM patient_payers pp JOIN payers py ON py.id = pp.payer_id
  WHERE pp.patient_id = p.id
), '[]'::json) AS payers`;

const PATIENT_FIELDS = ['first_name', 'middle_name', 'last_name', 'sex', 'date_of_birth', 'phone', 'id_type', 'id_number', 'next_of_kin_phone', 'address', 'allergies', 'chronic_conditions'];

function cleanPatient(body) {
  const out = {};
  for (const f of PATIENT_FIELDS) {
    if (body[f] === undefined) continue;
    const v = typeof body[f] === 'string' ? body[f].trim() : body[f];
    out[f] = v === '' ? null : v;
  }
  if (out.sex && !['F', 'M'].includes(out.sex)) out.sex = undefined;
  if (out.id_type && !['nida', 'passport', 'none'].includes(out.id_type)) out.id_type = null;
  return out;
}

function digits(s) {
  return String(s || '').replace(/\D/g, '');
}

// ---------- Kutafuta ----------
router.get('/', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const tenant = req.user.tenant_id;

  if (!q) {
    const { rows } = await db.query(
      `SELECT p.*, ${PAYERS_JSON} FROM patients p WHERE p.tenant_id = $1 ORDER BY p.created_at DESC LIMIT 15`,
      [tenant]
    );
    return res.json({ status: 'ok', items: rows });
  }

  const d = digits(q);
  const { rows } = await db.query(
    `SELECT p.*, ${PAYERS_JSON}
       FROM patients p
      WHERE p.tenant_id = $1
        AND (
          (p.first_name || ' ' || COALESCE(p.middle_name || ' ', '') || p.last_name) ILIKE $2
          OR (p.first_name || ' ' || p.last_name) ILIKE $2
          OR p.mrn = $3
          OR p.id_number = $3
          OR ($4::text IS NOT NULL AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE $4)
          OR EXISTS (SELECT 1 FROM patient_payers pp WHERE pp.patient_id = p.id AND (pp.member_number = $3 OR pp.employee_number = $3))
        )
      ORDER BY p.last_name, p.first_name
      LIMIT 25`,
    [tenant, '%' + q + '%', q, d.length >= 4 ? '%' + d.slice(-9) + '%' : null]
  );
  res.json({ status: 'ok', items: rows });
}));

// ---------- Mgonjwa mmoja ----------
async function loadPatient(tenantId, id) {
  const { rows } = await db.query(`SELECT p.*, ${PAYERS_JSON} FROM patients p WHERE p.id = $1 AND p.tenant_id = $2`, [id, tenantId]);
  return rows[0] || null;
}

router.get('/:id', asyncHandler(async (req, res) => {
  const patient = await loadPatient(req.user.tenant_id, Number(req.params.id));
  if (!patient) return res.status(404).json({ status: 'error', message: 'Mgonjwa hayupo.' });
  const visits = await db.query(
    `SELECT v.id, v.visit_no, v.token, v.department, v.stage, v.arrived_at, v.completed_at, py.name AS payer_name
       FROM visits v LEFT JOIN payers py ON py.id = v.payer_id
      WHERE v.patient_id = $1 AND v.tenant_id = $2
      ORDER BY v.arrived_at DESC LIMIT 10`,
    [patient.id, req.user.tenant_id]
  );
  res.json({ status: 'ok', patient, visits: visits.rows });
}));

// ---------- Kusajili ----------
router.post('/', requireRole(...WRITERS), asyncHandler(async (req, res) => {
  const tenant = req.user.tenant_id;
  const data = cleanPatient(req.body || {});
  if (!data.first_name || !data.last_name) return res.status(400).json({ status: 'error', message: 'Jaza jina la kwanza na la ukoo.' });
  if (!data.sex) return res.status(400).json({ status: 'error', message: 'Chagua jinsia.' });

  // Onyo la rekodi mbili (isipokuwa mtumiaji amethibitisha "si yeye")
  if (!req.body.force) {
    const d = digits(data.phone);
    const dup = await db.query(
      `SELECT p.id, p.mrn, p.first_name, p.middle_name, p.last_name, p.sex, p.date_of_birth, p.phone
         FROM patients p
        WHERE p.tenant_id = $1
          AND (
            ($2::text IS NOT NULL AND p.id_number = $2)
            OR ($3::text IS NOT NULL AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE $3 AND p.first_name ILIKE $4)
            OR (p.first_name ILIKE $4 AND p.last_name ILIKE $5 AND $6::date IS NOT NULL AND p.date_of_birth = $6::date)
          )
        LIMIT 5`,
      [tenant, data.id_number || null, d.length >= 9 ? '%' + d.slice(-9) : null, data.first_name, data.last_name, data.date_of_birth || null]
    );
    if (dup.rows.length) {
      return res.status(409).json({
        status: 'error',
        code: 'possible_duplicate',
        message: 'Huenda mgonjwa huyu tayari amesajiliwa. Angalia orodha kabla ya kusajili mpya.',
        matches: dup.rows
      });
    }
  }

  const payer = req.body.payer || null;

  const patient = await db.transaction(async (client) => {
    // Kufunga kwa muda ili MRN zisirudiwe wagonjwa wawili wakisajiliwa pamoja
    await client.query('SELECT pg_advisory_xact_lock(1000, $1)', [tenant]);
    const next = await client.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(mrn, '[^0-9]', '', 'g'), '')::bigint), 0) + 1 AS n FROM patients WHERE tenant_id = $1`,
      [tenant]
    );
    const mrn = String(next.rows[0].n).padStart(6, '0');

    const cols = ['tenant_id', 'mrn', 'created_by'];
    const vals = [tenant, mrn, req.user.id];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      cols.push(k);
      vals.push(v);
    }
    const ins = await client.query(
      `INSERT INTO patients (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`,
      vals
    );
    const id = ins.rows[0].id;

    if (payer && payer.payer_id) {
      const py = await client.query('SELECT id, type FROM payers WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE', [payer.payer_id, tenant]);
      if (py.rows[0] && py.rows[0].type !== 'cash') {
        await client.query(
          `INSERT INTO patient_payers (tenant_id, patient_id, payer_id, member_number, employee_number, valid_until, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
          [tenant, id, py.rows[0].id, payer.member_number || null, payer.employee_number || null, payer.valid_until || null]
        );
      }
    }
    return { id, mrn };
  });

  await audit.log(req, 'create_patient', { entity: 'patients', entityId: patient.id, after: { mrn: patient.mrn, name: data.first_name + ' ' + data.last_name } });
  res.status(201).json({ status: 'ok', patient: await loadPatient(tenant, patient.id) });
}));

// ---------- Kubadilisha ----------
router.patch('/:id', requireRole(...WRITERS, 'doctor'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadPatient(req.user.tenant_id, id);
  if (!before) return res.status(404).json({ status: 'error', message: 'Mgonjwa hayupo.' });

  const data = cleanPatient(req.body || {});
  const sets = ['updated_at = NOW()'];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (sets.length === 1) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });
  params.push(id, req.user.tenant_id);
  await db.query(`UPDATE patients SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`, params);

  const after = await loadPatient(req.user.tenant_id, id);
  delete before.payers; delete after.payers;
  await audit.log(req, 'update_patient', { entity: 'patients', entityId: id, before, after });
  res.json({ status: 'ok', patient: await loadPatient(req.user.tenant_id, id) });
}));

// ---------- Walipaji wa mgonjwa ----------
router.post('/:id/payers', requireRole(...WRITERS), asyncHandler(async (req, res) => {
  const tenant = req.user.tenant_id;
  const patient = await loadPatient(tenant, Number(req.params.id));
  if (!patient) return res.status(404).json({ status: 'error', message: 'Mgonjwa hayupo.' });

  const b = req.body || {};
  const py = await db.query('SELECT * FROM payers WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE', [b.payer_id, tenant]);
  const payer = py.rows[0];
  if (!payer || payer.type === 'cash') return res.status(400).json({ status: 'error', message: 'Chagua NHIF, bima au kampuni.' });
  if (payer.type === 'company' && !b.employee_number && !b.member_number) {
    return res.status(400).json({ status: 'error', message: 'Jaza namba ya mfanyakazi.' });
  }
  if (payer.type !== 'company' && !b.member_number) {
    return res.status(400).json({ status: 'error', message: 'Jaza namba ya kadi ya uanachama.' });
  }

  const makePrimary = b.is_primary === true || patient.payers.length === 0;
  const row = await db.transaction(async (client) => {
    if (makePrimary) await client.query('UPDATE patient_payers SET is_primary = FALSE WHERE patient_id = $1', [patient.id]);
    const ins = await client.query(
      `INSERT INTO patient_payers (tenant_id, patient_id, payer_id, member_number, employee_number, valid_until, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenant, patient.id, payer.id, b.member_number || null, b.employee_number || null, b.valid_until || null, makePrimary]
    );
    return ins.rows[0];
  });

  await audit.log(req, 'add_patient_payer', { entity: 'patient_payers', entityId: row.id, after: { patient_id: patient.id, payer: payer.name, member_number: row.member_number } });
  res.status(201).json({ status: 'ok', patient: await loadPatient(tenant, patient.id) });
}));

router.post('/:id/payers/:ppid/verify', requireRole(...WRITERS), asyncHandler(async (req, res) => {
  const tenant = req.user.tenant_id;
  const { rows } = await db.query(
    `UPDATE patient_payers SET last_verified_at = NOW(), valid_until = COALESCE($4::date, valid_until)
      WHERE id = $1 AND patient_id = $2 AND tenant_id = $3 RETURNING *`,
    [Number(req.params.ppid), Number(req.params.id), tenant, (req.body && req.body.valid_until) || null]
  );
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Kadi haipo.' });
  await audit.log(req, 'verify_patient_payer', { entity: 'patient_payers', entityId: rows[0].id, after: { valid_until: rows[0].valid_until } });
  res.json({ status: 'ok', patient: await loadPatient(tenant, Number(req.params.id)) });
}));

module.exports = router;
