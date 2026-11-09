// =============================================================
// HugoMed - Pharmacy na Stock
//   GET  /api/pharmacy/queue                      wagonjwa wenye dawa za kutoa
//   GET  /api/pharmacy/visits/:id                 dawa za ziara + stock iliyopo
//   POST /api/pharmacy/orders/:id/dispense        kutoa dawa (batch inayoisha mapema kwanza)
//   POST /api/pharmacy/orders/:id/unavailable     dawa haipo stock (inaondolewa kwenye bili)
//   POST /api/pharmacy/visits/:id/complete        kumaliza ziara baada ya kutoa dawa
//   GET  /api/stock                               stock ya dawa: jumla, batches, tahadhari
//   POST /api/stock/receive                       kupokea mzigo
//   POST /api/stock/adjust                        kurekebisha (kuharibika, kuisha muda, kuhesabu)
//   PATCH /api/stock/reorder/:serviceId           kiwango cha kuagiza upya
//   GET  /api/stock/movements?service_id=         historia ya stock
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { rebuildInvoice } = require('./invoice');
const { completeVisit } = require('./workflow');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const pharmacy = express.Router();
const stock = express.Router();
pharmacy.use(requireAuth, requireRole('pharmacist', 'hospital_admin', 'nurse'));
stock.use(requireAuth, requireRole('pharmacist', 'hospital_admin', 'accountant', 'doctor', 'nurse'));
const PHARM = ['pharmacist', 'hospital_admin'];

// Batches zilizopo (hazijaisha muda), inayoisha mapema kwanza
async function availableBatches(serviceId, tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM stock_items
      WHERE service_id = $1 AND tenant_id = $2 AND quantity > 0
        AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
      ORDER BY expiry_date NULLS LAST, received_at`,
    [serviceId, tenantId]
  );
  return rows;
}

// ---------- Foleni ----------
pharmacy.get('/queue', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT v.id, v.token, v.stage, v.priority, v.department, v.arrived_at,
            p.first_name, p.middle_name, p.last_name, p.mrn, p.allergies,
            py.name AS payer_name,
            (SELECT COUNT(*)::int FROM orders o WHERE o.visit_id = v.id AND o.type = 'drug' AND o.status IN ('ordered', 'paid', 'in_progress')) AS pending
       FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN payers py ON py.id = v.payer_id
      WHERE v.tenant_id = $1 AND (v.stage = 'pharmacy'
         OR (v.stage = 'admitted' AND EXISTS (SELECT 1 FROM orders o WHERE o.visit_id = v.id AND o.type = 'drug' AND o.status IN ('ordered', 'paid', 'in_progress'))))
      ORDER BY CASE v.stage WHEN 'pharmacy' THEN 0 ELSE 1 END, v.arrived_at`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

pharmacy.get('/visits/:id', asyncHandler(async (req, res) => {
  const vr = await db.query(
    `SELECT v.*, p.first_name, p.middle_name, p.last_name, p.mrn, p.allergies, p.sex, p.date_of_birth, py.name AS payer_name
       FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN payers py ON py.id = v.payer_id
      WHERE v.id = $1 AND v.tenant_id = $2`,
    [Number(req.params.id), req.user.tenant_id]
  );
  const visit = vr.rows[0];
  if (!visit) return res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
  const orders = await db.query(
    `SELECT o.*, s.name, s.unit, u.full_name AS doctor_name,
            COALESCE((SELECT json_agg(json_build_object('batch', si.batch_no, 'quantity', d.quantity, 'expiry', si.expiry_date))
                        FROM dispensing d JOIN stock_items si ON si.id = d.stock_item_id WHERE d.order_id = o.id), '[]'::json) AS dispensed
       FROM orders o JOIN services s ON s.id = o.service_id LEFT JOIN users u ON u.id = o.ordered_by
      WHERE o.visit_id = $1 AND o.type = 'drug' ORDER BY o.id`,
    [visit.id]
  );
  for (const o of orders.rows) {
    const batches = await availableBatches(o.service_id, req.user.tenant_id);
    o.in_stock = batches.reduce((a, b) => a + Number(b.quantity), 0);
    o.next_batch = batches[0] ? { batch_no: batches[0].batch_no, expiry_date: batches[0].expiry_date } : null;
  }
  const bill = await rebuildInvoice(req.user.tenant_id, visit.id);
  res.json({ status: 'ok', visit, orders: orders.rows, balance: bill ? bill.balance : 0 });
}));

async function loadDrugOrder(req, res) {
  const { rows } = await db.query(
    `SELECT o.*, s.name, v.stage, v.id AS visit_id
       FROM orders o JOIN services s ON s.id = o.service_id JOIN visits v ON v.id = o.visit_id
      WHERE o.id = $1 AND o.tenant_id = $2 AND o.type = 'drug'`,
    [Number(req.params.id), req.user.tenant_id]
  );
  const o = rows[0];
  if (!o) { res.status(404).json({ status: 'error', message: 'Agizo la dawa halipo.' }); return null; }
  if (!['ordered', 'paid', 'in_progress'].includes(o.status)) { res.status(400).json({ status: 'error', message: o.name + ' imeshashughulikiwa.' }); return null; }
  if (!['pharmacy', 'admitted'].includes(o.stage)) { res.status(400).json({ status: 'error', message: 'Mgonjwa hajafika pharmacy (bili haijafungwa).' }); return null; }
  return o;
}

// ---------- Kutoa dawa ----------
pharmacy.post('/orders/:id/dispense', requireRole(...PHARM), asyncHandler(async (req, res) => {
  const order = await loadDrugOrder(req, res);
  if (!order) return;
  const need = Number(order.quantity);
  const batches = await availableBatches(order.service_id, req.user.tenant_id);
  const have = batches.reduce((a, b) => a + Number(b.quantity), 0);
  if (have < need) {
    return res.status(400).json({ status: 'error', message: 'Stock haitoshi: ' + order.name + ' inahitajika ' + need + ', zipo ' + have + '. Pokea mzigo au weka "Haipo stock".' });
  }

  const used = await db.transaction(async (client) => {
    let left = need;
    const out = [];
    for (const b of batches) {
      if (left <= 0) break;
      const take = Math.min(left, Number(b.quantity));
      await client.query('UPDATE stock_items SET quantity = quantity - $1 WHERE id = $2', [take, b.id]);
      await client.query('INSERT INTO dispensing (tenant_id, order_id, stock_item_id, quantity, dispensed_by) VALUES ($1, $2, $3, $4, $5)',
        [req.user.tenant_id, order.id, b.id, take, req.user.id]);
      await client.query(`INSERT INTO stock_movements (tenant_id, stock_item_id, change, reason, order_id, user_id) VALUES ($1, $2, $3, 'dispensed', $4, $5)`,
        [req.user.tenant_id, b.id, -take, order.id, req.user.id]);
      out.push({ batch: b.batch_no, quantity: take });
      left -= take;
    }
    await client.query("UPDATE orders SET status = 'done' WHERE id = $1", [order.id]);
    return out;
  });
  await audit.log(req, 'dispense', { entity: 'orders', entityId: order.id, after: { drug: order.name, quantity: need, batches: used } });
  res.json({ status: 'ok', message: order.name + ' imetolewa (' + need + ').', batches: used });
}));

pharmacy.post('/orders/:id/unavailable', requireRole(...PHARM), asyncHandler(async (req, res) => {
  const order = await loadDrugOrder(req, res);
  if (!order) return;
  const note = String((req.body && req.body.note) || '').trim() || 'Haipo stock';
  await db.query("UPDATE orders SET status = 'cancelled', instructions = TRIM(COALESCE(instructions, '') || ' [Pharmacy: ' || $1 || ']') WHERE id = $2", [note, order.id]);
  const bill = await rebuildInvoice(req.user.tenant_id, order.visit_id);
  await audit.log(req, 'drug_unavailable', { entity: 'orders', entityId: order.id, after: { drug: order.name, note } });
  res.json({
    status: 'ok',
    message: order.name + ' imeondolewa kwenye bili.' + (bill && bill.balance < 0 ? ' Mgonjwa arudishiwe ' + Math.abs(bill.balance).toLocaleString('en-US') + ' TSh na cashier.' : '')
  });
}));

pharmacy.post('/visits/:id/complete', requireRole(...PHARM), asyncHandler(async (req, res) => {
  const vr = await db.query('SELECT * FROM visits WHERE id = $1 AND tenant_id = $2', [Number(req.params.id), req.user.tenant_id]);
  const visit = vr.rows[0];
  if (!visit) return res.status(404).json({ status: 'error', message: 'Ziara haipo.' });
  if (visit.stage !== 'pharmacy') return res.status(400).json({ status: 'error', message: 'Ziara hii haiko pharmacy.' });
  const pending = await db.query("SELECT COUNT(*)::int AS n FROM orders WHERE visit_id = $1 AND type = 'drug' AND status IN ('ordered', 'paid', 'in_progress')", [visit.id]);
  if (pending.rows[0].n) return res.status(400).json({ status: 'error', message: 'Bado kuna dawa ' + pending.rows[0].n + ' hazijatolewa.' });
  const done = await completeVisit(visit, req.user.id, 'Dawa zimetolewa');
  await audit.log(req, 'complete_visit', { entity: 'visits', entityId: visit.id });
  res.json({ status: 'ok', message: 'Ziara imekamilika.' + (done.claim ? ' Dai ' + done.claim.claim_no + ' limetengenezwa.' : ''), balance: done.bill ? done.bill.balance : 0 });
}));

// =============================================================
// Stock
// =============================================================
stock.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id AS service_id, s.name, s.unit, s.code, s.reorder_level,
            COALESCE(SUM(si.quantity) FILTER (WHERE si.expiry_date IS NULL OR si.expiry_date >= CURRENT_DATE), 0) AS usable,
            COALESCE(SUM(si.quantity) FILTER (WHERE si.expiry_date < CURRENT_DATE), 0) AS expired,
            COALESCE(SUM(si.quantity) FILTER (WHERE si.expiry_date >= CURRENT_DATE AND si.expiry_date < CURRENT_DATE + 90), 0) AS expiring_soon,
            MIN(si.expiry_date) FILTER (WHERE si.quantity > 0 AND si.expiry_date >= CURRENT_DATE) AS next_expiry,
            COUNT(si.id) > 0 AS ever_received,
            COALESCE(SUM(si.quantity * COALESCE(si.unit_cost, 0)) FILTER (WHERE si.expiry_date IS NULL OR si.expiry_date >= CURRENT_DATE), 0) AS value,
            COALESCE((SELECT json_agg(json_build_object('id', b.id, 'batch_no', b.batch_no, 'expiry_date', b.expiry_date, 'quantity', b.quantity, 'unit_cost', b.unit_cost, 'supplier', b.supplier) ORDER BY b.expiry_date NULLS LAST)
                        FROM stock_items b WHERE b.service_id = s.id AND b.quantity > 0), '[]'::json) AS batches
       FROM services s LEFT JOIN stock_items si ON si.service_id = s.id
      WHERE s.tenant_id = $1 AND s.category = 'drug' AND s.is_active = TRUE
      GROUP BY s.id
      ORDER BY s.name`,
    [req.user.tenant_id]
  );
  rows.forEach((r) => {
    r.low = Number(r.reorder_level) > 0 && Number(r.usable) <= Number(r.reorder_level);
    r.out = r.ever_received && Number(r.usable) <= 0;
  });
  res.json({ status: 'ok', items: rows });
}));

stock.post('/receive', requireRole(...PHARM), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const qty = Number(b.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ status: 'error', message: 'Andika idadi iliyopokelewa.' });
  if (!String(b.batch_no || '').trim()) return res.status(400).json({ status: 'error', message: 'Andika namba ya batch.' });
  if (!b.expiry_date) return res.status(400).json({ status: 'error', message: 'Andika tarehe ya kuisha muda (expiry).' });
  if (new Date(b.expiry_date) < new Date(new Date().toDateString())) return res.status(400).json({ status: 'error', message: 'Batch hii imeshaisha muda; usiipokee.' });
  const svc = await db.query("SELECT id, name FROM services WHERE id = $1 AND tenant_id = $2 AND category = 'drug'", [b.service_id, req.user.tenant_id]);
  if (!svc.rows[0]) return res.status(400).json({ status: 'error', message: 'Chagua dawa.' });

  const item = await db.transaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO stock_items (tenant_id, service_id, batch_no, expiry_date, quantity, unit_cost, supplier)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenant_id, svc.rows[0].id, String(b.batch_no).trim(), b.expiry_date, qty, b.unit_cost ? Number(b.unit_cost) : null, b.supplier || null]
    );
    await client.query(`INSERT INTO stock_movements (tenant_id, stock_item_id, change, reason, note, user_id) VALUES ($1, $2, $3, 'received', $4, $5)`,
      [req.user.tenant_id, ins.rows[0].id, qty, b.supplier ? 'Kutoka ' + b.supplier : null, req.user.id]);
    return ins.rows[0];
  });
  await audit.log(req, 'stock_receive', { entity: 'stock_items', entityId: item.id, after: { drug: svc.rows[0].name, batch: item.batch_no, quantity: qty, expiry: b.expiry_date } });
  res.status(201).json({ status: 'ok', message: svc.rows[0].name + ': ' + qty + ' zimepokelewa (batch ' + item.batch_no + ').' });
}));

stock.post('/adjust', requireRole(...PHARM), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const change = Number(b.change);
  const reason = ['adjusted', 'expired', 'returned'].includes(b.reason) ? b.reason : 'adjusted';
  const note = String(b.note || '').trim();
  if (!Number.isFinite(change) || change === 0) return res.status(400).json({ status: 'error', message: 'Andika idadi ya kuongeza (+) au kupunguza (−).' });
  if (!note) return res.status(400).json({ status: 'error', message: 'Andika sababu ya marekebisho.' });
  const si = await db.query('SELECT si.*, s.name FROM stock_items si JOIN services s ON s.id = si.service_id WHERE si.id = $1 AND si.tenant_id = $2', [b.stock_item_id, req.user.tenant_id]);
  const item = si.rows[0];
  if (!item) return res.status(404).json({ status: 'error', message: 'Batch haipo.' });
  if (Number(item.quantity) + change < 0) return res.status(400).json({ status: 'error', message: 'Batch ina ' + Number(item.quantity) + ' tu.' });
  await db.transaction(async (client) => {
    await client.query('UPDATE stock_items SET quantity = quantity + $1 WHERE id = $2', [change, item.id]);
    await client.query('INSERT INTO stock_movements (tenant_id, stock_item_id, change, reason, note, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.tenant_id, item.id, change, reason, note, req.user.id]);
  });
  await audit.log(req, 'stock_adjust', { entity: 'stock_items', entityId: item.id, before: { quantity: item.quantity }, after: { change, reason, note } });
  res.json({ status: 'ok', message: item.name + ' (batch ' + item.batch_no + '): ' + (change > 0 ? '+' : '') + change + '.' });
}));

stock.patch('/reorder/:serviceId', requireRole(...PHARM), asyncHandler(async (req, res) => {
  const level = Number(req.body && req.body.reorder_level);
  if (!Number.isFinite(level) || level < 0) return res.status(400).json({ status: 'error', message: 'Kiwango si sahihi.' });
  const { rows } = await db.query("UPDATE services SET reorder_level = $1 WHERE id = $2 AND tenant_id = $3 AND category = 'drug' RETURNING name", [level, Number(req.params.serviceId), req.user.tenant_id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'Dawa haipo.' });
  res.json({ status: 'ok', message: rows[0].name + ': kiwango cha kuagiza upya ni ' + level + '.' });
}));

stock.get('/movements', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.*, si.batch_no, s.name, u.full_name AS user_name
       FROM stock_movements m JOIN stock_items si ON si.id = m.stock_item_id JOIN services s ON s.id = si.service_id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = $1 AND ($2::int IS NULL OR si.service_id = $2::int)
      ORDER BY m.at DESC LIMIT 200`,
    [req.user.tenant_id, req.query.service_id ? Number(req.query.service_id) : null]
  );
  res.json({ status: 'ok', items: rows });
}));

module.exports = { pharmacy, stock };
