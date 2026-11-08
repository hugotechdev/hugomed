// =============================================================
// HugoMed - Audit Trail
// Kila kitendo muhimu kinarekodiwa: nani, lini, kutoka wapi, nini.
// Rekodi za audit haziwezi kufutwa kupitia mfumo.
// =============================================================

const express = require('express');
const db = require('./db');
const { requireAuth, requireRole, asyncHandler } = require('./security');

// Kurekodi kitendo. Haizuii kazi kuu hata kama kurekodi kumeshindwa.
async function log(req, action, opts = {}) {
  try {
    const user = req.user || {};
    await db.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, before_data, after_data, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        opts.tenantId !== undefined ? opts.tenantId : (user.tenant_id || null),
        opts.userId !== undefined ? opts.userId : (user.id || null),
        action,
        opts.entity || null,
        opts.entityId !== undefined && opts.entityId !== null ? String(opts.entityId) : null,
        opts.before ? JSON.stringify(opts.before) : null,
        opts.after ? JSON.stringify(opts.after) : null,
        req.ip || null
      ]
    );
  } catch (err) {
    console.error('Audit haikurekodiwa:', err.message);
  }
}

// API ya kusoma Audit Trail
const router = express.Router();

router.get('/', requireAuth, requireRole('hospital_admin', 'super_admin'), asyncHandler(async (req, res) => {
  const params = [];
  let where = '';

  if (req.user.role === 'super_admin') {
    if (req.query.tenant_id) {
      params.push(Number(req.query.tenant_id));
      where = 'WHERE a.tenant_id = $1';
    }
  } else {
    params.push(req.user.tenant_id);
    where = 'WHERE a.tenant_id = $1';
  }

  const { rows } = await db.query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.at,
            a.before_data, a.after_data,
            u.full_name AS user_name, u.role AS user_role,
            t.name AS tenant_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN tenants t ON t.id = a.tenant_id
       ${where}
      ORDER BY a.at DESC
      LIMIT 200`,
    params
  );
  res.json({ status: 'ok', items: rows });
}));

module.exports = { log, router };
