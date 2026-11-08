// =============================================================
// HugoMed - watumiaji wa hospitali (Admin wa hospitali)
//   GET   /api/users                    watumiaji wa hospitali yako
//   POST  /api/users                    kuongeza mtumiaji
//   PATCH /api/users/:id                kubadilisha role, hali, taarifa
//   POST  /api/users/:id/reset-password kuweka password mpya
// Super Admin anaweza kuongeza ?tenant_id= au tenant_id kwenye body.
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { hashPassword, checkPasswordRules, requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'super_admin'));

// Roles ambazo Admin wa hospitali anaweza kutoa (si super_admin)
const HOSPITAL_ROLES = ['hospital_admin', 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer', 'accountant', 'hr_officer'];

// Hospitali ambayo ombi hili linahusu
function targetTenant(req) {
  if (req.user.role === 'super_admin') {
    const t = Number(req.query.tenant_id || (req.body && req.body.tenant_id));
    return t || null;
  }
  return req.user.tenant_id;
}

const SAFE_FIELDS = `id, tenant_id, full_name, email, phone, role, professional_reg_no,
                     license_expiry, is_active, last_login_at, created_at`;

router.get('/', asyncHandler(async (req, res) => {
  const tenantId = targetTenant(req);
  if (!tenantId) return res.status(400).json({ status: 'error', message: 'Chagua hospitali.' });
  const { rows } = await db.query(
    `SELECT ${SAFE_FIELDS} FROM users WHERE tenant_id = $1 ORDER BY is_active DESC, full_name`,
    [tenantId]
  );
  res.json({ status: 'ok', items: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const tenantId = targetTenant(req);
  if (!tenantId) return res.status(400).json({ status: 'error', message: 'Chagua hospitali.' });

  const b = req.body || {};
  const fullName = String(b.full_name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const role = String(b.role || '');
  const password = String(b.password || '');

  if (!fullName || !email) return res.status(400).json({ status: 'error', message: 'Jaza jina na barua pepe.' });
  if (!HOSPITAL_ROLES.includes(role)) return res.status(400).json({ status: 'error', message: 'Chagua kazi (role) sahihi.' });
  const pwError = checkPasswordRules(password);
  if (pwError) return res.status(400).json({ status: 'error', message: pwError });

  const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) return res.status(409).json({ status: 'error', message: 'Barua pepe hii tayari inatumika.' });

  const { rows } = await db.query(
    `INSERT INTO users (tenant_id, full_name, email, phone, role, professional_reg_no, license_expiry, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SAFE_FIELDS}`,
    [tenantId, fullName, email, b.phone || null, role, b.professional_reg_no || null, b.license_expiry || null, hashPassword(password)]
  );

  await audit.log(req, 'create_user', { tenantId, entity: 'users', entityId: rows[0].id, after: { full_name: fullName, email, role } });
  res.status(201).json({ status: 'ok', user: rows[0] });
}));

// Inapata mtumiaji ndani ya hospitali inayoruhusiwa
async function findUser(req, id) {
  const { rows } = await db.query(`SELECT ${SAFE_FIELDS} FROM users WHERE id = $1`, [id]);
  const user = rows[0];
  if (!user || user.role === 'super_admin') return null;
  if (req.user.role !== 'super_admin' && user.tenant_id !== req.user.tenant_id) return null;
  return user;
}

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await findUser(req, id);
  if (!before) return res.status(404).json({ status: 'error', message: 'Mtumiaji hayupo.' });

  const b = req.body || {};
  if (id === req.user.id && (b.is_active === false || (b.role && b.role !== req.user.role))) {
    return res.status(400).json({ status: 'error', message: 'Huwezi kujizima wala kujibadilishia kazi mwenyewe.' });
  }
  if (b.role !== undefined && !HOSPITAL_ROLES.includes(b.role)) {
    return res.status(400).json({ status: 'error', message: 'Kazi (role) si sahihi.' });
  }

  const allowed = ['full_name', 'phone', 'role', 'professional_reg_no', 'license_expiry', 'is_active'];
  const sets = [];
  const params = [];
  for (const field of allowed) {
    if (b[field] === undefined) continue;
    params.push(b[field] === '' ? null : b[field]);
    sets.push(`${field} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });

  params.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SAFE_FIELDS}`,
    params
  );

  await audit.log(req, 'update_user', { tenantId: before.tenant_id, entity: 'users', entityId: id, before, after: rows[0] });
  res.json({ status: 'ok', user: rows[0] });
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = await findUser(req, id);
  if (!user) return res.status(404).json({ status: 'error', message: 'Mtumiaji hayupo.' });

  const password = String((req.body && req.body.password) || '');
  const pwError = checkPasswordRules(password);
  if (pwError) return res.status(400).json({ status: 'error', message: pwError });

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), id]);
  await audit.log(req, 'reset_password', { tenantId: user.tenant_id, entity: 'users', entityId: id });
  res.json({ status: 'ok', message: 'Password mpya imewekwa.' });
}));

module.exports = router;
