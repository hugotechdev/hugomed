// =============================================================
// HugoMed - Audit Trail: nani alifanya nini, lini, kutoka wapi
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.audit = function (page, me) {
  const h = HugoMed.h;
  const isSuper = me.role === 'super_admin';

  const ACTIONS = {
    login: ['green', 'Aliingia'],
    login_failed: ['red', 'Kuingia kumeshindwa'],
    change_password: ['grey', 'Alibadili password'],
    reset_password: ['amber', 'Password mpya imewekwa'],
    create_user: ['teal', 'Mtumiaji ameongezwa'],
    update_user: ['grey', 'Mtumiaji amebadilishwa'],
    create_tenant: ['teal', 'Hospitali imesajiliwa'],
    update_tenant: ['amber', 'Hospitali imebadilishwa'],
    setup_super_admin: ['teal', 'Super Admin ameundwa']
  };

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, 'Audit Trail'),
      h('p', { class: 'muted' }, 'Vitendo 200 vya mwisho. Rekodi hizi haziwezi kufutwa.')
    ),
    h('button', { type: 'button', class: 'btn', onclick: () => load() }, 'Onyesha upya')
  ));

  const box = h('section', { class: 'card flush' });
  page.appendChild(box);

  // Inaonyesha kilichobadilika (kabla -> baada) kwa ufupi
  function changes(item) {
    const before = item.before_data || {};
    const after = item.after_data || {};
    const skip = ['password_hash', 'created_at', 'last_login_at', 'id', 'tenant_id'];
    const keys = Object.keys(after).filter((k) => !skip.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (!keys.length) return '';
    return keys.slice(0, 4).map((k) => {
      const b = before[k] === undefined || before[k] === null ? '' : String(before[k]);
      const a = after[k] === undefined || after[k] === null ? '—' : String(after[k]);
      return k + ': ' + (b ? b + ' → ' : '') + a;
    }).join(' · ');
  }

  async function load() {
    box.textContent = '';
    box.appendChild(h('p', { class: 'muted pad' }, 'Inapakia...'));
    try {
      const res = await HugoMed.api('/api/audit');
      box.textContent = '';
      if (!res.items.length) {
        box.appendChild(h('p', { class: 'muted pad' }, 'Bado hakuna vitendo vilivyorekodiwa.'));
        return;
      }
      box.appendChild(h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Muda'),
            isSuper ? h('th', {}, 'Hospitali') : null,
            h('th', {}, 'Mtumiaji'),
            h('th', {}, 'Kitendo'),
            h('th', {}, 'Maelezo'),
            h('th', {}, 'IP')
          )),
          h('tbody', {}, res.items.map((a) => {
            const act = ACTIONS[a.action] || ['grey', a.action];
            return h('tr', {},
              h('td', { class: 'small nowrap' }, HugoMed.dateTime(a.at)),
              isSuper ? h('td', { class: 'small' }, a.tenant_name || 'HUGO TECH') : null,
              h('td', {}, a.user_name || '—', a.user_role ? h('div', { class: 'muted small' }, HugoMed.ROLES[a.user_role] || a.user_role) : null),
              h('td', {}, h('span', { class: 'chip ' + act[0] }, act[1])),
              h('td', { class: 'small' }, changes(a)),
              h('td', { class: 'small muted' }, a.ip || '—')
            );
          }))
        )
      ));
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  load();
};
