// =============================================================
// HugoMed - Price lists: bei ya kila huduma kwa kila mlipaji
// Cash ni msingi. NHIF na bima zina bei, item code na "inalipwa / hailipwi".
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.prices = function (page, me) {
  const h = HugoMed.h;
  const canEdit = ['hospital_admin', 'accountant'].includes(me.role);
  const CATS = { consultation: 'Ushauri', lab: 'Maabara', radiology: 'Radiology', drug: 'Dawa', procedure: 'Huduma', bed: 'Kitanda', other: 'Nyingine' };
  let listId = null;

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Price lists'), h('p', { class: 'muted' }, 'Bei ya kila huduma kwa kila mlipaji. Huduma isiyolipwa na bima, mgonjwa analipa bei ya cash.'))
  ));
  const picker = h('div', { class: 'stage-tabs' });
  page.appendChild(picker);
  const msg = h('p', { class: 'form-message', role: 'status' });
  page.appendChild(msg);
  const box = h('section', { class: 'card flush' });
  page.appendChild(box);

  async function loadLists() {
    const r = await HugoMed.api('/api/billing/price-lists');
    picker.textContent = '';
    if (!listId && r.items[0]) listId = r.items[0].id;
    r.items.forEach((pl) => picker.appendChild(h('button', {
      type: 'button', class: 'stage-tab' + (pl.id === listId ? ' on' : ''),
      onclick: () => { listId = pl.id; loadLists(); loadPrices(); }
    }, pl.name, h('span', { class: 'count' }, String(pl.priced)))));
  }

  async function loadPrices() {
    box.textContent = '';
    box.appendChild(h('p', { class: 'muted pad' }, 'Inapakia...'));
    try {
      const r = await HugoMed.api('/api/billing/price-lists/' + listId);
      const isCash = r.price_list.payer_type === 'cash';
      box.textContent = '';
      if (!r.items.length) {
        box.appendChild(h('p', { class: 'muted pad' }, 'Hakuna huduma. Weka kwanza kwenye "Vipimo na dawa".'));
        return;
      }
      const inputs = [];
      const table = h('table', { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Huduma'), h('th', {}, 'Aina'), h('th', {}, 'Bei (TSh)'), isCash ? null : h('th', {}, 'Item code ya mlipaji'), isCash ? null : h('th', {}, 'Inalipwa'))),
        h('tbody', {}, r.items.map((s) => {
          const price = h('input', { inputmode: 'numeric', value: s.price !== null ? String(Number(s.price)) : '', 'aria-label': 'Bei ya ' + s.name, disabled: !canEdit, class: 'price-input' });
          const code = h('input', { value: s.payer_item_code || '', 'aria-label': 'Item code ya ' + s.name, disabled: !canEdit, class: 'code-input' });
          const cov = h('input', { type: 'checkbox', checked: s.is_covered, 'aria-label': s.name + ' inalipwa', disabled: !canEdit });
          inputs.push({ service_id: s.service_id, price, code, cov });
          return h('tr', {},
            h('td', {}, h('strong', {}, s.name), s.code ? h('div', { class: 'muted small' }, s.code) : null),
            h('td', { class: 'small' }, CATS[s.category] || s.category),
            h('td', {}, price),
            isCash ? null : h('td', {}, code),
            isCash ? null : h('td', {}, cov)
          );
        }))
      );
      box.appendChild(h('div', { class: 'table-wrap' }, table));

      if (canEdit) {
        const save = h('button', { type: 'button', class: 'btn primary' }, 'Hifadhi bei zote');
        save.addEventListener('click', async () => {
          const items = inputs.filter((i) => i.price.value !== '').map((i) => ({
            service_id: i.service_id, price: Number(i.price.value), payer_item_code: i.code.value.trim(), is_covered: i.cov.checked
          }));
          try {
            const res = await HugoMed.api('/api/billing/price-lists/' + listId, { method: 'PUT', body: { items } });
            HugoMed.showMessage(msg, res.message, 'ok');
            loadLists();
          } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
        });
        const copy = isCash ? null : h('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            try {
              const res = await HugoMed.api('/api/billing/price-lists/' + listId + '/copy-cash', { method: 'POST', body: {} });
              HugoMed.showMessage(msg, res.message, 'ok');
              loadLists(); loadPrices();
            } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
          }
        }, 'Nakili bei za Cash');
        box.appendChild(h('div', { class: 'pad row-actions' }, copy, save));
      }
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  loadLists().then(loadPrices).catch((err) => HugoMed.showMessage(msg, err.message, 'error'));
};
