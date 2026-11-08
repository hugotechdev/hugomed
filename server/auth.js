// =============================================================
// HugoMed - login na akaunti
//   GET  /api/auth/setup-status   kama Super Admin wa kwanza anahitajika
//   POST /api/auth/setup          kuunda Super Admin wa kwanza (mara moja tu)
//   POST /api/auth/login          kuingia
//   GET  /api/auth/me             taarifa za aliyeingia
//   POST /api/auth/change-password
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const {
  hashPassword, verifyPassword, checkPasswordRules, signToken,
  requireAuth, asyncHandler, publicUser
} = require('./security');

const router = express.Router();

// ---------- Kuzuia kujaribu password mara nyingi ----------
// Majaribio 5 yakishindwa ndani ya dakika 15, akaunti inasubiri dakika 15.
const failures = new Map();
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function isBlocked(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return false; }
  return f.count >= MAX_FAILS;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
}

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ---------- Setup ya kwanza ----------
async function superAdminExists() {
  const { rows } = await db.query("SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1");
  return rows.length > 0;
}

router.get('/setup-status', asyncHandler(async (req, res) => {
  res.json({
    status: 'ok',
    needs_setup: !(await superAdminExists()),
    setup_key_configured: Boolean(process.env.SETUP_KEY)
  });
}));

router.post('/setup', asyncHandler(async (req, res) => {
  if (await superAdminExists()) {
    return res.status(409).json({ status: 'error', message: 'Super Admin tayari yupo. Tumia ukurasa wa login.' });
  }
  if (!process.env.SETUP_KEY) {
    return res.status(400).json({ status: 'error', message: 'SETUP_KEY haijawekwa kwenye Railway > Variables.' });
  }
  if (String(req.body.setup_key || '') !== process.env.SETUP_KEY) {
    return res.status(403).json({ status: 'error', message: 'Setup key si sahihi.' });
  }

  const fullName = String(req.body.full_name || '').trim();
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!fullName || !email) {
    return res.status(400).json({ status: 'error', message: 'Jaza jina na barua pepe.' });
  }
  const pwError = checkPasswordRules(password);
  if (pwError) return res.status(400).json({ status: 'error', message: pwError });

  const { rows } = await db.query(
    `INSERT INTO users (tenant_id, full_name, email, role, password_hash)
     VALUES (NULL, $1, $2, 'super_admin', $3)
     RETURNING id, tenant_id, full_name, email, role`,
    [fullName, email, hashPassword(password)]
  );
  await audit.log(req, 'setup_super_admin', { userId: rows[0].id, tenantId: null, entity: 'users', entityId: rows[0].id, after: { email } });
  res.status(201).json({ status: 'ok', message: 'Super Admin ameundwa. Sasa ingia.' });
}));

// ---------- Login ----------
router.post('/login', asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  const key = email + '|' + req.ip;

  if (!email || !password) {
    return res.status(400).json({ status: 'error', message: 'Jaza barua pepe na password.' });
  }
  if (isBlocked(key)) {
    return res.status(429).json({ status: 'error', message: 'Umejaribu mara nyingi. Subiri dakika 15 kisha ujaribu tena.' });
  }

  const { rows } = await db.query(
    `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = $1`,
    [email]
  );
  const user = rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailure(key);
    await audit.log(req, 'login_failed', {
      userId: user ? user.id : null,
      tenantId: user ? user.tenant_id : null,
      entity: 'users',
      after: { email }
    });
    return res.status(401).json({ status: 'error', message: 'Barua pepe au password si sahihi.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ status: 'error', message: 'Akaunti hii imezimwa. Wasiliana na Admin wa hospitali.' });
  }
  if (user.role !== 'super_admin' && user.tenant_status === 'suspended') {
    return res.status(403).json({ status: 'error', message: 'Huduma ya hospitali hii imesimamishwa. Wasiliana na HUGO TECH.' });
  }

  failures.delete(key);
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  req.user = user;
  await audit.log(req, 'login', { entity: 'users', entityId: user.id });

  res.json({ status: 'ok', token: signToken(user), user: publicUser(user) });
}));

// ---------- Aliyeingia ----------
router.get('/me', requireAuth, (req, res) => {
  res.json({ status: 'ok', user: publicUser(req.user) });
});

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');

  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !verifyPassword(current, rows[0].password_hash)) {
    return res.status(400).json({ status: 'error', message: 'Password ya sasa si sahihi.' });
  }
  const pwError = checkPasswordRules(next);
  if (pwError) return res.status(400).json({ status: 'error', message: pwError });

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(next), req.user.id]);
  await audit.log(req, 'change_password', { entity: 'users', entityId: req.user.id });
  res.json({ status: 'ok', message: 'Password imebadilishwa.' });
}));

module.exports = router;
