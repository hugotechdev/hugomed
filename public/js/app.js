// =============================================================
// HugoMed - msaidizi wa pamoja (inatumika na skrini zote)
// =============================================================

const HugoMed = {
  // Majina ya kazi (roles) kwa Kiswahili
  ROLES: {
    super_admin: 'Super Admin (HUGO TECH)',
    hospital_admin: 'Admin wa hospitali',
    receptionist: 'Mapokezi',
    nurse: 'Nesi',
    doctor: 'Daktari',
    lab_technician: 'Mtaalamu wa maabara',
    pharmacist: 'Mfamasia',
    cashier: 'Cashier',
    claims_officer: 'Afisa wa madai',
    accountant: 'Mhasibu',
    hr_officer: 'Afisa HR'
  },

  LEVELS: {
    dispensary: 'Zahanati (Dispensary)',
    health_centre: 'Kituo cha afya',
    clinic: 'Kliniki',
    medical_centre: 'Medical centre',
    district_hospital: 'Hospitali ya wilaya',
    regional_hospital: 'Hospitali ya mkoa',
    hospital: 'Hospitali'
  },

  // Idara za kuchagua (zitawekwa kwenye Settings baadaye)
  DEPARTMENTS: ['OPD', 'Watoto', 'RCH', 'Dharura', 'Meno', 'Macho'],

  // Hatua za safari ya mgonjwa
  STAGES: {
    reception: ['grey', 'Mapokezi'],
    triage: ['amber', 'Triage'],
    doctor: ['teal', 'Kwa daktari'],
    lab: ['amber', 'Maabara'],
    results: ['teal', 'Matokeo kwa daktari'],
    billing: ['amber', 'Malipo'],
    pharmacy: ['teal', 'Pharmacy'],
    completed: ['green', 'Imekamilika'],
    cancelled: ['grey', 'Imesitishwa']
  },

  PRIORITIES: {
    normal: ['grey', 'Kawaida'],
    urgent: ['amber', 'Haraka'],
    emergency: ['red', 'Dharura']
  },

  PAYER_TYPES: {
    cash: 'Cash',
    nhif: 'NHIF',
    insurance: 'Bima binafsi',
    company: 'Kampuni (credit)'
  },

  // Jina kamili la mgonjwa
  patientName(p) {
    return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
  },

  // Umri kwa miaka (au miezi kwa mtoto mdogo)
  age(dob) {
    if (!dob) return '';
    const d = new Date(dob);
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) years -= 1;
    if (years >= 2) return 'miaka ' + years;
    const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth() - (now.getDate() < d.getDate() ? 1 : 0);
    return 'miezi ' + Math.max(months, 0);
  },

  sexLabel(s) {
    return s === 'F' ? 'Mwanamke' : s === 'M' ? 'Mwanaume' : '';
  },

  // Chip ya hatua au kipaumbele
  stageChip(stage) {
    const s = HugoMed.STAGES[stage] || ['grey', stage];
    return HugoMed.h('span', { class: 'chip ' + s[0] }, s[1]);
  },
  priorityChip(p) {
    if (!p || p === 'normal') return null;
    const s = HugoMed.PRIORITIES[p];
    return HugoMed.h('span', { class: 'chip ' + s[0] }, s[1]);
  },

  // Muda wa kusubiri: chip nyekundu zaidi ya dakika 30
  waitChip(minutes) {
    const m = Number(minutes || 0);
    const text = m < 60 ? 'dk ' + m : 'saa ' + Math.floor(m / 60) + ' dk ' + (m % 60);
    return HugoMed.h('span', { class: 'chip ' + (m > 30 ? 'red' : m > 15 ? 'amber' : 'grey') }, text);
  },

  // ---------- Login ----------
  getToken() {
    try { return localStorage.getItem('hugomed_token'); } catch (e) { return null; }
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem('hugomed_user') || 'null'); } catch (e) { return null; }
  },
  saveLogin(token, user) {
    localStorage.setItem('hugomed_token', token);
    localStorage.setItem('hugomed_user', JSON.stringify(user));
  },
  logout() {
    try {
      localStorage.removeItem('hugomed_token');
      localStorage.removeItem('hugomed_user');
    } catch (e) { /* hakuna storage */ }
    window.location.href = '/';
  },

  // ---------- Kuita API ----------
  async api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = HugoMed.getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (e) {
      const err = new Error('Hakuna mawasiliano na server. Angalia mtandao.');
      err.status = 0;
      throw err;
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* jibu si JSON */ }

    // Token imeisha muda: rudi kwenye login
    if (res.status === 401 && !options.noRedirect && token) {
      HugoMed.logout();
    }

    if (!res.ok) {
      const err = new Error(data.message || 'Kuna tatizo (' + res.status + ')');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  // ---------- Kujenga HTML kwa usalama (bila innerHTML) ----------
  // h('div', { class: 'card' }, 'maandishi', h('span', {}, 'zaidi'))
  h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  },

  // Kubadilisha rangi na maandishi ya chip
  setChip(el, color, text) {
    el.className = 'chip ' + color;
    el.textContent = text;
  },

  // Ujumbe ndani ya fomu: aina = 'error' | 'ok'
  showMessage(el, text, type) {
    el.textContent = text || '';
    el.className = 'form-message' + (text ? ' ' + (type || 'error') : '');
  },

  // Kusoma fomu kuwa object
  formData(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  },

  // ---------- Kuandika tarehe na pesa ----------
  date(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-GB');
  },
  dateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  },
  money(amount) {
    return 'TSh ' + Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
};
