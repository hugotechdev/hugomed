// =============================================================
// HugoMed - shell ya mfumo: menyu kwa kila role, na kuhamia kurasa
// Kila ukurasa unajisajili kwenye HugoMedPages (angalia home.js n.k.)
// =============================================================

(function () {
  const h = HugoMed.h;

  // Menyu: key = jina la ukurasa, roles = wanaoruhusiwa ('all' = wote)
  const STAFF = ['hospital_admin', 'receptionist', 'nurse', 'doctor', 'lab_technician', 'pharmacist', 'cashier', 'claims_officer'];
  const NAV = [
    { key: 'home', label: 'Mwanzo', roles: 'all' },
    { key: 'queue', label: 'Foleni ya leo', roles: STAFF },
    { key: 'reception', label: 'Mapokezi', roles: ['hospital_admin', 'receptionist', 'nurse'] },
    { key: 'triage', label: 'Triage', roles: ['hospital_admin', 'nurse', 'doctor'] },
    { key: 'payers', label: 'Bima na kampuni', roles: ['hospital_admin'] },
    { key: 'tenants', label: 'Hospitali', roles: ['super_admin'] },
    { key: 'users', label: 'Watumiaji', roles: ['hospital_admin', 'super_admin'] },
    { key: 'audit', label: 'Audit Trail', roles: ['hospital_admin', 'super_admin'] },
    { key: 'account', label: 'Akaunti yangu', roles: 'all' }
  ];

  // Moduli zinazokuja (zinaonekana lakini hazijafunguliwa)
  const COMING = ['Daktari (OPD)', 'Maabara', 'Malipo', 'Pharmacy', 'Madai ya bima', 'Ripoti'];

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
    NAV.filter((n) => allowed(n, user)).forEach((n) => {
      box.appendChild(h('a', { class: 'nav' + (n.key === key ? ' on' : ''), href: '#/' + n.key }, n.label));
    });
    if (user.role !== 'super_admin') {
      box.appendChild(h('div', { class: 'nav-group' }, 'Inakuja hivi karibuni'));
      COMING.forEach((c) => box.appendChild(h('span', { class: 'nav disabled', 'aria-disabled': 'true' }, c)));
    }
  }

  function renderPage(user) {
    const key = currentKey();
    const item = NAV.find((n) => n.key === key);
    const page = document.getElementById('page');
    page.textContent = '';

    if (!item || !allowed(item, user) || !window.HugoMedPages[key]) {
      window.location.hash = '#/home';
      return;
    }
    document.title = 'HugoMed · ' + item.label;
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
