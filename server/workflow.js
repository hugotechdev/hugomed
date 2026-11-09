// =============================================================
// HugoMed - kumaliza ziara: hatua ya mwisho, bili inafungwa, dai linatengenezwa
// =============================================================

const db = require('./db');
const { moveStage } = require('./visits');
const { rebuildInvoice } = require('./invoice');
const { generateClaim } = require('./claimcore');

async function completeVisit(visit, userId, note) {
  // Bili ya mwisho kabla ya kufunga
  const bill = await rebuildInvoice(visit.tenant_id, visit.id);
  await db.transaction(async (client) => {
    await moveStage(client, visit, 'completed', userId, note || 'Ziara imekamilika');
    if (bill) await client.query('UPDATE invoices SET finalized_at = COALESCE(finalized_at, NOW()) WHERE id = $1', [bill.invoice.id]);
  });
  const claim = await generateClaim(visit.tenant_id, visit.id);
  return { bill, claim };
}

// Baada ya malipo: mgonjwa aende pharmacy kama ana dawa ambazo hazijatolewa
async function nextAfterBilling(visit, userId) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM orders WHERE visit_id = $1 AND type = 'drug' AND status IN ('ordered', 'paid', 'in_progress')",
    [visit.id]
  );
  if (rows[0].n > 0) {
    await db.transaction(async (client) => {
      await moveStage(client, visit, 'pharmacy', userId, 'Malipo yamekamilika');
      await client.query('UPDATE invoices SET finalized_at = COALESCE(finalized_at, NOW()) WHERE visit_id = $1', [visit.id]);
    });
    return { next: 'pharmacy' };
  }
  const done = await completeVisit(visit, userId, 'Malipo yamekamilika');
  return { next: 'completed', claim: done.claim };
}

module.exports = { completeVisit, nextAfterBilling };
