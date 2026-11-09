// =============================================================
// HugoMed - Maabara na Radiology
//   GET  /api/lab/queue?type=lab|radiology    maagizo yanayosubiri, kwa mgonjwa
//   POST /api/lab/orders/:id/sample           sampuli imechukuliwa (namba ya sampuli)
//   POST /api/lab/orders/:id/result           kuingiza matokeo / ripoti
//   POST /api/lab/orders/:id/verify           uhakiki wa mtu wa pili
// Matokeo yote ya ziara yakihakikiwa, mgonjwa anarudi kwa daktari.
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { moveStage } = require('./visits');
const { rebuildInvoice } = require('./invoice');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('lab_technician', 'hospital_admin', 'doctor'));

const TZ = 'Africa/Dar_es_Salaam';

router.get('/queue', asyncHandler(async (req, res) => {
  const type = req.query.type === 'radiology' ? 'radiology' : 'lab';
  const { rows } = await db.query(
    `SELECT o.id AS order_id, o.status, o.ordered_at, o.instructions, s.name AS test_name,
            v.id AS visit_id, v.token, v.stage, v.priority, v.department,
            p.first_name, p.middle_name, p.last_name, p.sex, p.date_of_birth, p.mrn,
            py.name AS payer_name, py.type AS payer_type,
            u.full_name AS ordered_by_name,
            lr.id AS result_id, lr.sample_no, lr.sample_taken_at, lr.result, lr.notes AS result_notes,
            lr.entered_at, lr.verified_at, eu.full_name AS entered_by_name, lr.entered_by,
            inv.patient_amount, inv.waiver_amount,
            COALESCE((SELECT SUM(amount) FROM payments pm WHERE pm.invoice_id = inv.id), 0) AS paid
       FROM orders o
       JOIN services s ON s.id = o.service_id
       JOIN visits v ON v.id = o.visit_id
       JOIN patients p ON p.id = v.patient_id
       LEFT JOIN payers py ON py.id = v.payer_id
       LEFT JOIN users u ON u.id = o.ordered_by
       LEFT JOIN LATERAL (SELECT * FROM lab_results WHERE order_id = o.id ORDER BY id DESC LIMIT 1) lr ON TRUE
       LEFT JOIN users eu ON eu.id = lr.entered_by
       LEFT JOIN invoices inv ON inv.visit_id = v.id
      WHERE o.tenant_id = $1 AND o.type = $2
        AND o.status IN ('ordered', 'paid', 'in_progress')
        AND v.stage NOT IN ('completed', 'cancelled')
      ORDER BY CASE v.priority WHEN 'emergency' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END, o.ordered_at`,
    [req.user.tenant_id, type]
  );

  // Kupanga kwa mgonjwa (ziara)
  const byVisit = new Map();
  rows.forEach((r) => {
    if (!byVisit.has(r.visit_id)) {
      const due = Number(r.patient_amount || 0) - Number(r.waiver_amount || 0) - Number(r.paid || 0);
      byVisit.set(r.visit_id, {
        visit_id: r.visit_id, token: r.token, stage: r.stage, priority: r.priority, department: r.department,
        first_name: r.first_name, middle_name: r.middle_name, last_name: r.last_name, sex: r.sex,
        date_of_birth: r.date_of_birth, mrn: r.mrn, payer_name: r.payer_name || 'Cash', payer_type: r.payer_type || 'cash',
        unpaid: (r.payer_type || 'cash') === 'cash' && due > 0 ? due : 0,
        orders: []
      });
    }
    byVisit.get(r.visit_id).orders.push({
      order_id: r.order_id, test_name: r.test_name, status: r.status, ordered_at: r.ordered_at, instructions: r.instructions,
      ordered_by_name: r.ordered_by_name, sample_no: r.sample_no, sample_taken_at: r.sample_taken_at,
      result: r.result, result_notes: r.result_notes, entered_at: r.entered_at, entered_by: r.entered_by,
      entered_by_name: r.entered_by_name, verified_at: r.verified_at
    });
  });
  // Wagonjwa wa cash: deni la sasa (bili inajengwa kama bado haipo)
  const items = [...byVisit.values()];
  for (const v of items) {
    if (v.payer_type !== 'cash') continue;
    const bill = await rebuildInvoice(req.user.tenant_id, v.visit_id);
    v.unpaid = bill && bill.balance > 0 ? bill.balance : 0;
  }
  res.json({ status: 'ok', items });
}));

async function loadOrder(req, res) {
  const { rows } = await db.query(
    `SELECT o.*, s.name AS test_name, v.stage, v.tenant_id AS visit_tenant
       FROM orders o JOIN services s ON s.id = o.service_id JOIN visits v ON v.id = o.visit_id
      WHERE o.id = $1 AND o.tenant_id = $2 AND o.type IN ('lab', 'radiology')`,
    [Number(req.params.id), req.user.tenant_id]
  );
  const order = rows[0];
  if (!order) { res.status(404).json({ status: 'error', message: 'Agizo halipo.' }); return null; }
  if (['done', 'cancelled'].includes(order.status)) { res.status(400).json({ status: 'error', message: 'Agizo hili limeshakamilika.' }); return null; }
  return order;
}

async function latestResult(orderId) {
  const { rows } = await db.query('SELECT * FROM lab_results WHERE order_id = $1 ORDER BY id DESC LIMIT 1', [orderId]);
  return rows[0] || null;
}

// ---------- Sampuli ----------
router.post('/orders/:id/sample', requireRole('lab_technician', 'hospital_admin'), asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const existing = await latestResult(order.id);
  if (existing && existing.sample_no) return res.json({ status: 'ok', sample_no: existing.sample_no });

  const sampleNo = await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(3000, $1)', [req.user.tenant_id]);
    const n = await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM lab_results lr JOIN orders o ON o.id = lr.order_id
        WHERE o.tenant_id = $1 AND lr.sample_no IS NOT NULL
          AND EXTRACT(YEAR FROM lr.sample_taken_at AT TIME ZONE '${TZ}') = EXTRACT(YEAR FROM NOW() AT TIME ZONE '${TZ}')`,
      [req.user.tenant_id]
    );
    const prefix = order.type === 'radiology' ? 'RAD' : 'LAB';
    const no = prefix + '-' + String(new Date().getFullYear()).slice(2) + '-' + String(n.rows[0].n).padStart(5, '0');
    if (existing) {
      await client.query('UPDATE lab_results SET sample_no = $1, sample_taken_at = NOW(), sample_taken_by = $2 WHERE id = $3', [no, req.user.id, existing.id]);
    } else {
      await client.query(
        'INSERT INTO lab_results (tenant_id, order_id, sample_no, sample_taken_at, sample_taken_by) VALUES ($1, $2, $3, NOW(), $4)',
        [req.user.tenant_id, order.id, no, req.user.id]
      );
    }
    await client.query("UPDATE orders SET status = 'in_progress' WHERE id = $1", [order.id]);
    return no;
  });
  await audit.log(req, 'lab_sample', { entity: 'orders', entityId: order.id, after: { sample_no: sampleNo, test: order.test_name } });
  res.json({ status: 'ok', sample_no: sampleNo });
}));

// ---------- Matokeo ----------
router.post('/orders/:id/result', asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  if (order.type === 'lab' && !['lab_technician', 'hospital_admin'].includes(req.user.role)) {
    return res.status(403).json({ status: 'error', message: 'Matokeo ya maabara yanaingizwa na mtaalamu wa maabara.' });
  }
  const result = String((req.body && req.body.result) || '').trim();
  if (!result) return res.status(400).json({ status: 'error', message: 'Andika matokeo.' });
  const notes = String(req.body.notes || '').trim() || null;

  const existing = await latestResult(order.id);
  if (existing && existing.verified_at) return res.status(400).json({ status: 'error', message: 'Matokeo yameshahakikiwa; hayawezi kubadilishwa.' });
  if (existing) {
    await db.query('UPDATE lab_results SET result = $1, notes = $2, entered_by = $3, entered_at = NOW() WHERE id = $4', [result, notes, req.user.id, existing.id]);
  } else {
    await db.query(
      'INSERT INTO lab_results (tenant_id, order_id, result, notes, entered_by, entered_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [req.user.tenant_id, order.id, result, notes, req.user.id]
    );
  }
  await db.query("UPDATE orders SET status = 'in_progress' WHERE id = $1", [order.id]);
  await audit.log(req, 'lab_result', { entity: 'orders', entityId: order.id, before: existing ? { result: existing.result } : null, after: { result, test: order.test_name } });
  res.json({ status: 'ok', message: 'Matokeo yamehifadhiwa. Yanasubiri uhakiki wa mtu wa pili.' });
}));

// ---------- Uhakiki ----------
router.post('/orders/:id/verify', asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const r = await latestResult(order.id);
  if (!r || !r.result) return res.status(400).json({ status: 'error', message: 'Hakuna matokeo ya kuhakiki.' });

  // Mtu wa pili ahakiki, isipokuwa hospitali imeruhusu (Admin wa hospitali)
  if (r.entered_by === req.user.id && req.user.role !== 'hospital_admin') {
    return res.status(400).json({ status: 'error', message: 'Matokeo yahakikiwe na mtu mwingine, si aliyeyaingiza.' });
  }

  let movedBack = false;
  await db.transaction(async (client) => {
    await client.query('UPDATE lab_results SET verified_by = $1, verified_at = NOW() WHERE id = $2', [req.user.id, r.id]);
    await client.query("UPDATE orders SET status = 'done' WHERE id = $1", [order.id]);

    const pending = await client.query(
      "SELECT COUNT(*)::int AS n FROM orders WHERE visit_id = $1 AND type IN ('lab', 'radiology') AND status IN ('ordered', 'paid', 'in_progress')",
      [order.visit_id]
    );
    if (pending.rows[0].n === 0 && order.stage === 'lab') {
      const v = await client.query('SELECT * FROM visits WHERE id = $1', [order.visit_id]);
      await moveStage(client, v.rows[0], 'results', req.user.id, 'Matokeo yote yamehakikiwa');
      movedBack = true;
    }
  });
  await audit.log(req, 'lab_verify', { entity: 'orders', entityId: order.id, after: { result: r.result, test: order.test_name } });
  res.json({
    status: 'ok',
    message: movedBack ? 'Matokeo yamehakikiwa. Mgonjwa amerudishwa kwa daktari.' : 'Matokeo yamehakikiwa.'
  });
}));

module.exports = router;
