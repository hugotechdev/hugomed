// =============================================================
// HugoMed - Stock ya dawa: kupokea mzigo, batches, expiry, tahadhari
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.stock = function (page, me) {
  const h = HugoMed.h;
  const canEdit = ['pharmacist', 'hospital_admin'].includes(me.role);
  let filter = 'all';
  let items = [];

  const recvBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Pokea mzigo');
  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Stock ya dawa'), h('p', { class: 'muted' }, 'Batch inayoisha mapema inatolewa kwanza (FEFO)')),
    canEdit ? recvBtn : null
  ));
  const msg = h('p', { class: 'form-message', role: 'status' });
  page.appendChild(msg);

  // ---------- Kupokea mzigo ----------
  const drugSel = h('select', { name: 'service_id', required: true });
  const recvForm = h('form', { class: 'card', hidden: true, novalidate: true },
    h('h2', {}, 'Pokea mzigo'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Dawa', drugSel),
      h('label', {}, 'Namba ya batch', h('input', { name: 'batch_no', required: true })),
      h('label', {}, 'Inaisha (expiry)', h('input', { name: 'expiry_date', type: 'date', required: true })),
      h('label', {}, 'Idadi', h('input', { name: 'quantity', inputmode: 'numeric', required: true })),
      h('label', {}, 'Bei ya kununua kwa kimoja (TSh)', h('input', { name: 'unit_cost', inputmode: 'decimal' })),
      h('label', {}, 'Msambazaji', h('input', { name: 'supplier', placeholder: 'Mf. MSD' }))
    ),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { recvForm.hidden = true; } }, 'Ghairi'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi')
    )
  );
  page.appendChild(recvForm);
  recvBtn.addEventListener('click', () => { recvForm.hidden = !recvForm.hidden; });
  recvForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await HugoMed.api('/api/stock/receive', { method: 'POST', body: HugoMed.formData(recvForm) });
      HugoMed.showMessage(msg, r.message, 'ok');
      recvForm.reset();
      load();
    } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
  });

  const summary = h('div', { class: 'stat-grid', style: 'margin-top: 16px' });
  page.appendChild(summary);
  const tabs = h('div', { class: 'stage-tabs', style: 'margin-top: 16px' });
  page.appendChild(tabs);
  const box = h('section', { class: 'card flush' });
  page.appendChild(box);

  function adjust(batch, name) {
    const change = window.prompt(name + ' · batch ' + batch.batch_no + ' (zipo ' + Number(batch.quantity) + ')\nAndika idadi ya kuongeza (mf. 10) au kupunguza (mf. -5):');
    if (!change) return;
    const note = window.prompt('Sababu (mf. imeharibika, imeisha muda, hesabu ya stock):');
    if (!note) return;
    const reason = /muda|expir/i.test(note) ? 'expired' : 'adjusted';
    HugoMed.api('/api/stock/adjust', { method: 'POST', body: { stock_item_id: batch.id, change: Number(change), reason, note } })
      .then((r) => { HugoMed.showMessage(msg, r.message, 'ok'); load(); })
      .catch((err) => HugoMed.showMessage(msg, err.message, 'error'));
  }

  function setReorder(s) {
    const v = window.prompt(s.name + ': kiwango cha chini kabla ya kuagiza upya?', String(Number(s.reorder_level) || ''));
    if (v === null) return;
    HugoMed.api('/api/stock/reorder/' + s.service_id, { method: 'PATCH', body: { reorder_level: Number(v) } })
      .then((r) => { HugoMed.showMessage(msg, r.message, 'ok'); load(); })
      .catch((err) => HugoMed.showMessage(msg, err.message, 'error'));
  }

  function render() {
    const low = items.filter((s) => s.low || s.out);
    const exp = items.filter((s) => Number(s.expiring_soon) > 0 || Number(s.expired) > 0);
    const value = items.reduce((a, s) => a + Number(s.value), 0);
    summary.textContent = '';
    [['Aina za dawa', items.length], ['Zimeisha / chini', low.length], ['Zinaisha muda (siku 90)', exp.length], ['Thamani ya stock', HugoMed.money(value)]]
      .forEach(([l, v]) => summary.appendChild(h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, l), h('div', { class: 'stat-value' }, String(v)))));

    tabs.textContent = '';
    [['all', 'Zote', items.length], ['low', 'Zimeisha / chini', low.length], ['exp', 'Expiry', exp.length]].forEach(([k, l, n]) => {
      tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (filter === k ? ' on' : ''), onclick: () => { filter = k; render(); } }, l, h('span', { class: 'count' }, String(n))));
    });

    const list = filter === 'low' ? low : filter === 'exp' ? exp : items;
    box.textContent = '';
    if (!list.length) { box.appendChild(h('p', { class: 'muted pad' }, 'Hakuna.')); return; }
    box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Dawa'), h('th', {}, 'Zinazotumika'), h('th', {}, 'Kiwango cha chini'), h('th', {}, 'Batches'), h('th', {}, 'Tahadhari'))),
      h('tbody', {}, list.map((s) => h('tr', {},
        h('td', {}, h('strong', {}, s.name), h('div', { class: 'muted small' }, s.unit || '')),
        h('td', {}, h('strong', {}, String(Number(s.usable)))),
        h('td', {}, canEdit ? h('button', { type: 'button', class: 'btn small', onclick: () => setReorder(s) }, String(Number(s.reorder_level))) : String(Number(s.reorder_level))),
        h('td', { class: 'small' }, s.batches.length ? s.batches.map((b) => h('div', { class: 'batch-row' },
          h('span', {}, b.batch_no + ' · ' + Number(b.quantity) + ' · exp ' + HugoMed.date(b.expiry_date)),
          canEdit ? h('button', { type: 'button', class: 'link-btn', onclick: () => adjust(b, s.name) }, 'rekebisha') : null
        )) : '—'),
        h('td', {},
          s.out ? h('span', { class: 'chip red' }, 'Imeisha') : s.low ? h('span', { class: 'chip amber' }, 'Iko chini') : null,
          !s.ever_received ? h('span', { class: 'chip grey' }, 'Haijawahi kupokelewa') : null,
          Number(s.expired) > 0 ? h('span', { class: 'chip red' }, Number(s.expired) + ' zimeisha muda') : null,
          Number(s.expiring_soon) > 0 ? h('span', { class: 'chip amber' }, Number(s.expiring_soon) + ' zinaisha < siku 90') : null
        )
      )))
    )));
  }

  async function load() {
    try {
      const r = await HugoMed.api('/api/stock');
      items = r.items;
      drugSel.textContent = '';
      drugSel.appendChild(h('option', { value: '' }, 'Chagua dawa...'));
      items.forEach((s) => drugSel.appendChild(h('option', { value: s.service_id }, s.name)));
      render();
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  load();
};
