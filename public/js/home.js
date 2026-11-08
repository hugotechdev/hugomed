// =============================================================
// HugoMed - ukurasa wa Mwanzo
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.home = function (page, user) {
  const h = HugoMed.h;

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, 'Karibu, ' + user.full_name.split(' ')[0]),
      h('p', { class: 'muted' }, (HugoMed.ROLES[user.role] || user.role) + (user.tenant_name ? ' · ' + user.tenant_name : ''))
    )
  ));

  const cards = h('div', { class: 'stat-grid' });
  page.appendChild(cards);

  function stat(label, value, href) {
    const card = h(href ? 'a' : 'div', { class: 'card stat', href: href || null },
      h('div', { class: 'muted small' }, label),
      h('div', { class: 'stat-value' }, value)
    );
    cards.appendChild(card);
  }

  if (user.role === 'super_admin') {
    HugoMed.api('/api/tenants').then((res) => {
      const active = res.items.filter((t) => t.status === 'active').length;
      stat('Hospitali zote', res.items.length, '#/tenants');
      stat('Zinazotumika sasa', active, '#/tenants');
      stat('Zimesimamishwa', res.items.filter((t) => t.status === 'suspended').length, '#/tenants');
    }).catch((err) => page.appendChild(h('p', { class: 'form-message error' }, err.message)));
  }

  // Wafanyakazi wa hospitali: hali ya foleni ya leo
  if (user.role !== 'super_admin') {
    HugoMed.api('/api/visits').then((res) => {
      const c = res.counts || {};
      const open = ['triage', 'doctor', 'lab', 'results', 'billing', 'pharmacy'].reduce((a, k) => a + (c[k] || 0), 0);
      stat('Wagonjwa ndani sasa', open, '#/queue');
      stat('Wanasubiri triage', c.triage || 0, '#/queue');
      stat('Wanasubiri daktari', c.doctor || 0, '#/queue');
    }).catch(() => {});
  }

  if (user.role === 'hospital_admin') {
    HugoMed.api('/api/users').then((res) => {
      stat('Watumiaji', res.items.length, '#/users');
      stat('Walio hai', res.items.filter((u) => u.is_active).length, '#/users');
      const soon = res.items.filter((u) => u.license_expiry && new Date(u.license_expiry) < new Date(Date.now() + 60 * 864e5)).length;
      stat('Leseni zinazoisha (siku 60)', soon, '#/users');
    }).catch((err) => page.appendChild(h('p', { class: 'form-message error' }, err.message)));
  }

  page.appendChild(h('section', { class: 'card', style: 'margin-top: 20px' },
    h('h2', {}, 'Hatua za ujenzi wa HugoMed'),
    h('ol', { class: 'steps' },
      h('li', { class: 'done' }, 'Msingi: server na database'),
      h('li', { class: 'done' }, 'Login, roles, Audit Trail, Super Admin'),
      h('li', { class: 'done' }, 'Mapokezi na Triage'),
      h('li', {}, 'Foleni na skrini ya daktari'),
      h('li', {}, 'Maabara'),
      h('li', {}, 'Pharmacy na stock'),
      h('li', {}, 'Billing kwa walipaji wote'),
      h('li', {}, 'NHIF na bima: uhakiki na madai'),
      h('li', {}, 'Claims Pre-Audit'),
      h('li', {}, 'Dashboard na ripoti')
    )
  ));
};
