// =============================================================
// HugoMed - Hospitali (Super Admin wa HUGO TECH)
// Kusajili hospitali mpya pamoja na Admin wake, na kusimamisha / kuwasha.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.tenants = function (page) {
  const h = HugoMed.h;

  const STATUS = {
    active: ['green', 'Inatumika'],
    trial: ['amber', 'Majaribio'],
    suspended: ['red', 'Imesimamishwa']
  };

  // ---------- Kichwa ----------
  const addBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Sajili hospitali');
  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Hospitali'), h('p', { class: 'muted' }, 'Wateja wote wa HugoMed')),
    addBtn
  ));

  // ---------- Fomu ya kusajili ----------
  const levelSelect = h('select', { name: 'facility_level' },
    Object.entries(HugoMed.LEVELS).map(([v, l]) => h('option', { value: v, selected: v === 'clinic' }, l))
  );
  const msg = h('p', { class: 'form-message', role: 'alert' });
  const form = h('form', { class: 'card', hidden: true, novalidate: true },
    h('h2', {}, 'Hospitali mpya'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Jina la hospitali', h('input', { name: 'name', required: true })),
      h('label', {}, 'Ngazi ya kituo', levelSelect),
      h('label', {}, 'Namba ya kituo NHIF', h('input', { name: 'nhif_facility_code' })),
      h('label', {}, 'Simu', h('input', { name: 'phone' })),
      h('label', {}, 'Barua pepe ya hospitali', h('input', { name: 'email', type: 'email' })),
      h('label', {}, 'Mahali', h('input', { name: 'address', placeholder: 'Mkoa, wilaya' })),
      h('label', {}, 'Hali', h('select', { name: 'status' },
        h('option', { value: 'active' }, 'Inatumika'),
        h('option', { value: 'trial' }, 'Majaribio')
      ))
    ),
    h('h2', { style: 'margin-top: 20px' }, 'Admin wa hospitali (ataongeza watumiaji wengine)'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Jina kamili', h('input', { name: 'admin_full_name', required: true })),
      h('label', {}, 'Barua pepe', h('input', { name: 'admin_email', type: 'email', required: true })),
      h('label', {}, 'Simu', h('input', { name: 'admin_phone' })),
      h('label', {}, 'Password ya mwanzo', h('input', { name: 'admin_password', type: 'text', required: true, placeholder: 'Herufi 8+, na namba' }))
    ),
    msg,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { form.hidden = true; } }, 'Ghairi'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Sajili hospitali')
    )
  );
  page.appendChild(form);
  addBtn.addEventListener('click', () => { form.hidden = !form.hidden; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    HugoMed.showMessage(msg, '');
    try {
      const res = await HugoMed.api('/api/tenants', { method: 'POST', body: HugoMed.formData(form) });
      HugoMed.showMessage(msg, res.tenant.name + ' imesajiliwa. Admin anaweza kuingia kwa ' + res.admin.email + '.', 'ok');
      form.reset();
      load();
    } catch (err) {
      HugoMed.showMessage(msg, err.message, 'error');
    }
    btn.disabled = false;
  });

  // ---------- Orodha ----------
  const listBox = h('section', { class: 'card flush', style: 'margin-top: 20px' });
  page.appendChild(listBox);

  async function setStatus(t, status) {
    const verb = status === 'suspended' ? 'Kusimamisha' : 'Kuwasha';
    if (!window.confirm(verb + ' ' + t.name + '?')) return;
    try {
      await HugoMed.api('/api/tenants/' + t.id, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function load() {
    listBox.textContent = '';
    listBox.appendChild(h('p', { class: 'muted pad' }, 'Inapakia...'));
    try {
      const res = await HugoMed.api('/api/tenants');
      listBox.textContent = '';
      if (!res.items.length) {
        listBox.appendChild(h('p', { class: 'muted pad' }, 'Bado hakuna hospitali. Bofya "Sajili hospitali".'));
        return;
      }
      listBox.appendChild(h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Hospitali'), h('th', {}, 'Ngazi'), h('th', {}, 'Watumiaji'),
            h('th', {}, 'Wagonjwa'), h('th', {}, 'Imesajiliwa'), h('th', {}, 'Hali'), h('th', {}, '')
          )),
          h('tbody', {}, res.items.map((t) => {
            const st = STATUS[t.status] || ['grey', t.status];
            return h('tr', {},
              h('td', {}, h('strong', {}, t.name), h('div', { class: 'muted small' }, [t.phone, t.address].filter(Boolean).join(' · '))),
              h('td', {}, HugoMed.LEVELS[t.facility_level] || t.facility_level),
              h('td', {}, String(t.user_count)),
              h('td', {}, String(t.patient_count)),
              h('td', {}, HugoMed.date(t.created_at)),
              h('td', {}, h('span', { class: 'chip ' + st[0] }, st[1])),
              h('td', { class: 'row-actions' },
                h('a', { class: 'btn small', href: '#/users?tenant=' + t.id }, 'Watumiaji'),
                t.status === 'suspended'
                  ? h('button', { type: 'button', class: 'btn small', onclick: () => setStatus(t, 'active') }, 'Washa')
                  : h('button', { type: 'button', class: 'btn small danger', onclick: () => setStatus(t, 'suspended') }, 'Simamisha')
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
