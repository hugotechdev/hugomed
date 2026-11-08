// =============================================================
// HugoMed - Watumiaji wa hospitali
// Admin wa hospitali anaongeza wafanyakazi, anabadilisha kazi (role),
// anazima / kuwasha akaunti, na anaweka password mpya.
// Super Admin anachagua hospitali kwanza.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.users = function (page, me) {
  const h = HugoMed.h;
  const isSuper = me.role === 'super_admin';
  const HOSPITAL_ROLES = Object.keys(HugoMed.ROLES).filter((r) => r !== 'super_admin');

  // Hospitali iliyochaguliwa (kwa Super Admin) kutoka '#/users?tenant=3'
  const hashQuery = new URLSearchParams((window.location.hash.split('?')[1]) || '');
  let tenantId = isSuper ? (Number(hashQuery.get('tenant')) || null) : me.tenant_id;

  function q() { return isSuper && tenantId ? '?tenant_id=' + tenantId : ''; }

  // ---------- Kichwa ----------
  const addBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Ongeza mtumiaji');
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Watumiaji'), h('p', { class: 'muted' }, 'Wafanyakazi wanaoweza kuingia kwenye mfumo')),
    addBtn
  );
  page.appendChild(head);

  // ---------- Kuchagua hospitali (Super Admin) ----------
  if (isSuper) {
    const sel = h('select', { 'aria-label': 'Chagua hospitali' }, h('option', { value: '' }, 'Chagua hospitali...'));
    const picker = h('div', { class: 'card', style: 'margin-bottom: 16px' }, h('label', {}, 'Hospitali', sel));
    page.appendChild(picker);
    HugoMed.api('/api/tenants').then((res) => {
      res.items.forEach((t) => sel.appendChild(h('option', { value: t.id, selected: t.id === tenantId }, t.name)));
    });
    sel.addEventListener('change', () => {
      window.location.hash = '#/users' + (sel.value ? '?tenant=' + sel.value : '');
    });
  }

  // ---------- Fomu ya kuongeza ----------
  const msg = h('p', { class: 'form-message', role: 'alert' });
  const form = h('form', { class: 'card', hidden: true, novalidate: true },
    h('h2', {}, 'Mtumiaji mpya'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Jina kamili', h('input', { name: 'full_name', required: true })),
      h('label', {}, 'Barua pepe (ya kuingia)', h('input', { name: 'email', type: 'email', required: true })),
      h('label', {}, 'Simu', h('input', { name: 'phone' })),
      h('label', {}, 'Kazi (role)', h('select', { name: 'role', required: true },
        h('option', { value: '' }, 'Chagua...'),
        HOSPITAL_ROLES.map((r) => h('option', { value: r }, HugoMed.ROLES[r]))
      )),
      h('label', {}, 'Namba ya usajili wa kitaaluma', h('input', { name: 'professional_reg_no', placeholder: 'Kwa daktari, nesi, mfamasia...' })),
      h('label', {}, 'Leseni inaisha', h('input', { name: 'license_expiry', type: 'date' })),
      h('label', {}, 'Password ya mwanzo', h('input', { name: 'password', type: 'text', required: true, placeholder: 'Herufi 8+, na namba' }))
    ),
    msg,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { form.hidden = true; } }, 'Ghairi'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi mtumiaji')
    )
  );
  page.appendChild(form);
  addBtn.addEventListener('click', () => {
    if (isSuper && !tenantId) { window.alert('Chagua hospitali kwanza.'); return; }
    form.hidden = !form.hidden;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    HugoMed.showMessage(msg, '');
    try {
      const body = HugoMed.formData(form);
      if (!body.license_expiry) delete body.license_expiry;
      if (isSuper) body.tenant_id = tenantId;
      const res = await HugoMed.api('/api/users', { method: 'POST', body });
      HugoMed.showMessage(msg, res.user.full_name + ' ameongezwa. Mpe barua pepe na password yake ya mwanzo.', 'ok');
      form.reset();
      load();
    } catch (err) {
      HugoMed.showMessage(msg, err.message, 'error');
    }
    btn.disabled = false;
  });

  // ---------- Password mpya ----------
  const resetMsg = h('p', { class: 'form-message', role: 'alert' });
  const resetTitle = h('h2', {});
  const resetInput = h('input', { type: 'text', name: 'password', placeholder: 'Herufi 8+, na namba' });
  let resetUser = null;
  const resetForm = h('form', { class: 'card', hidden: true, novalidate: true },
    resetTitle,
    h('label', {}, 'Password mpya', resetInput),
    resetMsg,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { resetForm.hidden = true; } }, 'Ghairi'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Weka password')
    )
  );
  page.appendChild(resetForm);

  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await HugoMed.api('/api/users/' + resetUser.id + '/reset-password', { method: 'POST', body: { password: resetInput.value } });
      HugoMed.showMessage(resetMsg, 'Password mpya ya ' + resetUser.full_name + ' imewekwa.', 'ok');
      resetInput.value = '';
    } catch (err) {
      HugoMed.showMessage(resetMsg, err.message, 'error');
    }
  });

  function openReset(u) {
    resetUser = u;
    resetTitle.textContent = 'Password mpya: ' + u.full_name;
    HugoMed.showMessage(resetMsg, '');
    resetForm.hidden = false;
    resetInput.focus();
  }

  // ---------- Orodha ----------
  const listBox = h('section', { class: 'card flush', style: 'margin-top: 20px' });
  page.appendChild(listBox);

  async function patch(u, body) {
    try {
      await HugoMed.api('/api/users/' + u.id + q(), { method: 'PATCH', body });
      load();
    } catch (err) {
      window.alert(err.message);
      load();
    }
  }

  function licenseChip(u) {
    if (!u.license_expiry) return h('span', { class: 'muted small' }, '—');
    const d = new Date(u.license_expiry);
    const days = Math.floor((d - Date.now()) / 864e5);
    if (days < 0) return h('span', { class: 'chip red' }, 'Imeisha ' + HugoMed.date(d));
    if (days <= 60) return h('span', { class: 'chip amber' }, 'Inaisha ' + HugoMed.date(d));
    return h('span', { class: 'small' }, HugoMed.date(d));
  }

  async function load() {
    listBox.textContent = '';
    if (isSuper && !tenantId) {
      listBox.appendChild(h('p', { class: 'muted pad' }, 'Chagua hospitali ili kuona watumiaji wake.'));
      return;
    }
    listBox.appendChild(h('p', { class: 'muted pad' }, 'Inapakia...'));
    try {
      const res = await HugoMed.api('/api/users' + q());
      listBox.textContent = '';
      listBox.appendChild(h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Jina'), h('th', {}, 'Kazi'), h('th', {}, 'Leseni'),
            h('th', {}, 'Mara ya mwisho kuingia'), h('th', {}, 'Hali'), h('th', {}, '')
          )),
          h('tbody', {}, res.items.map((u) => {
            const isMe = u.id === me.id;
            const roleSelect = h('select', { class: 'compact', 'aria-label': 'Kazi ya ' + u.full_name, disabled: isMe },
              HOSPITAL_ROLES.map((r) => h('option', { value: r, selected: r === u.role }, HugoMed.ROLES[r]))
            );
            roleSelect.addEventListener('change', () => patch(u, { role: roleSelect.value }));
            return h('tr', { class: u.is_active ? '' : 'inactive' },
              h('td', {}, h('strong', {}, u.full_name), h('div', { class: 'muted small' }, u.email + (u.phone ? ' · ' + u.phone : ''))),
              h('td', {}, roleSelect, u.professional_reg_no ? h('div', { class: 'muted small' }, 'Reg: ' + u.professional_reg_no) : null),
              h('td', {}, licenseChip(u)),
              h('td', { class: 'small' }, HugoMed.dateTime(u.last_login_at)),
              h('td', {}, h('span', { class: 'chip ' + (u.is_active ? 'green' : 'grey') }, u.is_active ? 'Hai' : 'Imezimwa')),
              h('td', { class: 'row-actions' },
                h('button', { type: 'button', class: 'btn small', onclick: () => openReset(u) }, 'Password mpya'),
                isMe ? null : (u.is_active
                  ? h('button', { type: 'button', class: 'btn small danger', onclick: () => { if (window.confirm('Kumzima ' + u.full_name + '?')) patch(u, { is_active: false }); } }, 'Zima')
                  : h('button', { type: 'button', class: 'btn small', onclick: () => patch(u, { is_active: true }) }, 'Washa'))
              )
            );
          }))
        )
      ));
    } catch (err) {
      listBox.textContent = '';
      listBox.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  load();
};
