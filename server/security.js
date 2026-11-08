// =============================================================
// HugoMed - usalama: password, token za login, na ruhusa (roles)
// Inatumia crypto ya Node.js pekee (hakuna programu ya ziada).
// =============================================================

const crypto = require('crypto');
const db = require('./db');

let SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.warn('ONYO: JWT_SECRET haijawekwa au ni fupi (chini ya herufi 32). Kila server ikianza upya, watumiaji watalazimika kuingia upya. Weka JWT_SECRET kwenye Railway > Variables.');
  SECRET = crypto.randomBytes(48).toString('hex');
}

const TOKEN_HOURS = 12;

// ---------- Password ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(String(password), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Sheria za password: angalau herufi 8, iwe na herufi na namba
function checkPasswordRules(password) {
  const p = String(password || '');
  if (p.length < 8) return 'Password iwe na angalau herufi 8.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password iwe na herufi na namba.';
  return null;
}

// ---------- Token ----------
function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    uid: user.id,
    tid: user.tenant_id,
    role: user.role,
    iat: now,
    exp: now + TOKEN_HOURS * 3600
  }));
  return header + '.' + payload + '.' + sign(header + '.' + payload);
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = Buffer.from(sign(parts[0] + '.' + parts[1]));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ---------- Middleware ----------
// Inahakikisha mtumiaji ameingia, bado yuko hai, na hospitali yake haijasimamishwa
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ status: 'error', message: 'Tafadhali ingia (login) tena.' });
    }

    const { rows } = await db.query(
      `SELECT u.id, u.tenant_id, u.full_name, u.email, u.phone, u.role, u.is_active,
              u.professional_reg_no, u.license_expiry,
              t.name AS tenant_name, t.status AS tenant_status
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1`,
      [payload.uid]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ status: 'error', message: 'Akaunti hii imezimwa. Wasiliana na Admin.' });
    }
    if (user.role !== 'super_admin' && user.tenant_status === 'suspended') {
      return res.status(403).json({ status: 'error', message: 'Huduma ya hospitali hii imesimamishwa. Wasiliana na HUGO TECH.' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Inaruhusu roles zilizotajwa tu, mf. requireRole('hospital_admin', 'super_admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ status: 'error', message: 'Huna ruhusa ya kufanya hili.' });
    }
    next();
  };
}

// Inakamata makosa ya async na kuyapeleka kwa error handler
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Taarifa za mtumiaji zinazoweza kutumwa kwa browser (bila password)
function publicUser(u) {
  return {
    id: u.id,
    tenant_id: u.tenant_id,
    tenant_name: u.tenant_name || null,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone || null,
    role: u.role,
    professional_reg_no: u.professional_reg_no || null,
    license_expiry: u.license_expiry || null
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPasswordRules,
  signToken,
  verifyToken,
  requireAuth,
  requireRole,
  asyncHandler,
  publicUser
};
