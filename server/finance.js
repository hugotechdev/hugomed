// =============================================================
// HugoMed - Fedha
//   GET   /api/finance/summary?from&to        mapato (malipo + madai yaliyolipwa) dhidi ya matumizi
//   GET   /api/finance/expenses?from&to       matumizi
//   POST  /api/finance/expenses               kuandika matumizi
//   PATCH /api/finance/expenses/:id           kuidhinisha / kukataa (Admin)
//   GET   /api/finance/receivables            wanaodaiwa: bima na kampuni, na ageing 0-30/31-60/61-90/90+
//   GET   /api/finance/statement/:payerId     statement ya mlipaji mmoja (CSV kwa ?format=csv)
//   GET   /api/finance/shifts                 zamu za cashier na tofauti za cash
// Hii ni fedha za kiutendaji. Uhasibu kamili (double-entry) unaweza kuongezwa
// au kuunganishwa na KEY ARCH ERP.
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'accountant'));
const TZ = 'Africa/Dar_es_Salaam';
const CATEGORIES = ['Mishahara', 'Dawa na vifaa', 'Umeme na maji', 'Kodi ya jengo', 'Matengenezo', 'Usafiri', 'Mawasiliano', 'Ofisi', 'Nyingine'];

function range(req) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  return { from: ok(req.query.from) ? req.query.from : iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: ok(req.query.to) ? req.query.to : iso(today) };
}

router.get('/summary', asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const t = req.user.tenant_id;
  const [pay, claims, exp, billed] = await Promise.all([
    db.query(`SELECT method, COALESCE(SUM(amount), 0) AS total FROM payments
               WHERE tenant_id = $1 AND (received_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date GROUP BY method`, [t, from, to]),
    db.query(`SELECT py.name, COALESCE(SUM(c.paid_amount), 0) AS total FROM claims c JOIN payers py ON py.id = c.payer_id
               WHERE c.tenant_id = $1 AND c.paid_at BETWEEN $2::date AND $3::date GROUP BY py.name`, [t, from, to]),
    db.query(`SELECT category, COALESCE(SUM(amount), 0) AS total FROM expenses
               WHERE tenant_id = $1 AND status = 'approved' AND expense_date BETWEEN $2::date AND $3::date GROUP BY category ORDER BY total DESC`, [t, from, to]),
    db.query(`SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(payer_amount), 0) AS payer, COALESCE(SUM(waiver_amount), 0) AS waivers
                FROM invoices WHERE tenant_id = $1 AND (created_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date`, [t, from, to])
  ]);
  const cash = pay.rows.reduce((a, r) => a + Number(r.total), 0);
  const claimsPaid = claims.rows.reduce((a, r) => a + Number(r.total), 0);
  const expenses = exp.rows.reduce((a, r) => a + Number(r.total), 0);
  res.json({
    status: 'ok', from, to,
    income: { patients: cash, claims: claimsPaid, total: cash + claimsPaid, by_method: pay.rows, by_payer: claims.rows },
    expenses: { total: expenses, by_category: exp.rows },
    billed: billed.rows[0],
    net: cash + claimsPaid - expenses
  });
}));

router.get('/expenses', asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { rows } = await db.query(
    `SELECT e.*, u.full_name AS created_by_name, a.full_name AS approved_by_name
       FROM expenses e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN users a ON a.id = e.approved_by
      WHERE e.tenant_id = $1 AND e.expense_date BETWEEN $2::date AND $3::date
      ORDER BY e.expense_date DESC, e.id DESC`,
    [req.user.tenant_id, from, to]
  );
  res.json({ status: 'ok', from, to, items: rows, categories: CATEGORIES });
}));

router.post('/expenses', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const amount = Number(b.amount);
  if (!String(b.description || '').trim()) return res.status(400).json({ status: 'error', message: 'Andika maelezo ya matumizi.' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ status: 'error', message: 'Andika kiasi sahihi.' });
  const category = CATEGORIES.includes(b.category) ? b.category : 'Nyingine';
  // Admin anaandika na kuidhinisha moja kwa moja; mhasibu anasubiri idhini
  const status = req.user.role === 'hospital_admin' ? 'approved' : 'pending';
  const { rows } = await db.query(
    `INSERT INTO expenses (tenant_id, expense_date, category, description, amount, paid_to, method, reference, status, created_by, approved_by)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [req.user.tenant_id, b.expense_date || null, category, String(b.description).trim(), amount, b.paid_to || null, b.method || null, b.reference || null,
     status, req.user.id, status === 'approved' ? req.user.id : null]
  );
  await audit.log(req, 'create_expense', { entity: 'expenses', entityId: rows[0].id, after: { category, amount, description: rows[0].description } });
  res.status(201).json({ status: 'ok', expense: rows[0], message: status === 'approved' ? 'Matumizi yamehifadhiwa.' : 'Matumizi yamehifadhiwa; yanasubiri idhini ya Admin.' });
}));

router.patch('/expenses/:id', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const status = req.body && req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ status: 'error', message: 'Chagua kuidhinisha au kukataa.' });
  const { rows } = await db.query('UPDATE expenses SET status = $1, approved_by = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *', [status, req.user.id, Number(req.params.id), req.user.tenant_id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Matumizi hayapo.' });
  await audit.log(req, status === 'approved' ? 'approve_expense' : 'reject_expense', { entity: 'expenses', entityId: rows[0].id, after: { amount: rows[0].amount } });
  res.json({ status: 'ok', message: status === 'approved' ? 'Yameidhinishwa.' : 'Yamekataliwa.' });
}));

// ---------- Wanaodaiwa (bima na kampuni) ----------
router.get('/receivables', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT py.id AS payer_id, py.name, py.type, py.credit_limit, py.payment_terms_days,
            COUNT(c.id)::int AS claims,
            COALESCE(SUM(c.claimed_amount - COALESCE(c.paid_amount, 0)), 0) AS outstanding,
            COALESCE(SUM(c.claimed_amount - COALESCE(c.paid_amount, 0)) FILTER (WHERE CURRENT_DATE - c.created_at::date <= 30), 0) AS d0_30,
            COALESCE(SUM(c.claimed_amount - COALESCE(c.paid_amount, 0)) FILTER (WHERE CURRENT_DATE - c.created_at::date BETWEEN 31 AND 60), 0) AS d31_60,
            COALESCE(SUM(c.claimed_amount - COALESCE(c.paid_amount, 0)) FILTER (WHERE CURRENT_DATE - c.created_at::date BETWEEN 61 AND 90), 0) AS d61_90,
            COALESCE(SUM(c.claimed_amount - COALESCE(c.paid_amount, 0)) FILTER (WHERE CURRENT_DATE - c.created_at::date > 90), 0) AS d90_plus
       FROM payers py
       JOIN claims c ON c.payer_id = py.id AND c.status NOT IN ('paid', 'rejected')
      WHERE py.tenant_id = $1
      GROUP BY py.id
      ORDER BY outstanding DESC`,
    [req.user.tenant_id]
  );
  rows.forEach((r) => { r.over_limit = r.credit_limit !== null && Number(r.outstanding) > Number(r.credit_limit); });
  res.json({ status: 'ok', items: rows });
}));

router.get('/statement/:payerId', asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const py = await db.query('SELECT * FROM payers WHERE id = $1 AND tenant_id = $2', [Number(req.params.payerId), req.user.tenant_id]);
  if (!py.rows[0]) return res.status(404).json({ status: 'error', message: 'Mlipaji hayupo.' });
  const { rows } = await db.query(
    `SELECT c.claim_no, c.status, c.claimed_amount, c.paid_amount, c.created_at, v.arrived_at,
            p.first_name, p.last_name, p.mrn, pp.member_number, pp.employee_number
       FROM claims c JOIN visits v ON v.id = c.visit_id JOIN patients p ON p.id = v.patient_id
       LEFT JOIN patient_payers pp ON pp.id = v.patient_payer_id
      WHERE c.payer_id = $1 AND c.tenant_id = $2 AND (v.arrived_at AT TIME ZONE '${TZ}')::date BETWEEN $3::date AND $4::date
      ORDER BY v.arrived_at`,
    [py.rows[0].id, req.user.tenant_id, from, to]
  );
  if (req.query.format === 'csv') {
    const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['tarehe', 'dai', 'mgonjwa', 'mrn', 'kadi', 'namba_ya_mfanyakazi', 'kiasi', 'kilicholipwa', 'hali'].join(',')]
      .concat(rows.map((r) => [String(r.arrived_at).slice(0, 10), r.claim_no, r.first_name + ' ' + r.last_name, r.mrn, r.member_number, r.employee_number, Number(r.claimed_amount), r.paid_amount === null ? '' : Number(r.paid_amount), r.status].map(cell).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="statement-' + py.rows[0].name.replace(/[^A-Za-z0-9]+/g, '-') + '.csv"');
    return res.end('﻿' + lines.join('\n'));
  }
  res.json({ status: 'ok', payer: py.rows[0], from, to, items: rows });
}));

router.get('/shifts', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, u.full_name AS cashier_name,
            (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.shift_id = s.id) AS collected,
            (SELECT COUNT(*)::int FROM payments p WHERE p.shift_id = s.id) AS payments
       FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id
      WHERE s.tenant_id = $1 ORDER BY s.opened_at DESC LIMIT 100`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

module.exports = router;
