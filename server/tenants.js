// =============================================================
// HugoMed - hospitali (wateja wa HUGO TECH). Super Admin pekee.
//   GET   /api/tenants          orodha ya hospitali
//   POST  /api/tenants          kusajili hospitali + Admin wake wa kwanza
//   PATCH /api/tenants/:id      kubadilisha taarifa au kusimamisha / kuwasha
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { hashPassword, checkPasswordRules, requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin'));

const LEVELS = ['dispensary', 'health_centre', 'clinic', 'medical_centre', 'district_hospital', 'regional_hospital', 'hospital'];
const STATUSES = ['active', 'suspended', 'trial'];

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.*,
            (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
            (SELECT COUNT(*)::int FROM patients p WHERE p.tenant_id = t.id) AS patient_count
       FROM tenants t
      ORDER BY t.created_at DESC`
  );
  res.json({ status: 'ok', items: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const level = String(b.facility_level || 'clinic');
  const adminName = String(b.admin_full_name || '').trim();
  const adminEmail = String(b.admin_email || '').trim().toLowerCase();
  const adminPassword = String(b.admin_password || '');

  if (!name) return res.status(400).json({ status: 'error', message: 'Jaza jina la hospitali.' });
  if (!LEVELS.includes(level)) return res.status(400).json({ status: 'error', message: 'Ngazi ya kituo si sahihi.' });
  if (!adminName || !adminEmail) return res.status(400).json({ status: 'error', message: 'Jaza jina na barua pepe ya Admin wa hospitali.' });
  const pwError = checkPasswordRules(adminPassword);
  if (pwError) return res.status(400).json({ status: 'error', message: 'Password ya Admin: ' + pwError });

  const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [adminEmail]);
  if (exists.rows.length) return res.status(409).json({ status: 'error', message: 'Barua pepe ya Admin tayari inatumika.' });

  const result = await db.transaction(async (client) => {
    const t = await client.query(
      `INSERT INTO tenants (name, facility_level, nhif_facility_code, phone, email, address, plan, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, level, b.nhif_facility_code || null, b.phone || null, b.email || null, b.address || null,
       b.plan || 'basic', STATUSES.includes(b.status) ? b.status : 'active']
    );
    const tenant = t.rows[0];

    const u = await client.query(
      `INSERT INTO users (tenant_id, full_name, email, phone, role, password_hash)
       VALUES ($1, $2, $3, $4, 'hospital_admin', $5)
       RETURNING id, full_name, email, role`,
      [tenant.id, adminName, adminEmail, b.admin_phone || null, hashPassword(adminPassword)]
    );

    // Walipaji wa msingi na price lists zao
    const cash = await client.query(
      `INSERT INTO payers (tenant_id, type, name) VALUES ($1, 'cash', 'Cash') RETURNING id`, [tenant.id]
    );
    const nhif = await client.query(
      `INSERT INTO payers (tenant_id, type, name, requires_preauth) VALUES ($1, 'nhif', 'NHIF', FALSE) RETURNING id`, [tenant.id]
    );
    await client.query(`INSERT INTO price_lists (tenant_id, name, payer_id) VALUES ($1, 'Cash', $2)`, [tenant.id, cash.rows[0].id]);
    await client.query(`INSERT INTO price_lists (tenant_id, name, payer_id) VALUES ($1, 'NHIF', $2)`, [tenant.id, nhif.rows[0].id]);

    return { tenant, admin: u.rows[0] };
  });

  await audit.log(req, 'create_tenant', {
    tenantId: result.tenant.id,
    entity: 'tenants',
    entityId: result.tenant.id,
    after: { name: result.tenant.name, admin_email: result.admin.email }
  });
  res.status(201).json({ status: 'ok', tenant: result.tenant, admin: result.admin });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await db.query('SELECT * FROM tenants WHERE id = $1', [id]);
  if (!before.rows[0]) return res.status(404).json({ status: 'error', message: 'Hospitali haipo.' });

  const allowed = ['name', 'facility_level', 'nhif_facility_code', 'phone', 'email', 'address', 'plan', 'status'];
  const sets = [];
  const params = [];
  for (const field of allowed) {
    if (req.body[field] === undefined) continue;
    if (field === 'status' && !STATUSES.includes(req.body.status)) {
      return res.status(400).json({ status: 'error', message: 'Hali si sahihi.' });
    }
    if (field === 'facility_level' && !LEVELS.includes(req.body.facility_level)) {
      return res.status(400).json({ status: 'error', message: 'Ngazi ya kituo si sahihi.' });
    }
    params.push(req.body[field]);
    sets.push(`${field} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });

  params.push(id);
  const { rows } = await db.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);

  await audit.log(req, 'update_tenant', { tenantId: id, entity: 'tenants', entityId: id, before: before.rows[0], after: rows[0] });
  res.json({ status: 'ok', tenant: rows[0] });
}));

module.exports = router;
