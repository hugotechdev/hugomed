// =============================================================
// HugoMed - IPD: wodi, vitanda, kulaza, nursing notes, discharge
//   GET  /api/ipd/wards                        wodi na vitanda (na nani yuko kitandani)
//   POST /api/ipd/wards                        kuongeza wodi + vitanda (Admin)
//   POST /api/ipd/wards/:id/beds               kuongeza kitanda (Admin)
//   PATCH /api/ipd/wards/:id                   jina, bei ya kitanda, kuzima (Admin)
//   GET  /api/ipd/admissions                   waliolazwa sasa
//   POST /api/ipd/admit                        kumlaza mgonjwa (daktari)
//   GET  /api/ipd/admissions/:id               taarifa za aliyelazwa + nursing notes
//   POST /api/ipd/admissions/:id/notes         nursing / ward round note
//   POST /api/ipd/admissions/:id/transfer      kuhamisha kitanda
//   POST /api/ipd/admissions/:id/discharge     discharge -> malipo
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { moveStage } = require('./visits');
const { rebuildInvoice } = require('./invoice');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'doctor', 'nurse', 'pharmacist', 'cashier', 'receptionist'));
const CLINICAL = ['hospital_admin', 'doctor', 'nurse'];

// ---------- Wodi ----------
router.get('/wards', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT w.*, s.name AS bed_service_name,
            COALESCE((SELECT json_agg(json_build_object(
               'id', b.id, 'label', b.label, 'is_active', b.is_active,
               'admission_id', a.id, 'patient', CASE WHEN a.id IS NULL THEN NULL ELSE p.first_name || ' ' || p.last_name END,
               'token', v.token, 'admitted_at', a.admitted_at) ORDER BY b.label)
              FROM beds b
              LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'admitted'
              LEFT JOIN visits v ON v.id = a.visit_id
              LEFT JOIN patients p ON p.id = a.patient_id
             WHERE b.ward_id = w.id), '[]'::json) AS beds
       FROM wards w LEFT JOIN services s ON s.id = w.bed_service_id
      WHERE w.tenant_id = $1 ORDER BY w.name`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

router.post('/wards', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const count = parseInt(req.body.bed_count, 10) || 0;
  if (!name) return res.status(400).json({ status: 'error', message: 'Jaza jina la wodi.' });
  if (count < 0 || count > 200) return res.status(400).json({ status: 'error', message: 'Idadi ya vitanda iwe kati ya 0 na 200.' });
  let bedService = req.body.bed_service_id ? Number(req.body.bed_service_id) : null;

  const ward = await db.transaction(async (client) => {
    // Kama hakuna huduma ya kitanda, inatengenezwa (bei inawekwa kwenye price list)
    if (!bedService) {
      const s = await client.query(
        "INSERT INTO services (tenant_id, code, name, category, unit) VALUES ($1, $2, $3, 'bed', 'day') RETURNING id",
        [req.user.tenant_id, null, 'Kitanda: ' + name + ' (kwa siku)']
      );
      bedService = s.rows[0].id;
    }
    const w = await client.query('INSERT INTO wards (tenant_id, name, bed_service_id) VALUES ($1, $2, $3) RETURNING *', [req.user.tenant_id, name, bedService]);
    for (let i = 1; i <= count; i++) {
      await client.query('INSERT INTO beds (tenant_id, ward_id, label) VALUES ($1, $2, $3)', [req.user.tenant_id, w.rows[0].id, 'Kitanda ' + i]);
    }
    return w.rows[0];
  });
  await audit.log(req, 'create_ward', { entity: 'wards', entityId: ward.id, after: { name, beds: count } });
  res.status(201).json({ status: 'ok', ward, message: name + ' imeongezwa na vitanda ' + count + '. Weka bei ya kitanda kwenye Price lists.' });
}));

router.post('/wards/:id/beds', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const w = await db.query('SELECT * FROM wards WHERE id = $1 AND tenant_id = $2', [Number(req.params.id), req.user.tenant_id]);
  if (!w.rows[0]) return res.status(404).json({ status: 'error', message: 'Wodi haipo.' });
  const label = String((req.body && req.body.label) || '').trim();
  if (!label) return res.status(400).json({ status: 'error', message: 'Andika jina la kitanda.' });
  await db.query('INSERT INTO beds (tenant_id, ward_id, label) VALUES ($1, $2, $3)', [req.user.tenant_id, w.rows[0].id, label]);
  res.status(201).json({ status: 'ok', message: label + ' kimeongezwa.' });
}));

router.patch('/wards/:id', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const sets = [];
  const params = [];
  for (const f of ['name', 'is_active']) {
    if (req.body[f] === undefined) continue;
    params.push(req.body[f]);
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });
  params.push(Number(req.params.id), req.user.tenant_id);
  const { rows } = await db.query(`UPDATE wards SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING *`, params);
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Wodi haipo.' });
  res.json({ status: 'ok', ward: rows[0] });
}));

// ---------- Waliolazwa ----------
const ADM_SQL = `
  SELECT a.*, b.label AS bed_label, w.name AS ward_name, w.id AS ward_id,
         v.token, v.visit_no, v.stage, v.assigned_doctor_id,
         p.first_name, p.middle_name, p.last_name, p.mrn, p.sex, p.date_of_birth, p.allergies,
         py.name AS payer_name, u.full_name AS admitted_by_name,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, NOW()) - a.admitted_at)) / 86400))::int AS days
    FROM admissions a
    JOIN visits v ON v.id = a.visit_id
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN beds b ON b.id = a.bed_id
    LEFT JOIN wards w ON w.id = b.ward_id
    LEFT JOIN payers py ON py.id = v.payer_id
    LEFT JOIN users u ON u.id = a.admitted_by`;

router.get('/admissions', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`${ADM_SQL} WHERE a.tenant_id = $1 AND a.status = 'admitted' ORDER BY w.name, b.label`, [req.user.tenant_id]);
  res.json({ status: 'ok', items: rows });
}));

async function freeBed(bedId, tenantId) {
  const b = await db.query(
    `SELECT b.*, w.is_active AS ward_active FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.id = $1 AND b.tenant_id = $2`,
    [bedId, tenantId]
  );
  const bed = b.rows[0];
  if (!bed || !bed.is_active || !bed.ward_active) return { error: 'Kitanda hakipo.' };
  const busy = await db.query("SELECT 1 FROM admissions WHERE bed_id = $1 AND status = 'admitted'", [bed.id]);
  if (busy.rows.length) return { error: 'Kitanda hiki kina mgonjwa.' };
  return { bed };
}

router.post('/admit', requireRole('doctor', 'hospital_admin'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const vr = await db.query('SELECT * FROM visits WHERE id = $1 AND tenant_id = $2', [Number(b.visit_id), req.user.tenant_id]);
  const visit = vr.rows[0];
  if (!visit) return res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
  if (!['doctor', 'results'].includes(visit.stage)) return res.status(400).json({ status: 'error', message: 'Mgonjwa anaweza kulazwa akiwa kwa daktari tu.' });
  const reason = String(b.reason || '').trim();
  if (!reason) return res.status(400).json({ status: 'error', message: 'Andika sababu ya kumlaza.' });
  const dx = await db.query('SELECT 1 FROM diagnoses WHERE visit_id = $1 LIMIT 1', [visit.id]);
  if (!dx.rows.length) return res.status(400).json({ status: 'error', message: 'Ongeza diagnosis kabla ya kumlaza.' });
  const fb = await freeBed(Number(b.bed_id), req.user.tenant_id);
  if (fb.error) return res.status(400).json({ status: 'error', message: fb.error });

  const adm = await db.transaction(async (client) => {
    const a = await client.query(
      'INSERT INTO admissions (tenant_id, visit_id, patient_id, bed_id, reason, admitted_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.tenant_id, visit.id, visit.patient_id, fb.bed.id, reason, req.user.id]
    );
    await moveStage(client, visit, 'admitted', req.user.id, 'Amelazwa: ' + fb.bed.label);
    return a.rows[0];
  });
  await audit.log(req, 'admit', { entity: 'admissions', entityId: adm.id, after: { visit_id: visit.id, bed: fb.bed.label, reason } });
  res.status(201).json({ status: 'ok', admission: adm, message: 'Mgonjwa amelazwa (' + fb.bed.label + ').' });
}));

async function getAdmission(req, res) {
  const { rows } = await db.query(`${ADM_SQL} WHERE a.id = $1 AND a.tenant_id = $2`, [Number(req.params.id), req.user.tenant_id]);
  if (!rows[0]) { res.status(404).json({ status: 'error', message: 'Taarifa za kulazwa hazipo.' }); return null; }
  return rows[0];
}

router.get('/admissions/:id', asyncHandler(async (req, res) => {
  const a = await getAdmission(req, res);
  if (!a) return;
  const notes = await db.query(
    `SELECT n.*, u.full_name AS user_name, u.role AS user_role FROM nursing_notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.admission_id = $1 ORDER BY n.at DESC`,
    [a.id]
  );
  const vitals = await db.query('SELECT * FROM vitals WHERE visit_id = $1 ORDER BY recorded_at DESC LIMIT 10', [a.visit_id]);
  res.json({ status: 'ok', admission: a, notes: notes.rows, vitals: vitals.rows });
}));

router.post('/admissions/:id/notes', requireRole(...CLINICAL), asyncHandler(async (req, res) => {
  const a = await getAdmission(req, res);
  if (!a) return;
  if (a.status !== 'admitted') return res.status(400).json({ status: 'error', message: 'Mgonjwa ameshaondoka wodini.' });
  const note = String((req.body && req.body.note) || '').trim();
  if (!note) return res.status(400).json({ status: 'error', message: 'Andika note.' });
  await db.query('INSERT INTO nursing_notes (tenant_id, admission_id, note, user_id) VALUES ($1, $2, $3, $4)', [req.user.tenant_id, a.id, note, req.user.id]);

  // Vitals za wodini (si lazima)
  const v = req.body.vitals || {};
  const num = (x) => (x === undefined || x === null || x === '' ? null : Number(x));
  if (['temperature_c', 'bp_systolic', 'pulse', 'spo2'].some((k) => num(v[k]) !== null)) {
    await db.query(
      `INSERT INTO vitals (tenant_id, visit_id, temperature_c, bp_systolic, bp_diastolic, pulse, spo2, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user.tenant_id, a.visit_id, num(v.temperature_c), num(v.bp_systolic), num(v.bp_diastolic), num(v.pulse), num(v.spo2), req.user.id]
    );
  }
  res.status(201).json({ status: 'ok', message: 'Note imehifadhiwa.' });
}));

router.post('/admissions/:id/transfer', requireRole(...CLINICAL), asyncHandler(async (req, res) => {
  const a = await getAdmission(req, res);
  if (!a) return;
  if (a.status !== 'admitted') return res.status(400).json({ status: 'error', message: 'Mgonjwa ameshaondoka wodini.' });
  const fb = await freeBed(Number(req.body.bed_id), req.user.tenant_id);
  if (fb.error) return res.status(400).json({ status: 'error', message: fb.error });
  await db.query('UPDATE admissions SET bed_id = $1 WHERE id = $2', [fb.bed.id, a.id]);
  await db.query('INSERT INTO nursing_notes (tenant_id, admission_id, note, user_id) VALUES ($1, $2, $3, $4)',
    [req.user.tenant_id, a.id, 'Amehamishwa kutoka ' + (a.ward_name || '') + ' ' + (a.bed_label || '') + ' kwenda ' + fb.bed.label, req.user.id]);
  await audit.log(req, 'transfer_bed', { entity: 'admissions', entityId: a.id, before: { bed: a.bed_label }, after: { bed: fb.bed.label } });
  res.json({ status: 'ok', message: 'Amehamishwa ' + fb.bed.label + '.' });
}));

router.post('/admissions/:id/discharge', requireRole('doctor', 'hospital_admin'), asyncHandler(async (req, res) => {
  const a = await getAdmission(req, res);
  if (!a) return;
  if (a.status !== 'admitted') return res.status(400).json({ status: 'error', message: 'Mgonjwa ameshaondoka wodini.' });
  const summary = String((req.body && req.body.summary) || '').trim();
  if (!summary) return res.status(400).json({ status: 'error', message: 'Andika muhtasari wa discharge (hali, dawa za kwenda nazo, tarehe ya kurudi).' });
  const pendingLab = await db.query("SELECT COUNT(*)::int AS n FROM orders WHERE visit_id = $1 AND type IN ('lab', 'radiology') AND status IN ('ordered', 'paid', 'in_progress')", [a.visit_id]);
  if (pendingLab.rows[0].n) return res.status(400).json({ status: 'error', message: 'Bado kuna vipimo ' + pendingLab.rows[0].n + ' havijakamilika.' });

  await db.transaction(async (client) => {
    await client.query("UPDATE admissions SET status = 'discharged', discharged_at = NOW(), discharged_by = $1, discharge_summary = $2 WHERE id = $3", [req.user.id, summary, a.id]);
    const v = await client.query('SELECT * FROM visits WHERE id = $1', [a.visit_id]);
    await moveStage(client, v.rows[0], 'billing', req.user.id, 'Discharge: ' + summary.slice(0, 120));
  });
  const bill = await rebuildInvoice(req.user.tenant_id, a.visit_id);
  await audit.log(req, 'discharge', { entity: 'admissions', entityId: a.id, after: { days: a.days, summary } });
  res.json({ status: 'ok', message: 'Discharge imefanyika baada ya siku ' + a.days + '. Mgonjwa aende malipo (bili ' + (bill ? Math.round(bill.invoice.total).toLocaleString('en-US') : '0') + ' TSh).' });
}));

module.exports = router;
