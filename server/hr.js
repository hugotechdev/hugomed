// =============================================================
// HugoMed - HR: wafanyakazi, mishahara, makato, likizo, zamu
//   GET   /api/hr/staff                     wafanyakazi + taarifa za mshahara
//   PATCH /api/hr/staff/:id                 mshahara, posho, akaunti ya benki, idara
//   GET   /api/hr/deductions                makato (yanawekwa na hospitali)
//   POST  /api/hr/deductions                kuongeza kato
//   PATCH /api/hr/deductions/:id            kubadilisha / kuzima
//   GET   /api/hr/payroll?month=YYYY-MM     payroll ya mwezi (CSV kwa &format=csv)
//   GET   /api/hr/leave                     likizo (HR: zote; wengine: zao)
//   POST  /api/hr/leave                     kuomba likizo
//   PATCH /api/hr/leave/:id                 kuidhinisha / kukataa (HR, Admin)
//   GET   /api/hr/roster?start=YYYY-MM-DD   ratiba ya zamu ya wiki
//   PUT   /api/hr/roster                    kuweka zamu ya mtu siku moja
// Viwango vya makato ya kisheria (PAYE, NSSF n.k.) HAVIKO ndani ya code:
// hospitali inaviweka na mhasibu anavihakiki.
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth);
const HR = ['hr_officer', 'hospital_admin'];
const STAFF = ['hospital_admin', 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer', 'accountant', 'hr_officer'];
router.use(requireRole(...STAFF));
const SHIFTS = ['morning', 'evening', 'night', 'oncall', 'off'];

// ---------- Wafanyakazi ----------
router.get('/staff', requireRole(...HR, 'accountant'), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, full_name, email, phone, role, department, professional_reg_no, license_expiry, is_active,
            basic_salary, allowances, bank_account
       FROM users WHERE tenant_id = $1 ORDER BY is_active DESC, full_name`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

router.patch('/staff/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await db.query('SELECT id, basic_salary, allowances, bank_account, department FROM users WHERE id = $1 AND tenant_id = $2', [id, req.user.tenant_id]);
  if (!before.rows[0]) return res.status(404).json({ status: 'error', message: 'Mfanyakazi hayupo.' });
  const sets = [];
  const params = [];
  for (const f of ['basic_salary', 'allowances', 'bank_account', 'department']) {
    if (req.body[f] === undefined) continue;
    let v = req.body[f] === '' ? null : req.body[f];
    if (['basic_salary', 'allowances'].includes(f) && v !== null) {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ status: 'error', message: 'Kiasi si sahihi.' });
    }
    params.push(v);
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });
  params.push(id);
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  await audit.log(req, 'update_staff_pay', { entity: 'users', entityId: id, before: before.rows[0], after: req.body });
  res.json({ status: 'ok', message: 'Imehifadhiwa.' });
}));

// ---------- Makato ----------
router.get('/deductions', requireRole(...HR, 'accountant'), asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM payroll_deductions WHERE tenant_id = $1 ORDER BY is_active DESC, name', [req.user.tenant_id]);
  res.json({ status: 'ok', items: rows });
}));

router.post('/deductions', requireRole(...HR), asyncHandler(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const percent = Number(req.body.percent || 0);
  const fixed = Number(req.body.fixed_amount || 0);
  if (!name) return res.status(400).json({ status: 'error', message: 'Andika jina la kato (mf. NSSF).' });
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isFinite(fixed) || fixed < 0) {
    return res.status(400).json({ status: 'error', message: 'Asilimia iwe 0 hadi 100 na kiasi kisiwe hasi.' });
  }
  const { rows } = await db.query('INSERT INTO payroll_deductions (tenant_id, name, percent, fixed_amount) VALUES ($1, $2, $3, $4) RETURNING *', [req.user.tenant_id, name, percent, fixed]);
  await audit.log(req, 'create_deduction', { entity: 'payroll_deductions', entityId: rows[0].id, after: rows[0] });
  res.status(201).json({ status: 'ok', deduction: rows[0] });
}));

router.patch('/deductions/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  const sets = [];
  const params = [];
  for (const f of ['name', 'percent', 'fixed_amount', 'is_active']) {
    if (req.body[f] === undefined) continue;
    params.push(req.body[f]);
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });
  params.push(Number(req.params.id), req.user.tenant_id);
  const { rows } = await db.query(`UPDATE payroll_deductions SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING *`, params);
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Kato halipo.' });
  await audit.log(req, 'update_deduction', { entity: 'payroll_deductions', entityId: rows[0].id, after: rows[0] });
  res.json({ status: 'ok', deduction: rows[0] });
}));

// ---------- Payroll ----------
router.get('/payroll', requireRole(...HR, 'accountant'), asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : new Date().toISOString().slice(0, 7);
  const [staff, deds] = await Promise.all([
    db.query(`SELECT id, full_name, role, department, bank_account, COALESCE(basic_salary, 0) AS basic_salary, COALESCE(allowances, 0) AS allowances
                FROM users WHERE tenant_id = $1 AND is_active = TRUE AND COALESCE(basic_salary, 0) > 0 ORDER BY full_name`, [req.user.tenant_id]),
    db.query('SELECT * FROM payroll_deductions WHERE tenant_id = $1 AND is_active = TRUE ORDER BY id', [req.user.tenant_id])
  ]);
  const leave = await db.query(
    `SELECT user_id, SUM(LEAST(end_date, (date_trunc('month', $2::date) + INTERVAL '1 month - 1 day')::date) - GREATEST(start_date, date_trunc('month', $2::date)::date) + 1)::int AS days
       FROM leave_requests
      WHERE tenant_id = $1 AND status = 'approved'
        AND start_date <= (date_trunc('month', $2::date) + INTERVAL '1 month - 1 day')::date
        AND end_date >= date_trunc('month', $2::date)::date
      GROUP BY user_id`,
    [req.user.tenant_id, month + '-01']
  );
  const leaveDays = {};
  leave.rows.forEach((r) => { leaveDays[r.user_id] = r.days; });

  const rows = staff.rows.map((s) => {
    const gross = Number(s.basic_salary) + Number(s.allowances);
    const deductions = deds.rows.map((d) => ({ name: d.name, amount: Math.round(gross * Number(d.percent) / 100 + Number(d.fixed_amount)) }));
    const total = deductions.reduce((a, d) => a + d.amount, 0);
    return { user_id: s.id, full_name: s.full_name, role: s.role, department: s.department, bank_account: s.bank_account,
      basic_salary: Number(s.basic_salary), allowances: Number(s.allowances), gross, deductions, total_deductions: total, net: gross - total, leave_days: leaveDays[s.id] || 0 };
  });

  if (req.query.format === 'csv') {
    const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const header = ['jina', 'kazi', 'idara', 'akaunti_ya_benki', 'mshahara_wa_msingi', 'posho', 'jumla_gross'].concat(deds.rows.map((d) => d.name), ['jumla_makato', 'net', 'siku_za_likizo']);
    const lines = [header.join(',')].concat(rows.map((r) => [r.full_name, r.role, r.department, r.bank_account, r.basic_salary, r.allowances, r.gross]
      .concat(r.deductions.map((d) => d.amount), [r.total_deductions, r.net, r.leave_days]).map(cell).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payroll-' + month + '.csv"');
    return res.end('﻿' + lines.join('\n'));
  }
  res.json({
    status: 'ok', month, deductions: deds.rows, items: rows,
    totals: { gross: rows.reduce((a, r) => a + r.gross, 0), deductions: rows.reduce((a, r) => a + r.total_deductions, 0), net: rows.reduce((a, r) => a + r.net, 0) }
  });
}));

// ---------- Likizo ----------
router.get('/leave', asyncHandler(async (req, res) => {
  const mineOnly = !HR.includes(req.user.role);
  const params = [req.user.tenant_id];
  let where = 'l.tenant_id = $1';
  if (mineOnly) { params.push(req.user.id); where += ' AND l.user_id = $2'; }
  const { rows } = await db.query(
    `SELECT l.*, u.full_name, u.role, d.full_name AS decided_by_name, (l.end_date - l.start_date + 1)::int AS days
       FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.decided_by
      WHERE ${where} ORDER BY l.created_at DESC LIMIT 200`,
    params
  );
  res.json({ status: 'ok', items: rows });
}));

router.post('/leave', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const userId = HR.includes(req.user.role) && b.user_id ? Number(b.user_id) : req.user.id;
  const u = await db.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [userId, req.user.tenant_id]);
  if (!u.rows[0]) return res.status(404).json({ status: 'error', message: 'Mfanyakazi hayupo.' });
  if (!b.start_date || !b.end_date || b.end_date < b.start_date) return res.status(400).json({ status: 'error', message: 'Chagua tarehe sahihi za kuanza na kumaliza.' });
  const type = String(b.leave_type || 'Likizo ya mwaka').slice(0, 60);
  const { rows } = await db.query(
    'INSERT INTO leave_requests (tenant_id, user_id, leave_type, start_date, end_date, reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [req.user.tenant_id, userId, type, b.start_date, b.end_date, b.reason || null]
  );
  await audit.log(req, 'leave_request', { entity: 'leave_requests', entityId: rows[0].id, after: { user_id: userId, type, start: b.start_date, end: b.end_date } });
  res.status(201).json({ status: 'ok', message: 'Ombi la likizo limetumwa.' });
}));

router.patch('/leave/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  const status = req.body && req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ status: 'error', message: 'Chagua kuidhinisha au kukataa.' });
  const { rows } = await db.query('UPDATE leave_requests SET status = $1, decided_by = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *', [status, req.user.id, Number(req.params.id), req.user.tenant_id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Ombi halipo.' });
  await audit.log(req, 'leave_' + status, { entity: 'leave_requests', entityId: rows[0].id });
  res.json({ status: 'ok', message: status === 'approved' ? 'Likizo imeidhinishwa.' : 'Likizo imekataliwa.' });
}));

// ---------- Zamu ----------
router.get('/roster', asyncHandler(async (req, res) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start || '')) ? req.query.start : null;
  const s = start ? new Date(start + 'T00:00:00Z') : (() => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d; })();
  const days = Array.from({ length: 7 }, (_, i) => new Date(s.getTime() + i * 864e5).toISOString().slice(0, 10));
  const [staff, shifts, leave] = await Promise.all([
    db.query("SELECT id, full_name, role, department FROM users WHERE tenant_id = $1 AND is_active = TRUE ORDER BY role, full_name", [req.user.tenant_id]),
    db.query('SELECT user_id, shift_date, shift FROM roster WHERE tenant_id = $1 AND shift_date BETWEEN $2::date AND $3::date', [req.user.tenant_id, days[0], days[6]]),
    db.query("SELECT user_id, start_date, end_date FROM leave_requests WHERE tenant_id = $1 AND status = 'approved' AND start_date <= $3::date AND end_date >= $2::date", [req.user.tenant_id, days[0], days[6]])
  ]);
  const map = {};
  shifts.rows.forEach((r) => { map[r.user_id + '|' + String(r.shift_date).slice(0, 10)] = r.shift; });
  const onLeave = {};
  leave.rows.forEach((l) => days.forEach((d) => { if (d >= String(l.start_date).slice(0, 10) && d <= String(l.end_date).slice(0, 10)) onLeave[l.user_id + '|' + d] = true; }));
  res.json({
    status: 'ok', days,
    items: staff.rows.map((u) => ({ ...u, shifts: days.map((d) => ({ date: d, shift: map[u.id + '|' + d] || null, leave: !!onLeave[u.id + '|' + d] })) }))
  });
}));

router.put('/roster', requireRole(...HR), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const u = await db.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [Number(b.user_id), req.user.tenant_id]);
  if (!u.rows[0]) return res.status(404).json({ status: 'error', message: 'Mfanyakazi hayupo.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.shift_date || ''))) return res.status(400).json({ status: 'error', message: 'Tarehe si sahihi.' });
  if (!b.shift) {
    await db.query('DELETE FROM roster WHERE user_id = $1 AND shift_date = $2::date', [u.rows[0].id, b.shift_date]);
    return res.json({ status: 'ok' });
  }
  if (!SHIFTS.includes(b.shift)) return res.status(400).json({ status: 'error', message: 'Zamu si sahihi.' });
  await db.query(
    `INSERT INTO roster (tenant_id, user_id, shift_date, shift) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, shift_date) DO UPDATE SET shift = EXCLUDED.shift`,
    [req.user.tenant_id, u.rows[0].id, b.shift_date, b.shift]
  );
  res.json({ status: 'ok' });
}));

module.exports = router;
