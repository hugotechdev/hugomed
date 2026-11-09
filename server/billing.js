// =============================================================
// HugoMed - Malipo (Cashier), price lists, msamaha, zamu za cashier
//   GET  /api/billing/queue                         wanaosubiri malipo
//   GET  /api/billing/visits/:id                    bili ya ziara (inajengwa upya)
//   POST /api/billing/visits/:id/payments           kupokea malipo (au kurudisha: kiasi hasi)
//   POST /api/billing/visits/:id/waiver             msamaha (Admin / Mhasibu)
//   POST /api/billing/visits/:id/finalize           kufunga bili -> pharmacy au kukamilika
//   GET  /api/billing/payments/:id/receipt          risiti
//   GET  /api/billing/shift                         zamu yangu iliyo wazi
//   POST /api/billing/shift/open | /shift/close
//   GET  /api/billing/price-lists                   price lists za hospitali
//   GET  /api/billing/price-lists/:id               bei za kila huduma
//   PUT  /api/billing/price-lists/:id               kuhifadhi bei
//   POST /api/billing/price-lists/:id/copy-cash     kunakili bei za cash
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { rebuildInvoice } = require('./invoice');
const { nextAfterBilling } = require('./workflow');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('cashier', 'hospital_admin', 'accountant', 'receptionist', 'claims_officer', 'pharmacist'));
const CASHIERS = ['cashier', 'hospital_admin', 'accountant'];
const METHODS = ['cash', 'mpesa', 'airtel_money', 'tigo_pesa', 'halopesa', 'selcom', 'azampay', 'bank', 'card', 'other'];
const TZ = 'Africa/Dar_es_Salaam';

async function getVisit(req, res) {
  const { rows } = await db.query(
    `SELECT v.*, p.first_name, p.middle_name, p.last_name, p.mrn, p.phone, p.sex, p.date_of_birth,
            py.name AS payer_name, py.type AS payer_type, py.copay_percent,
            pp.member_number, pp.employee_number
       FROM visits v JOIN patients p ON p.id = v.patient_id
       LEFT JOIN payers py ON py.id = v.payer_id
       LEFT JOIN patient_payers pp ON pp.id = v.patient_payer_id
      WHERE v.id = $1 AND v.tenant_id = $2`,
    [Number(req.params.id), req.user.tenant_id]
  );
  if (!rows[0]) { res.status(404).json({ status: 'error', message: 'Ziara haipo.' }); return null; }
  return rows[0];
}

// ---------- Foleni ya malipo ----------
router.get('/queue', asyncHandler(async (req, res) => {
  const base = `
    SELECT v.id, v.token, v.stage, v.priority, v.arrived_at, v.department,
           p.first_name, p.middle_name, p.last_name, p.mrn,
           py.name AS payer_name, COALESCE(py.type, 'cash') AS payer_type,
           inv.invoice_no, inv.total, inv.patient_amount, inv.payer_amount, inv.waiver_amount,
           COALESCE((SELECT SUM(amount) FROM payments pm WHERE pm.invoice_id = inv.id), 0) AS paid
      FROM visits v JOIN patients p ON p.id = v.patient_id
      LEFT JOIN payers py ON py.id = v.payer_id
      LEFT JOIN invoices inv ON inv.visit_id = v.id
     WHERE v.tenant_id = $1`;
  const billing = await db.query(`${base} AND v.stage = 'billing' ORDER BY v.arrived_at`, [req.user.tenant_id]);
  // Wagonjwa wa cash walio ndani wenye maagizo: wanaweza kulipa kabla ya huduma
  const prepay = await db.query(
    `${base} AND v.stage IN ('doctor', 'lab', 'results', 'admitted', 'pharmacy')
       AND EXISTS (SELECT 1 FROM orders o WHERE o.visit_id = v.id AND o.status <> 'cancelled')
     ORDER BY v.arrived_at`,
    [req.user.tenant_id]
  );
  const shape = (r) => Object.assign(r, { balance: Math.round(Number(r.patient_amount || 0) - Number(r.waiver_amount || 0) - Number(r.paid || 0)) });
  res.json({ status: 'ok', billing: billing.rows.map(shape), other: prepay.rows.map(shape) });
}));

// ---------- Bili ya ziara ----------
router.get('/visits/:id', asyncHandler(async (req, res) => {
  const visit = await getVisit(req, res);
  if (!visit) return;
  const bill = await rebuildInvoice(req.user.tenant_id, visit.id);
  const payments = await db.query(
    `SELECT pm.*, u.full_name AS received_by_name FROM payments pm LEFT JOIN users u ON u.id = pm.received_by
      WHERE pm.invoice_id = $1 ORDER BY pm.received_at`,
    [bill.invoice.id]
  );
  const claim = await db.query('SELECT claim_no, status, readiness_score FROM claims WHERE invoice_id = $1', [bill.invoice.id]);
  res.json({ status: 'ok', visit, bill, payments: payments.rows, claim: claim.rows[0] || null });
}));

// ---------- Zamu ya cashier ----------
async function openShift(userId, tenantId) {
  const { rows } = await db.query('SELECT * FROM cashier_shifts WHERE cashier_id = $1 AND tenant_id = $2 AND closed_at IS NULL ORDER BY id DESC LIMIT 1', [userId, tenantId]);
  return rows[0] || null;
}

async function shiftTotals(shiftId) {
  const { rows } = await db.query(
    `SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n FROM payments WHERE shift_id = $1 GROUP BY method ORDER BY method`,
    [shiftId]
  );
  return rows;
}

router.get('/shift', requireRole(...CASHIERS), asyncHandler(async (req, res) => {
  const shift = await openShift(req.user.id, req.user.tenant_id);
  res.json({ status: 'ok', shift, totals: shift ? await shiftTotals(shift.id) : [] });
}));

router.post('/shift/open', requireRole(...CASHIERS), asyncHandler(async (req, res) => {
  let shift = await openShift(req.user.id, req.user.tenant_id);
  if (!shift) {
    const { rows } = await db.query('INSERT INTO cashier_shifts (tenant_id, cashier_id) VALUES ($1, $2) RETURNING *', [req.user.tenant_id, req.user.id]);
    shift = rows[0];
    await audit.log(req, 'open_shift', { entity: 'cashier_shifts', entityId: shift.id });
  }
  res.json({ status: 'ok', shift });
}));

router.post('/shift/close', requireRole(...CASHIERS), asyncHandler(async (req, res) => {
  const shift = await openShift(req.user.id, req.user.tenant_id);
  if (!shift) return res.status(400).json({ status: 'error', message: 'Huna zamu iliyo wazi.' });
  const counted = Number(req.body && req.body.counted_cash);
  if (!Number.isFinite(counted) || counted < 0) return res.status(400).json({ status: 'error', message: 'Andika kiasi cha cash ulichohesabu.' });
  const totals = await shiftTotals(shift.id);
  const expectedCash = totals.filter((t) => t.method === 'cash').reduce((a, t) => a + Number(t.total), 0);
  const expectedOther = totals.filter((t) => t.method !== 'cash').reduce((a, t) => a + Number(t.total), 0);
  const { rows } = await db.query(
    `UPDATE cashier_shifts SET closed_at = NOW(), expected_cash = $1, expected_other = $2, counted_cash = $3, notes = $4 WHERE id = $5 RETURNING *`,
    [expectedCash, expectedOther, counted, req.body.notes || null, shift.id]
  );
  const diff = Math.round(counted - expectedCash);
  await audit.log(req, 'close_shift', { entity: 'cashier_shifts', entityId: shift.id, after: { expected_cash: expectedCash, counted_cash: counted, difference: diff } });
  res.json({
    status: 'ok', shift: rows[0], totals, difference: diff,
    message: diff === 0 ? 'Zamu imefungwa. Cash inalingana.' : 'Zamu imefungwa. Tofauti ya cash: TSh ' + diff.toLocaleString('en-US') + '.'
  });
}));

// ---------- Malipo ----------
router.post('/visits/:id/payments', requireRole(...CASHIERS), asyncHandler(async (req, res) => {
  const visit = await getVisit(req, res);
  if (!visit) return;
  if (visit.stage === 'cancelled') return res.status(400).json({ status: 'error', message: 'Ziara imesitishwa.' });

  const method = String(req.body.method || '');
  const amount = Math.round(Number(req.body.amount));
  if (!METHODS.includes(method)) return res.status(400).json({ status: 'error', message: 'Chagua njia ya malipo.' });
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ status: 'error', message: 'Andika kiasi sahihi.' });
  if (method !== 'cash' && amount > 0 && !String(req.body.reference || '').trim()) {
    return res.status(400).json({ status: 'error', message: 'Andika namba ya muamala (reference) ya ' + method + '.' });
  }

  const bill = await rebuildInvoice(req.user.tenant_id, visit.id);
  if (amount > 0 && amount > bill.balance) {
    return res.status(400).json({ status: 'error', message: 'Kiasi kinazidi deni la TSh ' + bill.balance.toLocaleString('en-US') + '. Chenji itolewe nje ya mfumo.' });
  }
  if (amount < 0 && -amount > -bill.balance) {
    return res.status(400).json({ status: 'error', message: 'Hakuna kiasi cha kurudisha kinacholingana na hiki.' });
  }

  let shift = await openShift(req.user.id, req.user.tenant_id);
  if (!shift) {
    const s = await db.query('INSERT INTO cashier_shifts (tenant_id, cashier_id) VALUES ($1, $2) RETURNING *', [req.user.tenant_id, req.user.id]);
    shift = s.rows[0];
  }

  const payment = await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(6000, $1)', [req.user.tenant_id]);
    const n = await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM payments
        WHERE tenant_id = $1 AND (received_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`,
      [req.user.tenant_id]
    );
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    const receipt = 'R' + String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(n.rows[0].n).padStart(4, '0');
    const ins = await client.query(
      `INSERT INTO payments (tenant_id, invoice_id, method, amount, reference, shift_id, received_by, receipt_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.tenant_id, bill.invoice.id, method, amount, req.body.reference || null, shift.id, req.user.id, receipt]
    );
    return ins.rows[0];
  });

  await audit.log(req, amount > 0 ? 'payment' : 'refund', { entity: 'invoices', entityId: bill.invoice.id, after: { receipt: payment.receipt_no, method, amount } });
  const after = await rebuildInvoice(req.user.tenant_id, visit.id);
  res.status(201).json({ status: 'ok', payment, balance: after.balance, message: (amount > 0 ? 'Malipo yamepokelewa' : 'Fedha imerudishwa') + '. Risiti ' + payment.receipt_no + '.' });
}));

// ---------- Msamaha ----------
router.post('/visits/:id/waiver', requireRole('hospital_admin', 'accountant'), asyncHandler(async (req, res) => {
  const visit = await getVisit(req, res);
  if (!visit) return;
  const amount = Math.round(Number(req.body.amount));
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ status: 'error', message: 'Andika sababu ya msamaha (mf. mtoto chini ya miaka 5, mzee, hana uwezo).' });
  const bill = await rebuildInvoice(req.user.tenant_id, visit.id);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number(bill.invoice.patient_amount)) {
    return res.status(400).json({ status: 'error', message: 'Msamaha uwe kati ya 0 na TSh ' + Number(bill.invoice.patient_amount).toLocaleString('en-US') + '.' });
  }
  await db.query('UPDATE invoices SET waiver_amount = $1, waiver_reason = $2, waiver_by = $3 WHERE id = $4', [amount, reason, req.user.id, bill.invoice.id]);
  await audit.log(req, 'waiver', { entity: 'invoices', entityId: bill.invoice.id, before: { waiver_amount: bill.invoice.waiver_amount }, after: { waiver_amount: amount, reason } });
  res.json({ status: 'ok', message: 'Msamaha wa TSh ' + amount.toLocaleString('en-US') + ' umewekwa.' });
}));

// ---------- Kufunga bili ----------
router.post('/visits/:id/finalize', requireRole(...CASHIERS), asyncHandler(async (req, res) => {
  const visit = await getVisit(req, res);
  if (!visit) return;
  if (visit.stage !== 'billing') return res.status(400).json({ status: 'error', message: 'Mgonjwa hayuko kwenye hatua ya malipo (' + visit.stage + ').' });
  const bill = await rebuildInvoice(req.user.tenant_id, visit.id);
  if (bill.balance > 0) return res.status(400).json({ status: 'error', message: 'Bado anadaiwa TSh ' + bill.balance.toLocaleString('en-US') + '.' });
  if (bill.warnings.some((w) => w.includes('bei haijawekwa'))) {
    if (!req.body || !req.body.confirm_missing_prices) {
      return res.status(400).json({ status: 'error', code: 'missing_prices', message: 'Kuna huduma zisizo na bei. Weka bei kwenye price list, au thibitisha kuendelea.' });
    }
  }
  const result = await nextAfterBilling(visit, req.user.id);
  await audit.log(req, 'finalize_invoice', { entity: 'invoices', entityId: bill.invoice.id, after: { next: result.next, total: bill.invoice.total } });
  res.json({
    status: 'ok', next: result.next,
    message: result.next === 'pharmacy' ? 'Bili imefungwa. Mgonjwa aende pharmacy.' : 'Bili imefungwa. Ziara imekamilika.' + (result.claim ? ' Dai ' + result.claim.claim_no + ' limetengenezwa.' : '')
  });
}));

// ---------- Risiti ----------
router.get('/payments/:id/receipt', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT pm.*, inv.invoice_no, inv.total, inv.patient_amount, inv.payer_amount, inv.waiver_amount, inv.id AS invoice_id,
            v.token, v.visit_no, p.first_name, p.middle_name, p.last_name, p.mrn,
            py.name AS payer_name, u.full_name AS cashier_name, t.name AS tenant_name, t.phone AS tenant_phone, t.address AS tenant_address
       FROM payments pm JOIN invoices inv ON inv.id = pm.invoice_id JOIN visits v ON v.id = inv.visit_id
       JOIN patients p ON p.id = v.patient_id LEFT JOIN payers py ON py.id = v.payer_id
       LEFT JOIN users u ON u.id = pm.received_by JOIN tenants t ON t.id = pm.tenant_id
      WHERE pm.id = $1 AND pm.tenant_id = $2`,
    [Number(req.params.id), req.user.tenant_id]
  );
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Risiti haipo.' });
  const items = await db.query('SELECT description, quantity, unit_price, amount, payer_amount, patient_amount FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [rows[0].invoice_id]);
  const paid = await db.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1', [rows[0].invoice_id]);
  res.json({ status: 'ok', receipt: rows[0], items: items.rows, total_paid: Number(paid.rows[0].paid) });
}));

// ---------- Price lists ----------
router.get('/price-lists', requireRole('hospital_admin', 'accountant', 'cashier'), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT pl.id, pl.name, py.type AS payer_type, py.name AS payer_name, py.is_active,
            (SELECT COUNT(*)::int FROM service_prices sp WHERE sp.price_list_id = pl.id AND sp.price > 0) AS priced
       FROM price_lists pl LEFT JOIN payers py ON py.id = pl.payer_id
      WHERE pl.tenant_id = $1
      ORDER BY CASE py.type WHEN 'cash' THEN 1 WHEN 'nhif' THEN 2 WHEN 'insurance' THEN 3 ELSE 4 END, pl.name`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

async function getPriceList(req, res) {
  const { rows } = await db.query(
    `SELECT pl.*, py.type AS payer_type FROM price_lists pl LEFT JOIN payers py ON py.id = pl.payer_id WHERE pl.id = $1 AND pl.tenant_id = $2`,
    [Number(req.params.id), req.user.tenant_id]
  );
  if (!rows[0]) { res.status(404).json({ status: 'error', message: 'Price list haipo.' }); return null; }
  return rows[0];
}

router.get('/price-lists/:id', requireRole('hospital_admin', 'accountant', 'cashier'), asyncHandler(async (req, res) => {
  const pl = await getPriceList(req, res);
  if (!pl) return;
  const { rows } = await db.query(
    `SELECT s.id AS service_id, s.name, s.category, s.code, s.unit,
            sp.price, sp.payer_item_code, COALESCE(sp.is_covered, TRUE) AS is_covered
       FROM services s LEFT JOIN service_prices sp ON sp.service_id = s.id AND sp.price_list_id = $1
      WHERE s.tenant_id = $2 AND s.is_active = TRUE
      ORDER BY s.category, s.name`,
    [pl.id, req.user.tenant_id]
  );
  res.json({ status: 'ok', price_list: pl, items: rows });
}));

router.put('/price-lists/:id', requireRole('hospital_admin', 'accountant'), asyncHandler(async (req, res) => {
  const pl = await getPriceList(req, res);
  if (!pl) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  let saved = 0;
  for (const it of items) {
    const price = Number(it.price);
    if (!it.service_id || !Number.isFinite(price) || price < 0) continue;
    const svc = await db.query('SELECT 1 FROM services WHERE id = $1 AND tenant_id = $2', [it.service_id, req.user.tenant_id]);
    if (!svc.rows.length) continue;
    await db.query(
      `INSERT INTO service_prices (tenant_id, price_list_id, service_id, price, payer_item_code, is_covered)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (price_list_id, service_id) DO UPDATE SET price = EXCLUDED.price, payer_item_code = EXCLUDED.payer_item_code, is_covered = EXCLUDED.is_covered`,
      [req.user.tenant_id, pl.id, it.service_id, price, it.payer_item_code || null, it.is_covered !== false]
    );
    saved += 1;
  }
  await audit.log(req, 'update_prices', { entity: 'price_lists', entityId: pl.id, after: { name: pl.name, items: saved } });
  res.json({ status: 'ok', saved, message: 'Bei ' + saved + ' zimehifadhiwa kwenye ' + pl.name + '.' });
}));

router.post('/price-lists/:id/copy-cash', requireRole('hospital_admin', 'accountant'), asyncHandler(async (req, res) => {
  const pl = await getPriceList(req, res);
  if (!pl) return;
  const cash = await db.query(
    `SELECT pl.id FROM price_lists pl JOIN payers py ON py.id = pl.payer_id WHERE pl.tenant_id = $1 AND py.type = 'cash' LIMIT 1`,
    [req.user.tenant_id]
  );
  if (!cash.rows[0] || cash.rows[0].id === pl.id) return res.status(400).json({ status: 'error', message: 'Chagua price list nyingine, si ya Cash.' });
  const rows = await db.query('SELECT service_id, price FROM service_prices WHERE price_list_id = $1', [cash.rows[0].id]);
  let n = 0;
  for (const r of rows.rows) {
    const exists = await db.query('SELECT 1 FROM service_prices WHERE price_list_id = $1 AND service_id = $2', [pl.id, r.service_id]);
    if (exists.rows.length) continue;
    await db.query('INSERT INTO service_prices (tenant_id, price_list_id, service_id, price, is_covered) VALUES ($1, $2, $3, $4, TRUE)', [req.user.tenant_id, pl.id, r.service_id, r.price]);
    n += 1;
  }
  await audit.log(req, 'copy_prices', { entity: 'price_lists', entityId: pl.id, after: { copied: n } });
  res.json({ status: 'ok', message: n + ' bei zimenakiliwa kutoka Cash. Zile zilizokuwepo hazijaguswa.' });
}));

module.exports = router;
