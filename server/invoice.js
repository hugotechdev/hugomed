// =============================================================
// HugoMed - kuhesabu bili ya ziara (inatumika na Malipo, Pharmacy, IPD, Madai)
//
// Bili inajengwa upya kutoka kwa maagizo kila inapoangaliwa, mpaka ziara ikamilike:
//  - ushauri wa daktari (kama mgonjwa alimwona daktari)
//  - kila agizo (vipimo, dawa, huduma) ambalo halijasitishwa
//  - siku za kitanda kwa mgonjwa aliyelazwa
// Kila mstari unagawanywa: sehemu ya mlipaji (NHIF/bima/kampuni) na ya mgonjwa.
// Huduma isiyolipwa na bima, mgonjwa analipa kwa bei ya cash.
// =============================================================

const db = require('./db');

const TZ = 'Africa/Dar_es_Salaam';

function round(n) {
  return Math.round(Number(n || 0));
}

async function priceMap(priceListId) {
  const map = {};
  if (!priceListId) return map;
  const { rows } = await db.query('SELECT service_id, price, payer_item_code, is_covered FROM service_prices WHERE price_list_id = $1', [priceListId]);
  rows.forEach((r) => { map[r.service_id] = r; });
  return map;
}

async function getPriceLists(tenantId, payerId) {
  const cash = await db.query(
    `SELECT pl.id FROM price_lists pl JOIN payers py ON py.id = pl.payer_id
      WHERE pl.tenant_id = $1 AND py.type = 'cash' ORDER BY pl.id LIMIT 1`,
    [tenantId]
  );
  const payer = payerId
    ? await db.query('SELECT id FROM price_lists WHERE tenant_id = $1 AND payer_id = $2 ORDER BY id LIMIT 1', [tenantId, payerId])
    : { rows: [] };
  return { cashListId: cash.rows[0] ? cash.rows[0].id : null, payerListId: payer.rows[0] ? payer.rows[0].id : null };
}

// Inahakikisha ziara ina bili (namba ya bili kwa mwezi)
async function ensureInvoice(visit) {
  const existing = await db.query('SELECT * FROM invoices WHERE visit_id = $1 ORDER BY id LIMIT 1', [visit.id]);
  if (existing.rows[0]) return existing.rows[0];
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4000, $1)', [visit.tenant_id]);
    const again = await client.query('SELECT * FROM invoices WHERE visit_id = $1 ORDER BY id LIMIT 1', [visit.id]);
    if (again.rows[0]) return again.rows[0];
    const n = await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM invoices
        WHERE tenant_id = $1 AND to_char(created_at AT TIME ZONE '${TZ}', 'YYMM') = to_char(NOW() AT TIME ZONE '${TZ}', 'YYMM')`,
      [visit.tenant_id]
    );
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    const no = 'INV' + String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(n.rows[0].n).padStart(4, '0');
    const ins = await client.query(
      'INSERT INTO invoices (tenant_id, visit_id, invoice_no, payer_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [visit.tenant_id, visit.id, no, visit.payer_id]
    );
    return ins.rows[0];
  });
}

async function paidFor(invoiceId) {
  const { rows } = await db.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1', [invoiceId]);
  return Number(rows[0].paid);
}

function summarize(invoice, paid) {
  const balance = round(Number(invoice.patient_amount) - Number(invoice.waiver_amount) - paid);
  return { paid: round(paid), balance };
}

// Kusoma bili bila kuijenga upya (kwa ziara iliyokamilika)
async function loadInvoice(tenantId, visitId) {
  const inv = await db.query('SELECT * FROM invoices WHERE visit_id = $1 AND tenant_id = $2 ORDER BY id LIMIT 1', [visitId, tenantId]);
  if (!inv.rows[0]) return null;
  const items = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [inv.rows[0].id]);
  const paid = await paidFor(inv.rows[0].id);
  return Object.assign({ invoice: inv.rows[0], items: items.rows, warnings: [] }, summarize(inv.rows[0], paid));
}

async function rebuildInvoice(tenantId, visitId) {
  const vr = await db.query(
    `SELECT v.*, py.type AS payer_type, py.name AS payer_name, py.copay_percent
       FROM visits v LEFT JOIN payers py ON py.id = v.payer_id
      WHERE v.id = $1 AND v.tenant_id = $2`,
    [visitId, tenantId]
  );
  const visit = vr.rows[0];
  if (!visit) return null;

  // Ziara iliyokamilika au kusitishwa: bili haibadiliki tena
  if (['completed', 'cancelled'].includes(visit.stage)) {
    const existing = await loadInvoice(tenantId, visitId);
    if (existing) return existing;
  }

  const invoice = await ensureInvoice(visit);
  const payerType = visit.payer_type || 'cash';
  const copay = Number(visit.copay_percent || 0);
  const { cashListId, payerListId } = await getPriceLists(tenantId, visit.payer_id);
  const cashPrices = await priceMap(cashListId);
  const payerPrices = payerType === 'cash' ? cashPrices : await priceMap(payerListId);

  // ---------- Mistari ya bili ----------
  const lines = [];

  const orders = await db.query(
    `SELECT o.id, o.service_id, o.quantity, o.type, s.name, s.category
       FROM orders o JOIN services s ON s.id = o.service_id
      WHERE o.visit_id = $1 AND o.status <> 'cancelled' ORDER BY o.id`,
    [visit.id]
  );
  const sawDoctor = await db.query("SELECT 1 FROM visit_events WHERE visit_id = $1 AND stage = 'doctor' LIMIT 1", [visit.id]);
  if (sawDoctor.rows.length && !orders.rows.some((o) => o.category === 'consultation')) {
    const cons = await db.query(
      `SELECT id, name, category FROM services WHERE tenant_id = $1 AND category = 'consultation' AND is_active = TRUE
        ORDER BY CASE WHEN code = 'CONS-OPD' THEN 0 ELSE 1 END, id LIMIT 1`,
      [tenantId]
    );
    if (cons.rows[0]) lines.push({ order_id: null, service_id: cons.rows[0].id, description: cons.rows[0].name, category: 'consultation', quantity: 1 });
  }
  orders.rows.forEach((o) => lines.push({ order_id: o.id, service_id: o.service_id, description: o.name, category: o.category, quantity: Number(o.quantity) }));

  const adm = await db.query(
    `SELECT a.admitted_at, a.discharged_at, w.name AS ward_name, w.bed_service_id
       FROM admissions a LEFT JOIN beds b ON b.id = a.bed_id LEFT JOIN wards w ON w.id = b.ward_id
      WHERE a.visit_id = $1`,
    [visit.id]
  );
  adm.rows.forEach((a) => {
    if (!a.bed_service_id) return;
    const end = a.discharged_at ? new Date(a.discharged_at) : new Date();
    const days = Math.max(1, Math.ceil((end - new Date(a.admitted_at)) / 864e5));
    lines.push({ order_id: null, service_id: a.bed_service_id, description: 'Kitanda: ' + (a.ward_name || 'wodi') + ' (siku ' + days + ')', category: 'bed', quantity: days });
  });

  // ---------- Bei na mgawanyo ----------
  const warnings = [];
  let total = 0, payerTotal = 0, patientTotal = 0;
  lines.forEach((l) => {
    const cash = cashPrices[l.service_id] ? Number(cashPrices[l.service_id].price) : 0;
    l.payer_item_code = null;
    l.covered = false;
    if (payerType === 'cash') {
      l.unit_price = cash;
      l.amount = round(cash * l.quantity);
      l.payer_amount = 0;
      l.patient_amount = l.amount;
    } else {
      const row = payerPrices[l.service_id];
      if (row && row.is_covered && Number(row.price) > 0) {
        l.covered = true;
        l.unit_price = Number(row.price);
        l.payer_item_code = row.payer_item_code || null;
        l.amount = round(l.unit_price * l.quantity);
        l.payer_amount = round(l.amount * (1 - copay / 100));
        l.patient_amount = l.amount - l.payer_amount;
        if (!row.payer_item_code && payerType === 'nhif') warnings.push(l.description + ': haina NHIF item code kwenye price list.');
      } else {
        l.unit_price = cash;
        l.amount = round(cash * l.quantity);
        l.payer_amount = 0;
        l.patient_amount = l.amount;
        warnings.push(l.description + ': hailipwi na ' + visit.payer_name + '. Mgonjwa analipa bei ya cash.');
      }
    }
    if (!l.unit_price) warnings.push(l.description + ': bei haijawekwa kwenye price list.');
    total += l.amount;
    payerTotal += l.payer_amount;
    patientTotal += l.patient_amount;
  });

  await db.transaction(async (client) => {
    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoice.id]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO invoice_items (tenant_id, invoice_id, order_id, service_id, description, quantity, unit_price, amount, payer_item_code, payer_amount, patient_amount, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [tenantId, invoice.id, l.order_id, l.service_id, l.description, l.quantity, l.unit_price, l.amount, l.payer_item_code, l.payer_amount, l.patient_amount, l.category]
      );
    }
  });

  const paid = await paidFor(invoice.id);
  const balance = round(patientTotal - Number(invoice.waiver_amount) - paid);
  let status = 'open';
  if (balance <= 0 && (patientTotal > 0 || invoice.finalized_at)) status = 'paid';
  else if (paid > 0) status = 'partially_paid';

  const upd = await db.query(
    `UPDATE invoices SET total = $1, payer_amount = $2, patient_amount = $3, payer_id = $4, status = $5 WHERE id = $6 RETURNING *`,
    [total, payerTotal, patientTotal, visit.payer_id, status, invoice.id]
  );
  const items = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [invoice.id]);
  const covered = {};
  lines.forEach((l, i) => { covered[i] = l.covered; });
  return {
    invoice: upd.rows[0],
    items: items.rows.map((it, i) => Object.assign(it, { covered: covered[i] })),
    paid: round(paid),
    balance,
    warnings
  };
}

module.exports = { rebuildInvoice, loadInvoice, ensureInvoice, getPriceLists };
