// =============================================================
// HugoMed - kutengeneza na kukagua dai (NHIF, bima, kampuni)
// Dai linatengenezwa ziara ikikamilika, kwa sehemu ya bili inayolipwa na mlipaji.
// Pre-Audit (checks.js) inaendeshwa na makosa yanahifadhiwa kwenye claim_findings.
// =============================================================

const db = require('./db');
const { runChecks } = require('./checks');
const { loadInvoice } = require('./invoice');

const TZ = 'Africa/Dar_es_Salaam';
const OPEN_STATUSES = ['draft', 'has_errors', 'needs_info', 'ready'];

function statusFrom(checks) {
  if (checks.errors) return 'has_errors';
  if (checks.warnings) return 'needs_info';
  return 'ready';
}

// Inaendesha ukaguzi upya na kuhifadhi matokeo (kwa dai ambalo halijatumwa)
async function recheckClaim(claim) {
  // Item codes zilizoongezwa baadaye kwenye price list zinaingia kwenye dai (bei hazibadiliki)
  await db.query(
    `UPDATE invoice_items ii SET payer_item_code = sp.payer_item_code
       FROM price_lists pl, service_prices sp
      WHERE ii.invoice_id = $1 AND ii.payer_amount > 0
        AND (ii.payer_item_code IS NULL OR ii.payer_item_code = '')
        AND pl.payer_id = $2 AND sp.price_list_id = pl.id AND sp.service_id = ii.service_id
        AND sp.payer_item_code IS NOT NULL AND sp.payer_item_code <> ''`,
    [claim.invoice_id, claim.payer_id]
  );
  const checks = await runChecks(claim.tenant_id, claim.visit_id);
  if (!checks) return claim;
  await db.query('DELETE FROM claim_findings WHERE claim_id = $1 AND resolved_at IS NULL', [claim.id]);
  for (const f of checks.findings) {
    await db.query(
      'INSERT INTO claim_findings (tenant_id, claim_id, rule_code, severity, message) VALUES ($1, $2, $3, $4, $5)',
      [claim.tenant_id, claim.id, f.code, f.severity, f.message]
    );
  }
  const status = OPEN_STATUSES.includes(claim.status) ? statusFrom(checks) : claim.status;
  const { rows } = await db.query(
    'UPDATE claims SET readiness_score = $1, status = $2, checked_at = NOW() WHERE id = $3 RETURNING *',
    [checks.score, status, claim.id]
  );
  return rows[0];
}

async function generateClaim(tenantId, visitId) {
  const v = await db.query(
    `SELECT v.id, v.payer_id, py.type AS payer_type FROM visits v LEFT JOIN payers py ON py.id = v.payer_id
      WHERE v.id = $1 AND v.tenant_id = $2`,
    [visitId, tenantId]
  );
  const visit = v.rows[0];
  if (!visit || !visit.payer_type || visit.payer_type === 'cash') return null;

  const bill = await loadInvoice(tenantId, visitId);
  if (!bill || Number(bill.invoice.payer_amount) <= 0) return null;

  const existing = await db.query('SELECT * FROM claims WHERE invoice_id = $1 LIMIT 1', [bill.invoice.id]);
  let claim = existing.rows[0];
  if (claim) {
    if (OPEN_STATUSES.includes(claim.status)) {
      const upd = await db.query('UPDATE claims SET claimed_amount = $1 WHERE id = $2 RETURNING *', [bill.invoice.payer_amount, claim.id]);
      claim = upd.rows[0];
    }
  } else {
    claim = await db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(5000, $1)', [tenantId]);
      const n = await client.query(
        `SELECT COUNT(*)::int + 1 AS n FROM claims
          WHERE tenant_id = $1 AND to_char(created_at AT TIME ZONE '${TZ}', 'YYMM') = to_char(NOW() AT TIME ZONE '${TZ}', 'YYMM')`,
        [tenantId]
      );
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
      const no = 'CL' + String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(n.rows[0].n).padStart(4, '0');
      const ins = await client.query(
        `INSERT INTO claims (tenant_id, invoice_id, payer_id, visit_id, claim_no, status, claimed_amount)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING *`,
        [tenantId, bill.invoice.id, visit.payer_id, visit.id, no, bill.invoice.payer_amount]
      );
      return ins.rows[0];
    });
  }
  return recheckClaim(claim);
}

module.exports = { generateClaim, recheckClaim, OPEN_STATUSES };
