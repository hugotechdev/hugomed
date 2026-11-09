// =============================================================
// HugoMed - shell ya mfumo: menyu kwa kila role, na kuhamia kurasa
// Kila ukurasa unajisajili kwenye HugoMedPages (angalia home.js n.k.)
// =============================================================

(function () {
  const h = HugoMed.h;

  const ADMIN = 'hospital_admin';
  const STAFF = [ADMIN, 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer', 'accountant', 'hr_officer'];

  // Menyu kwa makundi: key = jina la ukurasa, roles = wanaoruhusiwa ('all' = wote)
  const NAV = [
    { group: null, items: [
      { key: 'home', label: 'Mwanzo', roles: 'all' },
      { key: 'dashboard', label: 'Dashboard', roles: [ADMIN, 'accountant', 'claims_officer'] }
    ] },
    { group: 'Safari ya mgonjwa', items: [
      { key: 'queue', label: 'Foleni ya leo', roles: STAFF },
      { key: 'reception', label: 'Mapokezi', roles: [ADMIN, 'receptionist', 'nurse'] },
      { key: 'triage', label: 'Triage', roles: [ADMIN, 'nurse', 'doctor'] },
      { key: 'doctor', label: 'Daktari (OPD)', roles: [ADMIN, 'doctor', 'nurse'] },
      { key: 'lab', label: 'Maabara na Radiology', roles: [ADMIN, 'lab_technician', 'doctor'] },
      { key: 'ipd', label: 'IPD (wodi)', roles: [ADMIN, 'doctor', 'nurse'] },
      { key: 'cashier', label: 'Malipo', roles: [ADMIN, 'cashier', 'accountant', 'receptionist'] },
      { key: 'pharmacy', label: 'Pharmacy', roles: [ADMIN, 'pharmacist', 'nurse'] }
    ] },
    { group: 'Fedha na bima', items: [
      { key: 'claims', label: 'Madai ya bima', roles: [ADMIN, 'claims_officer', 'accountant'] },
      { key: 'finance', label: 'Fedha', roles: [ADMIN, 'accountant'] },
      { key: 'prices', label: 'Price lists', roles: [ADMIN, 'accountant', 'cashier'] },
      { key: 'payers', label: 'Bima na kampuni', roles: [ADMIN] }
    ] },
    { group: 'Uendeshaji', items: [
      { key: 'stock', label: 'Stock ya dawa', roles: [ADMIN, 'pharmacist', 'accountant'] },
      { key: 'reports', label: 'Ripoti', roles: [ADMIN, 'accountant', 'claims_officer', 'doctor'] },
      { key: 'hr', label: 'HR', roles: [ADMIN, 'hr_officer', 'accountant'] }
    ] },
    { group: 'Mipangilio', items: [
      { key: 'tenants', label: 'Hospitali', roles: ['super_admin'] },
      { key: 'users', label: 'Watumiaji', roles: [ADMIN, 'super_admin'] },
      { key: 'services', label: 'Vipimo na dawa', roles: [ADMIN] },
      { key: 'audit', label: 'Audit Trail', roles: [ADMIN, 'super_admin'] },
      { key: 'account', label: 'Akaunti yangu', roles: 'all' }
    ] }
  ];
  const ALL = NAV.flatMap((g) => g.items);

  function allowed(item, user) {
    return item.roles === 'all' || item.roles.includes(user.role);
  }

  function currentKey() {
    // '#/users?tenant=3' -> 'users'
    return (window.location.hash || '#/home').replace('#/', '').split('?')[0] || 'home';
  }

  function renderNav(user) {
    const box = document.getElementById('nav-links');
    box.textContent = '';
    const key = currentKey();
    NAV.forEach((g) => {
      const items = g.items.filter((n) => allowed(n, user));
      if (!items.length) return;
      if (g.group) box.appendChild(h('div', { class: 'nav-group' }, g.group));
      items.forEach((n) => box.appendChild(h('a', { class: 'nav' + (n.key === key ? ' on' : ''), href: '#/' + n.key }, n.label)));
    });
  }

  function renderPage(user) {
    const key = currentKey();
    const item = ALL.find((n) => n.key === key);
    const page = document.getElementById('page');
    page.textContent = '';

    if (!item || !allowed(item, user) || !window.HugoMedPages[key]) {
      window.location.hash = '#/home';
      return;
    }
    document.title = 'HugoMed · ' + item.label;
    window.scrollTo(0, 0);
    window.HugoMedPages[key](page, user);
  }

  async function start() {
    if (!HugoMed.getToken()) {
      window.location.href = '/';
      return;
    }

    let user = HugoMed.getUser();
    try {
      const res = await HugoMed.api('/api/auth/me');
      user = res.user;
      HugoMed.saveLogin(HugoMed.getToken(), user);
    } catch (err) {
      if (!user) { HugoMed.logout(); return; }
    }

    document.getElementById('tenant-name').textContent = user.tenant_name || 'HUGO TECH';
    document.getElementById('user-name').textContent = user.full_name;
    document.getElementById('user-role').textContent = HugoMed.ROLES[user.role] || user.role;
    document.getElementById('btn-logout').addEventListener('click', HugoMed.logout);

    const go = () => { renderNav(user); renderPage(user); };
    window.addEventListener('hashchange', go);
    go();
  }

  start();
})();
