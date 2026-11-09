// =============================================================
// HugoMed - Madai ya NHIF, bima na kampuni
//   GET  /api/claims?status=&payer_id=&from=&to=   orodha na idadi kwa hali
//   GET  /api/claims/export.csv?...                CSV ya madai (kupakia kwenye portal ya mlipaji)
//   GET  /api/claims/rejections                    uchambuzi wa sababu za kukataliwa
//   GET  /api/claims/:id                           dai moja: huduma, makosa, taarifa za ziara
//   POST /api/claims/:id/recheck                   kukagua upya
//   POST /api/claims/:id/accept-warnings           kukubali tahadhari (kwa maelezo)
//   POST /api/claims/submit                        kutuma madai yaliyo tayari
//   POST /api/claims/:id/paid                      malipo ya mlipaji
//   POST /api/claims/:id/rejected                  limekataliwa (na sababu)
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { recheckClaim, OPEN_STATUSES } = require('./claimcore');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('claims_officer', 'hospital_admin', 'accountant'));

const STATUSES = ['draft', 'has_errors', 'needs_info', 'ready', 'submitted', 'paid', 'partially_paid', 'rejected'];

function filters(req, params) {
  const where = ['c.tenant_id = $1'];
  if (req.query.status && STATUSES.includes(req.query.status)) { params.push(req.query.status); where.push(`c.status = $${params.length}`); }
  if (req.query.payer_id) { params.push(Number(req.query.payer_id)); where.push(`c.payer_id = $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`c.created_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`c.created_at < ($${params.length}::date + 1)`); }
  return where.join(' AND ');
}

const LIST_SQL = `
  SELECT c.*, py.name AS payer_name, py.type AS payer_type,
         v.token, v.visit_no, v.arrived_at, v.completed_at,
         p.first_name, p.middle_name, p.last_name, p.mrn, p.sex, p.date_of_birth,
         pp.member_number, pp.employee_number,
         d.full_name AS doctor_name, d.professional_reg_no,
         (SELECT COUNT(*)::int FROM claim_findings f WHERE f.claim_id = c.id AND f.severity = 'error' AND f.resolved_at IS NULL) AS error_count,
         (SELECT COUNT(*)::int FROM claim_findings f WHERE f.claim_id = c.id AND f.severity = 'warning' AND f.resolved_at IS NULL) AS warning_count,
         (SELECT string_agg(dx.icd10_code, ' ') FROM diagnoses dx WHERE dx.visit_id = c.visit_id) AS icd10_codes
    FROM claims c
    JOIN payers py ON py.id = c.payer_id
    JOIN visits v ON v.id = c.visit_id
    JOIN patients p ON p.id = v.patient_id
    LEFT JOIN patient_payers pp ON pp.id = v.patient_payer_id
    LEFT JOIN users d ON d.id = v.assigned_doctor_id`;

router.get('/', asyncHandler(async (req, res) => {
  const params = [req.user.tenant_id];
  const where = filters(req, params);
  const { rows } = await db.query(`${LIST_SQL} WHERE ${where} ORDER BY c.created_at DESC LIMIT 500`, params);

  // Idadi na thamani kwa kila hali (bila kichujio cha hali)
  const p2 = [req.user.tenant_id];
  const saved = req.query.status;
  req.query.status = undefined;
  const w2 = filters(req, p2);
  req.query.status = saved;
  const counts = await db.query(
    `SELECT c.status, COUNT(*)::int AS n, COALESCE(SUM(c.claimed_amount), 0) AS amount
       FROM claims c WHERE ${w2} GROUP BY c.status`,
    p2
  );
  res.json({ status: 'ok', items: rows, counts: counts.rows });
}));

// ---------- CSV ----------
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

router.get('/export.csv', asyncHandler(async (req, res) => {
  const params = [req.user.tenant_id];
  const where = filters(req, params);
  const { rows } = await db.query(`${LIST_SQL} WHERE ${where} ORDER BY c.created_at`, params);
  const header = ['claim_no', 'payer', 'member_number', 'employee_number', 'patient', 'mrn', 'sex', 'date_of_birth', 'visit_date', 'icd10', 'doctor', 'doctor_reg_no', 'item_code', 'item', 'quantity', 'unit_price', 'payer_amount', 'claim_total', 'status'];
  const lines = [header.join(',')];
  for (const c of rows) {
    const items = await db.query(
      `SELECT ii.* FROM invoice_items ii WHERE ii.invoice_id = $1 AND ii.payer_amount > 0 ORDER BY ii.id`,
      [c.invoice_id]
    );
    const base = [c.claim_no, c.payer_name, c.member_number, c.employee_number, [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' '), c.mrn, c.sex,
      c.date_of_birth ? String(c.date_of_birth).slice(0, 10) : '', String(c.arrived_at).slice(0, 10), c.icd10_codes, c.doctor_name, c.professional_reg_no];
    items.rows.forEach((it) => {
      lines.push(base.concat([it.payer_item_code, it.description, Number(it.quantity), Number(it.unit_price), Number(it.payer_amount), Number(c.claimed_amount), c.status]).map(csvCell).join(','));
    });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="madai.csv"');
  res.end('﻿' + lines.join('\n'));
}));

router.get('/rejections', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT COALESCE(NULLIF(TRIM(c.rejection_reason), ''), 'Haijaandikwa') AS reason, py.name AS payer_name,
            COUNT(*)::int AS n, COALESCE(SUM(c.claimed_amount), 0) AS amount
       FROM claims c JOIN payers py ON py.id = c.payer_id
      WHERE c.tenant_id = $1 AND c.status = 'rejected'
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 50`,
    [req.user.tenant_id]
  );
  res.json({ status: 'ok', items: rows });
}));

// ---------- Dai moja ----------
async function getClaim(req, res) {
  const { rows } = await db.query(`${LIST_SQL} WHERE c.id = $1 AND c.tenant_id = $2`, [Number(req.params.id), req.user.tenant_id]);
  if (!rows[0]) { res.status(404).json({ status: 'error', message: 'Dai halipo.' }); return null; }
  return rows[0];
}

router.get('/:id', asyncHandler(async (req, res) => {
  const claim = await getClaim(req, res);
  if (!claim) return;
  const [items, findings, dx] = await Promise.all([
    db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [claim.invoice_id]),
    db.query('SELECT * FROM claim_findings WHERE claim_id = $1 ORDER BY resolved_at NULLS FIRST, severity, id', [claim.id]),
    db.query('SELECT icd10_code, description FROM diagnoses WHERE visit_id = $1', [claim.visit_id])
  ]);
  res.json({ status: 'ok', claim, items: items.rows, findings: findings.rows, diagnoses: dx.rows });
}));

router.post('/:id/recheck', asyncHandler(async (req, res) => {
  const claim = await getClaim(req, res);
  if (!claim) return;
  if (!OPEN_STATUSES.includes(claim.status)) return res.status(400).json({ status: 'error', message: 'Dai limeshatumwa; haliwezi kukaguliwa upya.' });
  const c = await recheckClaim(claim);
  await audit.log(req, 'claim_recheck', { entity: 'claims', entityId: claim.id, after: { status: c.status, score: c.readiness_score } });
  res.json({ status: 'ok', message: 'Dai limekaguliwa upya: readiness ' + c.readiness_score + '%.' });
}));

router.post('/:id/accept-warnings', asyncHandler(async (req, res) => {
  const claim = await getClaim(req, res);
  if (!claim) return;
  const note = String((req.body && req.body.note) || '').trim();
  if (!note) return res.status(400).json({ status: 'error', message: 'Andika maelezo ya kwa nini tahadhari zimekubaliwa.' });
  if (claim.status !== 'needs_info') return res.status(400).json({ status: 'error', message: 'Dai hili halina tahadhari tu (lina makosa au limeshatumwa).' });
  await db.query("UPDATE claim_findings SET resolved_at = NOW(), resolved_by = $1 WHERE claim_id = $2 AND severity = 'warning' AND resolved_at IS NULL", [req.user.id, claim.id]);
  await db.query("UPDATE claims SET status = 'ready', notes = TRIM(COALESCE(notes, '') || ' ' || $1) WHERE id = $2", ['[Tahadhari zimekubaliwa: ' + note + ']', claim.id]);
  await audit.log(req, 'claim_accept_warnings', { entity: 'claims', entityId: claim.id, after: { note } });
  res.json({ status: 'ok', message: 'Dai liko tayari kutumwa.' });
}));

router.post('/submit', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  const reason = String((req.body && req.body.override_reason) || '').trim();
  if (!ids.length) return res.status(400).json({ status: 'error', message: 'Chagua madai ya kutuma.' });
  let sent = 0;
  const skipped = [];
  for (const id of ids) {
    const { rows } = await db.query('SELECT * FROM claims WHERE id = $1 AND tenant_id = $2', [id, req.user.tenant_id]);
    const c = rows[0];
    if (!c) continue;
    if (c.status === 'ready' || (['has_errors', 'needs_info'].includes(c.status) && reason)) {
      await db.query("UPDATE claims SET status = 'submitted', submitted_at = NOW(), notes = CASE WHEN $2 = '' THEN notes ELSE TRIM(COALESCE(notes, '') || ' [Imetumwa licha ya makosa: ' || $2 || ']') END WHERE id = $1", [c.id, reason]);
      await audit.log(req, 'claim_submit', { entity: 'claims', entityId: c.id, before: { status: c.status }, after: { status: 'submitted', override_reason: reason || undefined } });
      sent += 1;
    } else {
      skipped.push(c.claim_no);
    }
  }
  res.json({
    status: 'ok', sent, skipped,
    message: sent + ' madai yamewekwa "Yametumwa".' + (skipped.length ? ' Hayakutumwa (hayako tayari): ' + skipped.join(', ') + '.' : '')
  });
}));

router.post('/:id/paid', asyncHandler(async (req, res) => {
  const claim = await getClaim(req, res);
  if (!claim) return;
  if (!['submitted', 'partially_paid'].includes(claim.status)) return res.status(400).json({ status: 'error', message: 'Dai lazima liwe limetumwa kwanza.' });
  const amount = Number(req.body && req.body.paid_amount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ status: 'error', message: 'Andika kiasi kilicholipwa.' });
  const status = amount + 0.5 >= Number(claim.claimed_amount) ? 'paid' : 'partially_paid';
  await db.query('UPDATE claims SET paid_amount = $1, paid_at = COALESCE($2::date, CURRENT_DATE), status = $3, rejection_reason = COALESCE($4, rejection_reason) WHERE id = $5',
    [amount, req.body.paid_at || null, status, status === 'partially_paid' ? (req.body.reason || null) : null, claim.id]);
  await audit.log(req, 'claim_paid', { entity: 'claims', entityId: claim.id, after: { paid_amount: amount, status } });
  res.json({ status: 'ok', message: status === 'paid' ? 'Dai limelipwa kikamilifu.' : 'Dai limelipwa kwa sehemu.' });
}));

router.post('/:id/rejected', asyncHandler(async (req, res) => {
  const claim = await getClaim(req, res);
  if (!claim) return;
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ status: 'error', message: 'Andika sababu ya kukataliwa kama ilivyotolewa na mlipaji.' });
  if (!['submitted', 'partially_paid'].includes(claim.status)) return res.status(400).json({ status: 'error', message: 'Dai lazima liwe limetumwa kwanza.' });
  await db.query("UPDATE claims SET status = 'rejected', rejection_reason = $1 WHERE id = $2", [reason, claim.id]);
  await audit.log(req, 'claim_rejected', { entity: 'claims', entityId: claim.id, after: { reason } });
  res.json({ status: 'ok', message: 'Dai limewekwa "Limekataliwa". Sababu itaonekana kwenye uchambuzi.' });
}));

module.exports = router;
