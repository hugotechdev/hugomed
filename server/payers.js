// =============================================================
// HugoMed - walipaji: Cash, NHIF, bima binafsi, kampuni (credit)
//   GET   /api/payers        orodha (wafanyakazi wote wa hospitali)
//   POST  /api/payers        kuongeza bima au kampuni (Admin wa hospitali)
//   PATCH /api/payers/:id    kubadilisha au kuzima (Admin wa hospitali)
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
const HOSPITAL_STAFF = ['hospital_admin', 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer', 'accountant', 'hr_officer'];
router.use(requireAuth, requireRole(...HOSPITAL_STAFF));

const FIELDS = ['name', 'contact_person', 'phone', 'email', 'credit_limit', 'payment_terms_days', 'requires_preauth', 'copay_percent', 'is_active'];

router.get('/', asyncHandler(async (req, res) => {
  const onlyActive = req.user.role !== 'hospital_admin';
  const { rows } = await db.query(
    `SELECT * FROM payers
      WHERE tenant_id = $1 ${onlyActive ? 'AND is_active = TRUE' : ''}
      ORDER BY CASE type WHEN 'cash' THEN 1 WHEN 'nhif' THEN 2 WHEN 'insurance' THEN 3 ELSE 4 END, name`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

function clean(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    let v = body[f];
    if (v === '') v = null;
    if (['credit_limit', 'copay_percent'].includes(f) && v !== null) v = Number(v);
    if (f === 'payment_terms_days' && v !== null) v = parseInt(v, 10);
    if (['requires_preauth', 'is_active'].includes(f)) v = v === true || v === 'true' || v === 'on';
    out[f] = v;
  }
  return out;
}

router.post('/', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const type = String(req.body.type || '');
  if (!['insurance', 'company'].includes(type)) {
    return res.status(400).json({ status: 'error', message: 'Chagua aina: bima au kampuni.' });
  }
  const data = clean(req.body);
  if (!data.name) return res.status(400).json({ status: 'error', message: 'Jaza jina.' });
  if (data.copay_percent !== undefined && data.copay_percent !== null && (data.copay_percent < 0 || data.copay_percent > 100)) {
    return res.status(400).json({ status: 'error', message: 'Co-pay iwe kati ya 0 na 100.' });
  }

  const result = await db.transaction(async (client) => {
    const p = await client.query(
      `INSERT INTO payers (tenant_id, type, name, contact_person, phone, email, credit_limit, payment_terms_days, requires_preauth, copay_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 30), COALESCE($9, FALSE), COALESCE($10, 0))
       RETURNING *`,
      [req.user.tenant_id, type, data.name, data.contact_person || null, data.phone || null, data.email || null,
       data.credit_limit ?? null, data.payment_terms_days ?? null, data.requires_preauth ?? null, data.copay_percent ?? null]
    );
    // Kila mlipaji anapata price list yake
    await client.query('INSERT INTO price_lists (tenant_id, name, payer_id) VALUES ($1, $2, $3)', [req.user.tenant_id, data.name, p.rows[0].id]);
    return p.rows[0];
  });

  await audit.log(req, 'create_payer', { entity: 'payers', entityId: result.id, after: { type, name: result.name } });
  res.status(201).json({ status: 'ok', payer: result });
}));

router.patch('/:id', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await db.query('SELECT * FROM payers WHERE id = $1 AND tenant_id = $2', [id, req.user.tenant_id]);
  if (!before.rows[0]) return res.status(404).json({ status: 'error', message: 'Mlipaji hayupo.' });
  if (before.rows[0].type === 'cash' && req.body.is_active === false) {
    return res.status(400).json({ status: 'error', message: 'Cash haiwezi kuzimwa.' });
  }

  const data = clean(req.body);
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });
  params.push(id, req.user.tenant_id);
  const { rows } = await db.query(
    `UPDATE payers SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING *`,
    params
  );
  await audit.log(req, 'update_payer', { entity: 'payers', entityId: id, before: before.rows[0], after: rows[0] });
  res.json({ status: 'ok', payer: rows[0] });
}));

module.exports = router;
