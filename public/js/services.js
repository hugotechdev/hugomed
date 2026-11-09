// =============================================================
// HugoMed - Vipimo, dawa na huduma (Admin wa hospitali)
// Orodha ambayo daktari anachagua anapoagiza. Bei zitawekwa kwenye Billing.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.services = function (page) {
  const h = HugoMed.h;
  const CATS = {
    lab: 'Vipimo vya maabara',
    drug: 'Dawa',
    procedure: 'Huduma (procedures)',
    consultation: 'Ushauri wa daktari',
    radiology: 'Radiology',
    bed: 'Kitanda / wodi',
    other: 'Nyingine'
  };
  const UNITS = ['tab', 'cap', 'sachet', 'vial', 'bottle', 'tube', 'inhaler', 'test', 'visit', 'procedure', 'day'];
  let filter = 'lab';

  const seedMsg = h('p', { class: 'form-message', role: 'status' });
  const seedBtn = h('button', { type: 'button', class: 'btn' }, 'Weka orodha ya kuanzia');
  const addBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Ongeza');
  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Vipimo, dawa na huduma'), h('p', { class: 'muted' }, 'Daktari anachagua kutoka kwenye orodha hii')),
    h('div', { class: 'row-actions' }, seedBtn, addBtn)
  ));
  page.appendChild(seedMsg);

  seedBtn.addEventListener('click', async () => {
    seedBtn.disabled = true;
    try {
      const r = await HugoMed.api('/api/services/seed', { method: 'POST', body: {} });
      HugoMed.showMessage(seedMsg, r.message, 'ok');
      load();
    } catch (err) { HugoMed.showMessage(seedMsg, err.message, 'error'); }
    seedBtn.disabled = false;
  });

  // ---------- Fomu ----------
  const msg = h('p', { class: 'form-message', role: 'alert' });
  const form = h('form', { class: 'card', hidden: true, novalidate: true },
    h('h2', {}, 'Huduma mpya'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Aina', h('select', { name: 'category' }, Object.entries(CATS).map(([k, l]) => h('option', { value: k }, l)))),
      h('label', {}, 'Jina', h('input', { name: 'name', required: true, placeholder: 'Mf. Amoxicillin 250mg' })),
      h('label', {}, 'Code ya hospitali', h('input', { name: 'code', placeholder: 'Si lazima' })),
      h('label', {}, 'Kipimo (unit)', h('select', { name: 'unit' }, h('option', { value: '' }, '—'), UNITS.map((u) => h('option', { value: u }, u))))
    ),
    msg,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { form.hidden = true; } }, 'Ghairi'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi')
    )
  );
  page.appendChild(form);
  addBtn.addEventListener('click', () => { form.hidden = !form.hidden; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await HugoMed.api('/api/services', { method: 'POST', body: HugoMed.formData(form) });
      HugoMed.showMessage(msg, r.service.name + ' imeongezwa.', 'ok');
      form.reset();
      filter = r.service.category;
      load();
    } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
  });

  // ---------- Orodha ----------
  const tabs = h('div', { class: 'stage-tabs', style: 'margin-top: 16px' });
  page.appendChild(tabs);
  const box = h('section', { class: 'card flush' });
  page.appendChild(box);

  async function toggle(s) {
    try {
      await HugoMed.api('/api/services/' + s.id, { method: 'PATCH', body: { is_active: !s.is_active } });
      load();
    } catch (err) { window.alert(err.message); }
  }

  async function load() {
    try {
      const res = await HugoMed.api('/api/services?all=1');
      const counts = {};
      res.items.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
      tabs.textContent = '';
      Object.entries(CATS).forEach(([k, l]) => {
        if (!counts[k] && k !== filter && !['lab', 'drug'].includes(k)) return;
        tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (filter === k ? ' on' : ''), onclick: () => { filter = k; load(); } },
          l, h('span', { class: 'count' }, String(counts[k] || 0))));
      });

      const items = res.items.filter((s) => s.category === filter);
      box.textContent = '';
      if (!items.length) {
        box.appendChild(h('p', { class: 'muted pad' }, 'Hakuna kitu kwenye kundi hili. Bofya "Weka orodha ya kuanzia" au "+ Ongeza".'));
        return;
      }
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Jina'), h('th', {}, 'Code'), h('th', {}, 'Unit'), h('th', {}, 'Hali'), h('th', {}, ''))),
        h('tbody', {}, items.map((s) => h('tr', { class: s.is_active ? '' : 'inactive' },
          h('td', {}, h('strong', {}, s.name)),
          h('td', { class: 'small' }, s.code || '—'),
          h('td', { class: 'small' }, s.unit || '—'),
          h('td', {}, h('span', { class: 'chip ' + (s.is_active ? 'green' : 'grey') }, s.is_active ? 'Inatumika' : 'Imezimwa')),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small' + (s.is_active ? ' danger' : ''), onclick: () => toggle(s) }, s.is_active ? 'Zima' : 'Washa'))
        )))
      )));
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  load();
};
