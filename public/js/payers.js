// =============================================================
// HugoMed - Bima na kampuni (Admin wa hospitali)
// Cash na NHIF vinawekwa vyenyewe hospitali inaposajiliwa.
// Hapa unaongeza bima binafsi na kampuni zinazolipia wafanyakazi wao.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.payers = function (page) {
  const h = HugoMed.h;

  const addBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Ongeza bima au kampuni');
  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Bima na kampuni'), h('p', { class: 'muted' }, 'Walipaji wanaokubaliwa na hospitali hii')),
    addBtn
  ));

  // ---------- Fomu ----------
  const msg = h('p', { class: 'form-message', role: 'alert' });
  const form = h('form', { class: 'card', hidden: true, novalidate: true },
    h('h2', {}, 'Mlipaji mpya'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Aina', h('select', { name: 'type' },
        h('option', { value: 'insurance' }, 'Bima binafsi'),
        h('option', { value: 'company' }, 'Kampuni (credit customer)')
      )),
      h('label', {}, 'Jina', h('input', { name: 'name', required: true, placeholder: 'Mf. Jubilee, AAR, au jina la kampuni' })),
      h('label', {}, 'Mtu wa mawasiliano', h('input', { name: 'contact_person' })),
      h('label', {}, 'Simu', h('input', { name: 'phone' })),
      h('label', {}, 'Barua pepe', h('input', { name: 'email', type: 'email' })),
      h('label', {}, 'Kikomo cha deni (TSh)', h('input', { name: 'credit_limit', inputmode: 'numeric', placeholder: 'Kwa kampuni' })),
      h('label', {}, 'Muda wa kulipa (siku)', h('input', { name: 'payment_terms_days', inputmode: 'numeric', value: '30' })),
      h('label', {}, 'Co-pay ya mgonjwa (%)', h('input', { name: 'copay_percent', inputmode: 'decimal', value: '0' }))
    ),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'requires_preauth' }), 'Huduma kubwa zinahitaji idhini kwanza (pre-authorization)'),
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
    const body = HugoMed.formData(form);
    body.requires_preauth = form.querySelector('input[name=requires_preauth]').checked;
    try {
      const r = await HugoMed.api('/api/payers', { method: 'POST', body });
      HugoMed.showMessage(msg, r.payer.name + ' imeongezwa.', 'ok');
      form.reset();
      load();
    } catch (err) {
      HugoMed.showMessage(msg, err.message, 'error');
    }
  });

  // ---------- Orodha ----------
  const box = h('section', { class: 'card flush', style: 'margin-top: 20px' });
  page.appendChild(box);

  async function toggle(p) {
    try {
      await HugoMed.api('/api/payers/' + p.id, { method: 'PATCH', body: { is_active: !p.is_active } });
      load();
    } catch (err) { window.alert(err.message); }
  }

  async function load() {
    try {
      const res = await HugoMed.api('/api/payers');
      box.textContent = '';
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Jina'), h('th', {}, 'Aina'), h('th', {}, 'Kikomo cha deni'), h('th', {}, 'Muda wa kulipa'),
          h('th', {}, 'Co-pay'), h('th', {}, 'Pre-auth'), h('th', {}, 'Hali'), h('th', {}, '')
        )),
        h('tbody', {}, res.items.map((p) => h('tr', { class: p.is_active ? '' : 'inactive' },
          h('td', {}, h('strong', {}, p.name), p.contact_person || p.phone ? h('div', { class: 'muted small' }, [p.contact_person, p.phone].filter(Boolean).join(' · ')) : null),
          h('td', {}, HugoMed.PAYER_TYPES[p.type] || p.type),
          h('td', {}, p.credit_limit ? HugoMed.money(p.credit_limit) : '—'),
          h('td', {}, p.type === 'cash' ? '—' : 'siku ' + p.payment_terms_days),
          h('td', {}, Number(p.copay_percent) ? Number(p.copay_percent) + '%' : '—'),
          h('td', {}, p.requires_preauth ? 'Ndiyo' : '—'),
          h('td', {}, h('span', { class: 'chip ' + (p.is_active ? 'green' : 'grey') }, p.is_active ? 'Inakubaliwa' : 'Imezimwa')),
          h('td', { class: 'row-actions' }, p.type === 'cash' ? null :
            h('button', { type: 'button', class: 'btn small' + (p.is_active ? ' danger' : ''), onclick: () => toggle(p) }, p.is_active ? 'Zima' : 'Washa'))
        )))
      )));
      box.appendChild(h('p', { class: 'muted small pad' }, 'Price list ya kila mlipaji itawekwa kwenye Hatua ya Billing.'));
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  load();
};
