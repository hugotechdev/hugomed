-- =============================================================
-- HugoMed - majedwali ya database (Awamu 1)
-- Faili hili linaendeshwa kila server inapoanza.
-- "IF NOT EXISTS" inahakikisha halifuti wala halirudii data iliyopo.
-- Kila jedwali la data ya hospitali lina tenant_id.
-- =============================================================

-- ---------- Hospitali (wateja wa HUGO TECH) ----------
CREATE TABLE IF NOT EXISTS tenants (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  facility_level     TEXT NOT NULL DEFAULT 'clinic'
                     CHECK (facility_level IN ('dispensary','health_centre','clinic','medical_centre','district_hospital','regional_hospital','hospital')),
  nhif_facility_code TEXT,
  phone              TEXT,
  email              TEXT,
  address            TEXT,
  logo_url           TEXT,
  plan               TEXT NOT NULL DEFAULT 'basic',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','trial')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Watumiaji (tenant_id ni NULL kwa Super Admin wa HUGO TECH) ----------
CREATE TABLE IF NOT EXISTS users (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER REFERENCES tenants(id),
  full_name          TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  phone              TEXT,
  role               TEXT NOT NULL CHECK (role IN ('super_admin','hospital_admin','receptionist','nurse','doctor','lab_technician','pharmacist','cashier','claims_officer','accountant','hr_officer')),
  professional_reg_no TEXT,
  license_expiry     DATE,
  password_hash      TEXT NOT NULL,
  two_fa_secret      TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Wagonjwa ----------
CREATE TABLE IF NOT EXISTS patients (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  mrn                TEXT NOT NULL,
  first_name         TEXT NOT NULL,
  middle_name        TEXT,
  last_name          TEXT NOT NULL,
  sex                TEXT NOT NULL CHECK (sex IN ('F','M')),
  date_of_birth      DATE,
  phone              TEXT,
  id_type            TEXT CHECK (id_type IN ('nida','passport','none')),
  id_number          TEXT,
  next_of_kin_phone  TEXT,
  address            TEXT,
  allergies          TEXT,
  chronic_conditions TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, mrn)
);

-- ---------- Walipaji: cash, NHIF, bima binafsi, kampuni ----------
CREATE TABLE IF NOT EXISTS payers (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  type               TEXT NOT NULL CHECK (type IN ('cash','nhif','insurance','company')),
  name               TEXT NOT NULL,
  contact_person     TEXT,
  phone              TEXT,
  email              TEXT,
  credit_limit       NUMERIC(14,2),
  payment_terms_days INTEGER DEFAULT 30,
  requires_preauth   BOOLEAN NOT NULL DEFAULT FALSE,
  copay_percent      NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mgonjwa na walipaji wake (kadi ya NHIF, bima, mfanyakazi wa kampuni)
CREATE TABLE IF NOT EXISTS patient_payers (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  patient_id         INTEGER NOT NULL REFERENCES patients(id),
  payer_id           INTEGER NOT NULL REFERENCES payers(id),
  member_number      TEXT,
  employee_number    TEXT,
  valid_until        DATE,
  is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
  last_verified_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Huduma, dawa na bei ----------
CREATE TABLE IF NOT EXISTS services (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  code               TEXT,
  name               TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (category IN ('consultation','lab','drug','procedure','radiology','bed','other')),
  unit               TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_lists (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  name               TEXT NOT NULL,
  payer_id           INTEGER REFERENCES payers(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_prices (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  price_list_id      INTEGER NOT NULL REFERENCES price_lists(id),
  service_id         INTEGER NOT NULL REFERENCES services(id),
  price              NUMERIC(12,2) NOT NULL,
  payer_item_code    TEXT,
  is_covered         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (price_list_id, service_id)
);

-- ---------- Ziara na safari ya mgonjwa ----------
CREATE TABLE IF NOT EXISTS visits (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  patient_id         INTEGER NOT NULL REFERENCES patients(id),
  visit_no           TEXT NOT NULL,
  payer_id           INTEGER REFERENCES payers(id),
  patient_payer_id   INTEGER REFERENCES patient_payers(id),
  department         TEXT,
  token              TEXT,
  priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','emergency')),
  stage              TEXT NOT NULL DEFAULT 'reception'
                     CHECK (stage IN ('reception','triage','doctor','lab','results','billing','pharmacy','completed','cancelled')),
  assigned_doctor_id INTEGER REFERENCES users(id),
  arrived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  created_by         INTEGER REFERENCES users(id),
  UNIQUE (tenant_id, visit_no)
);

-- Kila hatua ya mgonjwa na muda wake (kwa "Safari ya wagonjwa")
CREATE TABLE IF NOT EXISTS visit_events (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  visit_id           INTEGER NOT NULL REFERENCES visits(id),
  stage              TEXT NOT NULL,
  user_id            INTEGER REFERENCES users(id),
  note               TEXT,
  at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vitals (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  visit_id           INTEGER NOT NULL REFERENCES visits(id),
  temperature_c      NUMERIC(4,1),
  weight_kg          NUMERIC(5,1),
  height_cm          NUMERIC(5,1),
  bp_systolic        INTEGER,
  bp_diastolic       INTEGER,
  pulse              INTEGER,
  spo2               INTEGER,
  recorded_by        INTEGER REFERENCES users(id),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  visit_id           INTEGER NOT NULL REFERENCES visits(id),
  complaint          TEXT,
  notes              TEXT,
  referral           TEXT,
  follow_up_date     DATE,
  doctor_id          INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  visit_id           INTEGER NOT NULL REFERENCES visits(id),
  icd10_code         TEXT NOT NULL,
  description        TEXT,
  is_provisional     BOOLEAN NOT NULL DEFAULT FALSE,
  doctor_id          INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maagizo ya daktari: vipimo, dawa, huduma
CREATE TABLE IF NOT EXISTS orders (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  visit_id           INTEGER NOT NULL REFERENCES visits(id),
  service_id         INTEGER NOT NULL REFERENCES services(id),
  type               TEXT NOT NULL CHECK (type IN ('lab','drug','procedure','radiology','consultation')),
  dose               TEXT,
  dose_units         NUMERIC(8,2),
  frequency_per_day  INTEGER,
  days               INTEGER,
  quantity           NUMERIC(10,2) NOT NULL DEFAULT 1,
  instructions       TEXT,
  status             TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','paid','in_progress','done','cancelled')),
  ordered_by         INTEGER REFERENCES users(id),
  ordered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_results (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  order_id           INTEGER NOT NULL REFERENCES orders(id),
  sample_no          TEXT,
  sample_taken_at    TIMESTAMPTZ,
  result             TEXT,
  notes              TEXT,
  entered_by         INTEGER REFERENCES users(id),
  entered_at         TIMESTAMPTZ,
  verified_by        INTEGER REFERENCES users(id),
  verified_at        TIMESTAMPTZ
);

-- ---------- Pharmacy na stock ----------
CREATE TABLE IF NOT EXISTS stock_items (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  service_id         INTEGER NOT NULL REFERENCES services(id),
  batch_no           TEXT NOT NULL,
  expiry_date        DATE,
  quantity           NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_cost          NUMERIC(12,2),
  reorder_level      NUMERIC(12,2) DEFAULT 0,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispensing (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  order_id           INTEGER NOT NULL REFERENCES orders(id),
  stock_item_id      INTEGER NOT NULL REFERENCES stock_items(id),
  quantity           NUMERIC(12,2) NOT NULL,
  dispensed_by       INTEGER REFERENCES users(id),
  dispensed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Bili na malipo ----------
CREATE TABLE IF NOT EXISTS invoices (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  visit_id           INTEGER NOT NULL REFERENCES visits(id),
  invoice_no         TEXT NOT NULL,
  payer_id           INTEGER REFERENCES payers(id),
  total              NUMERIC(14,2) NOT NULL DEFAULT 0,
  payer_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  patient_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  waiver_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','cancelled')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  invoice_id         INTEGER NOT NULL REFERENCES invoices(id),
  order_id           INTEGER REFERENCES orders(id),
  service_id         INTEGER REFERENCES services(id),
  description        TEXT NOT NULL,
  quantity           NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price         NUMERIC(12,2) NOT NULL,
  amount             NUMERIC(14,2) NOT NULL,
  payer_item_code    TEXT
);

-- Zamu ya cashier (kufunga zamu na kulinganisha fedha)
CREATE TABLE IF NOT EXISTS cashier_shifts (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  cashier_id         INTEGER NOT NULL REFERENCES users(id),
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ,
  expected_cash      NUMERIC(14,2),
  counted_cash       NUMERIC(14,2),
  notes              TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  invoice_id         INTEGER NOT NULL REFERENCES invoices(id),
  method             TEXT NOT NULL CHECK (method IN ('cash','mpesa','airtel_money','tigo_pesa','halopesa','selcom','azampay','bank','card','other')),
  amount             NUMERIC(14,2) NOT NULL,
  reference          TEXT,
  shift_id           INTEGER REFERENCES cashier_shifts(id),
  received_by        INTEGER REFERENCES users(id),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Madai ya NHIF na bima ----------
CREATE TABLE IF NOT EXISTS claims (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  invoice_id         INTEGER NOT NULL REFERENCES invoices(id),
  payer_id           INTEGER NOT NULL REFERENCES payers(id),
  claim_no           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','has_errors','needs_info','ready','submitted','paid','partially_paid','rejected')),
  readiness_score    INTEGER NOT NULL DEFAULT 0,
  claimed_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount        NUMERIC(14,2),
  rejection_reason   TEXT,
  submitted_at       TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, claim_no)
);

-- Rules za Pre-Audit (tenant_id NULL = rule ya jumla kwa hospitali zote)
CREATE TABLE IF NOT EXISTS claim_rules (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER REFERENCES tenants(id),
  payer_type         TEXT NOT NULL DEFAULT 'nhif' CHECK (payer_type IN ('nhif','insurance','company','all')),
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('error','warning')),
  message            TEXT NOT NULL,
  config             JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claim_findings (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  claim_id           INTEGER NOT NULL REFERENCES claims(id),
  rule_code          TEXT NOT NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('error','warning')),
  message            TEXT NOT NULL,
  resolved_at        TIMESTAMPTZ,
  resolved_by        INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Audit Trail (haifutwi) ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          INTEGER REFERENCES tenants(id),
  user_id            INTEGER REFERENCES users(id),
  action             TEXT NOT NULL,
  entity             TEXT,
  entity_id          TEXT,
  before_data        JSONB,
  after_data         JSONB,
  ip                 TEXT,
  at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Indexes (kasi ya kutafuta) ----------
CREATE INDEX IF NOT EXISTS idx_users_tenant          ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_phone ON patients (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_name  ON patients (tenant_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_idno  ON patients (tenant_id, id_number);
CREATE INDEX IF NOT EXISTS idx_patient_payers_member ON patient_payers (tenant_id, member_number);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_stage   ON visits (tenant_id, stage, arrived_at);
CREATE INDEX IF NOT EXISTS idx_visits_patient        ON visits (patient_id);
CREATE INDEX IF NOT EXISTS idx_visit_events_visit    ON visit_events (visit_id);
CREATE INDEX IF NOT EXISTS idx_orders_visit          ON orders (visit_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status  ON orders (tenant_id, type, status);
CREATE INDEX IF NOT EXISTS idx_stock_tenant_service  ON stock_items (tenant_id, service_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_invoices_visit        ON invoices (visit_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice      ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_claims_tenant_status  ON claims (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_claim_findings_claim  ON claim_findings (claim_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_at       ON audit_log (tenant_id, at);

-- =============================================================
-- Hatua 3: nyongeza (salama kuendesha mara nyingi)
-- =============================================================
ALTER TABLE vitals   ADD COLUMN IF NOT EXISTS complaint TEXT;
ALTER TABLE visits   ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_visits_tenant_arrived ON visits (tenant_id, arrived_at);

-- =============================================================
-- Hatua 5+: mfumo kamili (salama kuendesha mara nyingi)
-- =============================================================

-- Hatua mpya ya ziara: mgonjwa amelazwa (IPD)
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_stage_check;
ALTER TABLE visits ADD CONSTRAINT visits_stage_check
  CHECK (stage IN ('reception','triage','doctor','lab','results','admitted','billing','pharmacy','completed','cancelled'));

-- Maabara / radiology: nani amechukua sampuli
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS sample_taken_by INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_lab_results_order ON lab_results (order_id);

-- Huduma: kiwango cha kuagiza upya stock
ALTER TABLE services ADD COLUMN IF NOT EXISTS reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Stock: kila badiliko linarekodiwa
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS supplier TEXT;
CREATE TABLE IF NOT EXISTS stock_movements (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  change        NUMERIC(12,2) NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('received','dispensed','adjusted','expired','returned')),
  note          TEXT,
  order_id      INTEGER REFERENCES orders(id),
  user_id       INTEGER REFERENCES users(id),
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements (stock_item_id);

-- Bili: msamaha na hali ya kufungwa
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS waiver_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS waiver_by INTEGER REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS payer_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS patient_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_no TEXT;
ALTER TABLE cashier_shifts ADD COLUMN IF NOT EXISTS expected_other NUMERIC(14,2);

-- Madai: muda wa kukaguliwa
ALTER TABLE claims ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS visit_id INTEGER REFERENCES visits(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS notes TEXT;

-- IPD: wodi, vitanda, kulazwa, nursing notes
CREATE TABLE IF NOT EXISTS wards (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  bed_service_id INTEGER REFERENCES services(id),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS beds (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  ward_id     INTEGER NOT NULL REFERENCES wards(id),
  label       TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS admissions (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  visit_id       INTEGER NOT NULL REFERENCES visits(id),
  patient_id     INTEGER NOT NULL REFERENCES patients(id),
  bed_id         INTEGER REFERENCES beds(id),
  reason         TEXT,
  admitted_by    INTEGER REFERENCES users(id),
  admitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discharged_at  TIMESTAMPTZ,
  discharged_by  INTEGER REFERENCES users(id),
  discharge_summary TEXT,
  status         TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted','discharged'))
);
CREATE INDEX IF NOT EXISTS idx_admissions_tenant_status ON admissions (tenant_id, status);
CREATE TABLE IF NOT EXISTS nursing_notes (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  admission_id  INTEGER NOT NULL REFERENCES admissions(id),
  note          TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id),
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fedha: matumizi
CREATE TABLE IF NOT EXISTS expenses (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_to      TEXT,
  method       TEXT,
  reference    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by   INTEGER REFERENCES users(id),
  approved_by  INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HR: mishahara, makato, likizo, zamu
ALTER TABLE users ADD COLUMN IF NOT EXISTS basic_salary NUMERIC(14,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS allowances NUMERIC(14,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;

CREATE TABLE IF NOT EXISTS payroll_deductions (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL,
  percent    NUMERIC(6,3) NOT NULL DEFAULT 0,
  fixed_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  leave_type  TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS roster (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  shift_date  DATE NOT NULL,
  shift       TEXT NOT NULL CHECK (shift IN ('morning','evening','night','oncall','off')),
  UNIQUE (user_id, shift_date)
);
