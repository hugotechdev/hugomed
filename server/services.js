// =============================================================
// HugoMed - orodha ya huduma: vipimo, dawa, ushauri, n.k.
//   GET   /api/services?category=lab&q=...   orodha (wafanyakazi wote)
//   POST  /api/services                      kuongeza (Admin wa hospitali)
//   PATCH /api/services/:id                  kubadilisha / kuzima
//   POST  /api/services/seed                 kuweka orodha ya kuanzia
// Bei zitawekwa kwenye Hatua ya Billing (price lists).
// =============================================================

const express = require('express');
const db = require('./db');
const audit = require('./audit');
const { requireAuth, requireRole, asyncHandler } = require('./security');

const router = express.Router();
router.use(requireAuth, requireRole('hospital_admin', 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer', 'accountant'));

const CATEGORIES = ['consultation', 'lab', 'drug', 'procedure', 'radiology', 'bed', 'other'];

// Orodha ya kuanzia. Hospitali inaweza kubadilisha, kuzima au kuongeza.
const DEFAULTS = [
  ['consultation', 'CONS-OPD', 'Ushauri wa daktari (OPD)', 'visit'],
  ['consultation', 'CONS-FU', 'Ushauri wa marudio (follow-up)', 'visit'],
  ['lab', 'LAB-MRDT', 'mRDT (kipimo cha haraka cha malaria)', 'test'],
  ['lab', 'LAB-BS', 'Blood slide (BS) ya malaria', 'test'],
  ['lab', 'LAB-FBC', 'Full blood count (FBC)', 'test'],
  ['lab', 'LAB-HB', 'Haemoglobin (Hb)', 'test'],
  ['lab', 'LAB-URINE', 'Urinalysis', 'test'],
  ['lab', 'LAB-STOOL', 'Stool analysis', 'test'],
  ['lab', 'LAB-RBG', 'Random blood glucose (RBG)', 'test'],
  ['lab', 'LAB-HBA1C', 'HbA1c', 'test'],
  ['lab', 'LAB-WIDAL', 'Widal test', 'test'],
  ['lab', 'LAB-HPYL', 'H. pylori test', 'test'],
  ['lab', 'LAB-UPT', 'Kipimo cha ujauzito (UPT)', 'test'],
  ['lab', 'LAB-HIV', 'HIV rapid test', 'test'],
  ['lab', 'LAB-RPR', 'Syphilis test (RPR/VDRL)', 'test'],
  ['lab', 'LAB-ESR', 'ESR', 'test'],
  ['lab', 'LAB-LFT', 'Liver function tests (LFT)', 'test'],
  ['lab', 'LAB-RFT', 'Renal function tests (RFT)', 'test'],
  ['lab', 'LAB-LIPID', 'Lipid profile', 'test'],
  ['lab', 'LAB-AFB', 'Sputum AFB / GeneXpert', 'test'],
  ['lab', 'LAB-PSA', 'PSA', 'test'],
  ['lab', 'LAB-GROUP', 'Blood grouping and cross-match', 'test'],
  ['drug', 'DRG-AL', 'Artemether-Lumefantrine 20/120mg', 'tab'],
  ['drug', 'DRG-PCM', 'Paracetamol 500mg', 'tab'],
  ['drug', 'DRG-AMOX', 'Amoxicillin 500mg', 'cap'],
  ['drug', 'DRG-AMOXCLAV', 'Amoxicillin/Clavulanate 625mg', 'tab'],
  ['drug', 'DRG-CIPRO', 'Ciprofloxacin 500mg', 'tab'],
  ['drug', 'DRG-METRO', 'Metronidazole 400mg', 'tab'],
  ['drug', 'DRG-DOXY', 'Doxycycline 100mg', 'cap'],
  ['drug', 'DRG-AZITH', 'Azithromycin 500mg', 'tab'],
  ['drug', 'DRG-CTX', 'Cotrimoxazole 480mg', 'tab'],
  ['drug', 'DRG-IBU', 'Ibuprofen 400mg', 'tab'],
  ['drug', 'DRG-DICLO', 'Diclofenac 50mg', 'tab'],
  ['drug', 'DRG-OMEP', 'Omeprazole 20mg', 'cap'],
  ['drug', 'DRG-ORS', 'ORS', 'sachet'],
  ['drug', 'DRG-ZINC', 'Zinc 20mg', 'tab'],
  ['drug', 'DRG-ALB', 'Albendazole 400mg', 'tab'],
  ['drug', 'DRG-FESO4', 'Ferrous sulphate 200mg', 'tab'],
  ['drug', 'DRG-FOLIC', 'Folic acid 5mg', 'tab'],
  ['drug', 'DRG-METF', 'Metformin 500mg', 'tab'],
  ['drug', 'DRG-AMLO', 'Amlodipine 5mg', 'tab'],
  ['drug', 'DRG-HCTZ', 'Hydrochlorothiazide 25mg', 'tab'],
  ['drug', 'DRG-CETIR', 'Cetirizine 10mg', 'tab'],
  ['drug', 'DRG-FLUC', 'Fluconazole 150mg', 'cap'],
  ['drug', 'DRG-SALB', 'Salbutamol inhaler 100mcg', 'inhaler'],
  ['drug', 'DRG-CLOT', 'Clotrimazole cream 1%', 'tube'],
  ['drug', 'DRG-ARTS', 'Artesunate injection 60mg', 'vial'],
  ['drug', 'DRG-CEFTR', 'Ceftriaxone injection 1g', 'vial'],
  ['drug', 'DRG-NS', 'Normal saline 0.9% 500ml', 'bottle'],
  ['procedure', 'PRC-DRESS', 'Kusafisha na kufunga kidonda (dressing)', 'procedure'],
  ['procedure', 'PRC-SUTURE', 'Kushona kidonda (suturing)', 'procedure'],
  ['procedure', 'PRC-INJ', 'Kuchoma sindano', 'procedure']
];

router.get('/', asyncHandler(async (req, res) => {
  const params = [req.user.tenant_id];
  let where = 'tenant_id = $1';
  if (req.query.all !== '1') where += ' AND is_active = TRUE';
  if (req.query.category && CATEGORIES.includes(req.query.category)) {
    params.push(req.query.category);
    where += ` AND category = $${params.length}`;
  }
  if (req.query.q) {
    params.push('%' + String(req.query.q).trim() + '%');
    where += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length})`;
  }
  const { rows } = await db.query(`SELECT * FROM services WHERE ${where} ORDER BY category, name LIMIT 500`, params);
  res.json({ status: 'ok', items: rows });
}));

router.post('/', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ status: 'error', message: 'Jaza jina la huduma.' });
  if (!CATEGORIES.includes(b.category)) return res.status(400).json({ status: 'error', message: 'Chagua aina ya huduma.' });
  const { rows } = await db.query(
    'INSERT INTO services (tenant_id, code, name, category, unit) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [req.user.tenant_id, b.code || null, name, b.category, b.unit || null]
  );
  await audit.log(req, 'create_service', { entity: 'services', entityId: rows[0].id, after: { name, category: b.category } });
  res.status(201).json({ status: 'ok', service: rows[0] });
}));

router.patch('/:id', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await db.query('SELECT * FROM services WHERE id = $1 AND tenant_id = $2', [id, req.user.tenant_id]);
  if (!before.rows[0]) return res.status(404).json({ status: 'error', message: 'Huduma haipo.' });
  const sets = [];
  const params = [];
  for (const f of ['code', 'name', 'unit', 'is_active']) {
    if (req.body[f] === undefined) continue;
    params.push(req.body[f] === '' ? null : req.body[f]);
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ status: 'error', message: 'Hakuna cha kubadilisha.' });
  params.push(id);
  const { rows } = await db.query(`UPDATE services SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  await audit.log(req, 'update_service', { entity: 'services', entityId: id, before: before.rows[0], after: rows[0] });
  res.json({ status: 'ok', service: rows[0] });
}));

// Inaongeza zile tu ambazo hospitali haina bado (kwa code)
router.post('/seed', requireRole('hospital_admin'), asyncHandler(async (req, res) => {
  const existing = await db.query('SELECT code FROM services WHERE tenant_id = $1 AND code IS NOT NULL', [req.user.tenant_id]);
  const have = new Set(existing.rows.map((r) => r.code));
  const missing = DEFAULTS.filter(([, code]) => !have.has(code));
  for (const [category, code, name, unit] of missing) {
    await db.query('INSERT INTO services (tenant_id, code, name, category, unit) VALUES ($1, $2, $3, $4, $5)',
      [req.user.tenant_id, code, name, category, unit]);
  }
  await audit.log(req, 'seed_services', { entity: 'services', after: { added: missing.length } });
  res.json({ status: 'ok', added: missing.length, message: missing.length ? missing.length + ' huduma zimeongezwa.' : 'Orodha ya kuanzia tayari ipo.' });
}));

module.exports = router;
