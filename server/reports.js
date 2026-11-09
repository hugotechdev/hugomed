// =============================================================
// HugoMed - Dashboard na Ripoti
//   GET /api/reports/dashboard                    takwimu za leo na mwezi
//   GET /api/reports/diagnoses?from&to[&format=csv]  magonjwa kwa ICD-10, jinsia na umri (<5 / 5+)
//   GET /api/reports/revenue?from&to[&format=csv]    mapato kwa siku na njia ya malipo
//   GET /api/reports/visits?from&to[&format=csv]     ziara kwa siku na muda wa kusubiri
// Tarehe zote ni za Tanzania (Africa/Dar_es_Salaam).
// =============================================================

const express = require('express');
const db = require('./db');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'accountant', 'claims_officer', 'doctor'));
const TZ = 'Africa/Dar_es_Salaam';
const LOCAL = (col) => `(${col} AT TIME ZONE '${TZ}')`;

function range(req) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  return { from: ok(req.query.from) ? req.query.from : iso(first), to: ok(req.query.to) ? req.query.to : iso(today) };
}

function csv(res, name, header, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '.csv"');
  res.end('﻿' + [header.join(',')].concat(rows.map((r) => r.map(cell).join(','))).join('\n'));
}

// ---------- Dashboard ----------
router.get('/dashboard', asyncHandler(async (req, res) => {
  const t = req.user.tenant_id;
  const today = `${LOCAL('NOW()')}::date`;
  const month = `date_trunc('month', ${LOCAL('NOW()')})`;
  const q = (sql, params = [t]) => db.query(sql, params).then((r) => r.rows);

  const [visits, revenue, methods, claims, dx, cats, waiting, stock, beds] = await Promise.all([
    q(`SELECT
         COUNT(*) FILTER (WHERE ${LOCAL('arrived_at')}::date = ${today})::int AS today,
         COUNT(*) FILTER (WHERE ${LOCAL('arrived_at')} >= ${month})::int AS month,
         COUNT(*) FILTER (WHERE stage NOT IN ('completed', 'cancelled'))::int AS inside
       FROM visits WHERE tenant_id = $1 AND stage <> 'cancelled'`),
    q(`SELECT
         COALESCE(SUM(amount) FILTER (WHERE ${LOCAL('received_at')}::date = ${today}), 0) AS today,
         COALESCE(SUM(amount) FILTER (WHERE ${LOCAL('received_at')} >= ${month}), 0) AS month
       FROM payments WHERE tenant_id = $1`),
    q(`SELECT method, COALESCE(SUM(amount), 0) AS total FROM payments
        WHERE tenant_id = $1 AND ${LOCAL('received_at')} >= ${month} GROUP BY method ORDER BY total DESC`),
    q(`SELECT status, COUNT(*)::int AS n, COALESCE(SUM(claimed_amount), 0) AS amount, COALESCE(SUM(paid_amount), 0) AS paid
         FROM claims WHERE tenant_id = $1 GROUP BY status`),
    q(`SELECT d.icd10_code, MAX(d.description) AS description, COUNT(DISTINCT d.visit_id)::int AS n
         FROM diagnoses d JOIN visits v ON v.id = d.visit_id
        WHERE d.tenant_id = $1 AND ${LOCAL('v.arrived_at')} >= ${month}
        GROUP BY d.icd10_code ORDER BY n DESC LIMIT 8`),
    q(`SELECT COALESCE(ii.category, 'other') AS category, COALESCE(SUM(ii.amount), 0) AS total
         FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
        WHERE ii.tenant_id = $1 AND ${LOCAL('inv.created_at')} >= ${month}
        GROUP BY 1 ORDER BY total DESC`),
    q(`SELECT COUNT(*)::int AS n FROM visits v
        WHERE v.tenant_id = $1 AND v.stage IN ('triage', 'doctor', 'lab', 'billing', 'pharmacy')
          AND NOW() - (SELECT MAX(e.at) FROM visit_events e WHERE e.visit_id = v.id) > INTERVAL '30 minutes'`),
    q(`SELECT
         COUNT(*) FILTER (WHERE s.reorder_level > 0 AND COALESCE(st.qty, 0) <= s.reorder_level)::int AS low,
         COUNT(*) FILTER (WHERE COALESCE(st.qty, 0) <= 0 AND EXISTS (SELECT 1 FROM stock_items x WHERE x.service_id = s.id))::int AS out,
         (SELECT COUNT(*)::int FROM stock_items si WHERE si.tenant_id = $1 AND si.quantity > 0 AND si.expiry_date < CURRENT_DATE + 90) AS expiring
       FROM services s
       LEFT JOIN (SELECT service_id, SUM(quantity) AS qty FROM stock_items WHERE tenant_id = $1 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE) GROUP BY service_id) st ON st.service_id = s.id
      WHERE s.tenant_id = $1 AND s.category = 'drug' AND s.is_active = TRUE`),
    q(`SELECT (SELECT COUNT(*)::int FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.tenant_id = $1 AND b.is_active AND w.is_active) AS total,
              (SELECT COUNT(*)::int FROM admissions WHERE tenant_id = $1 AND status = 'admitted') AS used`)
  ]);

  res.json({
    status: 'ok',
    visits: visits[0], revenue: revenue[0], methods, claims, top_diagnoses: dx,
    revenue_by_category: cats, long_waits: waiting[0].n, stock: stock[0], beds: beds[0]
  });
}));

// ---------- Magonjwa (kama MTUHA: kwa jinsia na umri) ----------
router.get('/diagnoses', asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await db.query(
    `SELECT d.icd10_code, MAX(d.description) AS description,
            COUNT(DISTINCT d.visit_id) FILTER (WHERE p.sex = 'M' AND age(v.arrived_at, p.date_of_birth) < INTERVAL '5 years')::int AS m_under5,
            COUNT(DISTINCT d.visit_id) FILTER (WHERE p.sex = 'F' AND age(v.arrived_at, p.date_of_birth) < INTERVAL '5 years')::int AS f_under5,
            COUNT(DISTINCT d.visit_id) FILTER (WHERE p.sex = 'M' AND (p.date_of_birth IS NULL OR age(v.arrived_at, p.date_of_birth) >= INTERVAL '5 years'))::int AS m_5plus,
            COUNT(DISTINCT d.visit_id) FILTER (WHERE p.sex = 'F' AND (p.date_of_birth IS NULL OR age(v.arrived_at, p.date_of_birth) >= INTERVAL '5 years'))::int AS f_5plus,
            COUNT(DISTINCT d.visit_id)::int AS total
       FROM diagnoses d JOIN visits v ON v.id = d.visit_id JOIN patients p ON p.id = v.patient_id
      WHERE d.tenant_id = $1 AND v.stage <> 'cancelled'
        AND ${LOCAL('v.arrived_at')}::date BETWEEN $2::date AND $3::date
      GROUP BY d.icd10_code ORDER BY total DESC, d.icd10_code`,
    [req.user.tenant_id, from, to]
  );
  if (req.query.format === 'csv') {
    return csv(res, 'magonjwa-' + from + '-' + to, ['icd10', 'maelezo', 'me_chini_ya_5', 'ke_chini_ya_5', 'me_5_na_zaidi', 'ke_5_na_zaidi', 'jumla'],
      rows.map((r) => [r.icd10_code, r.description, r.m_under5, r.f_under5, r.m_5plus, r.f_5plus, r.total]));
  }
  res.json({ status: 'ok', from, to, items: rows });
}));

// ---------- Mapato ----------
router.get('/revenue', asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await db.query(
    `SELECT ${LOCAL('received_at')}::date AS day, method, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n
       FROM payments WHERE tenant_id = $1 AND ${LOCAL('received_at')}::date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2 ORDER BY 1, 2`,
    [req.user.tenant_id, from, to]
  );
  const claims = await db.query(
    `SELECT COALESCE(SUM(paid_amount), 0) AS paid FROM claims WHERE tenant_id = $1 AND paid_at BETWEEN $2::date AND $3::date`,
    [req.user.tenant_id, from, to]
  );
  if (req.query.format === 'csv') {
    return csv(res, 'mapato-' + from + '-' + to, ['tarehe', 'njia', 'idadi', 'kiasi'], rows.map((r) => [String(r.day).slice(0, 10), r.method, r.n, Number(r.total)]));
  }
  res.json({ status: 'ok', from, to, items: rows, claims_paid: Number(claims.rows[0].paid) });
}));

// ---------- Ziara na muda wa kusubiri ----------
router.get('/visits', asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await db.query(
    `SELECT ${LOCAL('arrived_at')}::date AS day,
            COUNT(*)::int AS visits,
            COUNT(*) FILTER (WHERE stage = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE stage = 'cancelled')::int AS cancelled,
            ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - arrived_at)) / 60) FILTER (WHERE completed_at IS NOT NULL))::int AS avg_minutes
       FROM visits WHERE tenant_id = $1 AND ${LOCAL('arrived_at')}::date BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY 1`,
    [req.user.tenant_id, from, to]
  );
  if (req.query.format === 'csv') {
    return csv(res, 'ziara-' + from + '-' + to, ['tarehe', 'ziara', 'zimekamilika', 'zimesitishwa', 'wastani_dakika'], rows.map((r) => [String(r.day).slice(0, 10), r.visits, r.completed, r.cancelled, r.avg_minutes]));
  }
  res.json({ status: 'ok', from, to, items: rows });
}));

module.exports = router;
