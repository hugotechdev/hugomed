// =============================================================
// HugoMed - Malipo (Cashier)
// Zamu ya cashier, foleni ya malipo, bili iliyogawanywa (mlipaji / mgonjwa),
// kupokea malipo, risiti, msamaha, kufunga bili.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.cashier = function (page, me) {
  const h = HugoMed.h;
  const METHODS = {
    cash: 'Cash', mpesa: 'M-Pesa', airtel_money: 'Airtel Money', tigo_pesa: 'Tigo Pesa', halopesa: 'HaloPesa',
    selcom: 'Selcom', azampay: 'AzamPay', bank: 'Benki', card: 'Kadi', other: 'Nyingine'
  };
  const canWaive = ['hospital_admin', 'accountant'].includes(me.role);
  const root = h('div');
  page.appendChild(root);

  // ---------- Zamu ----------
  async function shiftCard() {
    const card = h('section', { class: 'card shift-card' });
    try {
      const r = await HugoMed.api('/api/billing/shift');
      if (!r.shift) {
        card.appendChild(h('div', {}, h('strong', {}, 'Huna zamu iliyo wazi.'), h('div', { class: 'muted small' }, 'Zamu inafunguka yenyewe ukipokea malipo ya kwanza.')));
        card.appendChild(h('button', { type: 'button', class: 'btn', onclick: async () => { await HugoMed.api('/api/billing/shift/open', { method: 'POST', body: {} }); showQueue(); } }, 'Fungua zamu'));
      } else {
        const total = r.totals.reduce((a, t) => a + Number(t.total), 0);
        card.appendChild(h('div', {},
          h('strong', {}, 'Zamu iko wazi tangu ' + HugoMed.dateTime(r.shift.opened_at)),
          h('div', { class: 'muted small' }, r.totals.length ? r.totals.map((t) => METHODS[t.method] + ': ' + HugoMed.money(t.total)).join(' · ') + ' · Jumla ' + HugoMed.money(total) : 'Bado hakuna malipo kwenye zamu hii.')
        ));
        const counted = h('input', { inputmode: 'numeric', placeholder: 'Cash uliyohesabu', 'aria-label': 'Cash uliyohesabu', style: 'width: 180px' });
        const msg = h('span', { class: 'small' });
        const closeForm = h('form', { class: 'order-row' }, counted, h('button', { type: 'submit', class: 'btn' }, 'Funga zamu'), msg);
        closeForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!window.confirm('Kufunga zamu sasa?')) return;
          try {
            const c = await HugoMed.api('/api/billing/shift/close', { method: 'POST', body: { counted_cash: counted.value } });
            window.alert(c.message);
            showQueue();
          } catch (err) { msg.textContent = err.message; msg.className = 'small form-message error'; }
        });
        card.appendChild(closeForm);
      }
    } catch (err) {
      card.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
    return card;
  }

  // ---------- Foleni ----------
  async function showQueue() {
    root.textContent = '';
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Malipo'), h('p', { class: 'muted' }, 'Bili, malipo, risiti na zamu ya cashier')),
      h('button', { type: 'button', class: 'btn', onclick: showQueue }, 'Onyesha upya')
    ));
    if (['cashier', 'hospital_admin', 'accountant'].includes(me.role)) root.appendChild(await shiftCard());

    try {
      const r = await HugoMed.api('/api/billing/queue');
      const table = (items, empty) => {
        if (!items.length) return h('p', { class: 'muted pad' }, empty);
        return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Token'), h('th', {}, 'Mgonjwa'), h('th', {}, 'Mlipaji'), h('th', {}, 'Hatua'), h('th', {}, 'Bili'), h('th', {}, 'Deni la mgonjwa'), h('th', {}, ''))),
          h('tbody', {}, items.map((v) => h('tr', {},
            h('td', {}, h('strong', {}, v.token)),
            h('td', {}, HugoMed.patientName(v), h('div', { class: 'muted small' }, 'MRN ' + v.mrn)),
            h('td', {}, v.payer_name || 'Cash'),
            h('td', {}, HugoMed.stageChip(v.stage)),
            h('td', { class: 'small' }, v.invoice_no ? HugoMed.money(v.total) : '—'),
            h('td', {}, v.invoice_no ? h('span', { class: 'chip ' + (v.balance > 0 ? 'red' : 'green') }, v.balance > 0 ? HugoMed.money(v.balance) : 'Hakuna') : h('span', { class: 'muted small' }, 'Fungua kuona')),
            h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small primary', onclick: () => openVisit(v.id) }, 'Fungua bili'))
          )))
        ));
      };
      root.appendChild(h('section', { class: 'card flush', style: 'margin-top: 16px' },
        h('h2', { class: 'pad', style: 'padding-bottom: 0' }, 'Wanasubiri malipo (' + r.billing.length + ')'),
        table(r.billing, 'Hakuna anayesubiri malipo.')
      ));
      root.appendChild(h('section', { class: 'card flush', style: 'margin-top: 16px' },
        h('h2', { class: 'pad', style: 'padding-bottom: 0' }, 'Walio ndani wenye maagizo (kulipa kabla ya huduma)'),
        table(r.other, 'Hakuna.')
      ));
    } catch (err) {
      root.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  // ---------- Bili ya mgonjwa ----------
  async function openVisit(id, flashText) {
    root.textContent = '';
    root.appendChild(h('p', { class: 'muted' }, 'Inapakia...'));
    let d;
    try { d = await HugoMed.api('/api/billing/visits/' + id); }
    catch (err) { root.textContent = ''; root.appendChild(h('p', { class: 'form-message error' }, err.message)); return; }
    const v = d.visit, b = d.bill, inv = b.invoice;
    const isCashier = ['cashier', 'hospital_admin', 'accountant'].includes(me.role);
    root.textContent = '';

    root.appendChild(h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn', onclick: showQueue }, '← Foleni ya malipo'),
      h('div', { class: 'row-actions' }, HugoMed.stageChip(v.stage))
    ));
    if (flashText) root.appendChild(h('p', { class: 'form-message ok' }, flashText));

    root.appendChild(h('section', { class: 'card patient-banner' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (v.first_name[0] || '') + (v.last_name[0] || '')),
      h('div', { style: 'flex: 1 1 auto' },
        h('div', { class: 'banner-name' }, HugoMed.patientName(v) + ' · ' + v.token),
        h('div', { class: 'muted small' }, ['MRN ' + v.mrn, 'Bili ' + inv.invoice_no, v.payer_name || 'Cash', v.member_number || v.employee_number, Number(v.copay_percent) ? 'co-pay ' + Number(v.copay_percent) + '%' : null].filter(Boolean).join(' · '))
      ),
      d.claim ? h('span', { class: 'chip teal' }, 'Dai ' + d.claim.claim_no) : null
    ));

    const grid = h('div', { class: 'opd-grid bill-grid' });
    root.appendChild(grid);
    const main = h('div', { class: 'stack' });
    const side = h('div', { class: 'stack' });
    grid.appendChild(main);
    grid.appendChild(side);

    // Mistari ya bili
    const insured = v.payer_type && v.payer_type !== 'cash';
    main.appendChild(h('section', { class: 'card flush' },
      h('h2', { class: 'pad', style: 'padding-bottom: 0' }, 'Bili'),
      b.items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Huduma'), h('th', {}, 'Idadi'), h('th', { class: 'num' }, 'Bei'), h('th', { class: 'num' }, 'Jumla'),
          insured ? h('th', { class: 'num' }, v.payer_name) : null, h('th', { class: 'num' }, 'Mgonjwa'))),
        h('tbody', {}, b.items.map((it) => h('tr', {},
          h('td', {}, it.description, insured && !it.covered ? h('div', {}, h('span', { class: 'chip amber' }, 'Hailipwi na ' + v.payer_name)) : null, it.payer_item_code ? h('div', { class: 'muted small' }, 'Code ' + it.payer_item_code) : null),
          h('td', {}, String(Number(it.quantity))),
          h('td', { class: 'num' }, Number(it.unit_price) ? HugoMed.money(it.unit_price) : h('span', { class: 'chip red' }, 'Bei haipo')),
          h('td', { class: 'num' }, HugoMed.money(it.amount)),
          insured ? h('td', { class: 'num' }, HugoMed.money(it.payer_amount)) : null,
          h('td', { class: 'num' }, h('strong', {}, HugoMed.money(it.patient_amount)))
        )))
      )) : h('p', { class: 'muted pad' }, 'Hakuna huduma kwenye bili bado.'),
      b.warnings.length ? h('div', { class: 'pad' }, b.warnings.map((w) => h('div', { class: 'finding' }, h('span', { class: 'chip amber' }, 'Angalia'), h('span', { class: 'small' }, w)))) : null
    ));

    // Malipo yaliyopokelewa
    main.appendChild(h('section', { class: 'card flush' },
      h('h2', { class: 'pad', style: 'padding-bottom: 0' }, 'Malipo yaliyopokelewa'),
      d.payments.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Risiti'), h('th', {}, 'Njia'), h('th', {}, 'Reference'), h('th', { class: 'num' }, 'Kiasi'), h('th', {}, 'Muda'), h('th', {}, ''))),
        h('tbody', {}, d.payments.map((pm) => h('tr', {},
          h('td', {}, pm.receipt_no || '—'), h('td', {}, METHODS[pm.method] || pm.method), h('td', { class: 'small' }, pm.reference || '—'),
          h('td', { class: 'num' }, HugoMed.money(pm.amount)), h('td', { class: 'small' }, HugoMed.dateTime(pm.received_at) + ' · ' + (pm.received_by_name || '')),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => printReceipt(pm.id) }, 'Risiti'))
        )))
      )) : h('p', { class: 'muted pad' }, 'Bado hakuna malipo.')
    ));

    // Muhtasari
    const row = (label, value, strong) => h('div', { class: 'sum-row' + (strong ? ' strong' : '') }, h('span', {}, label), h('span', {}, value));
    side.appendChild(h('section', { class: 'card' },
      h('h2', {}, 'Muhtasari'),
      row('Jumla ya bili', HugoMed.money(inv.total)),
      insured ? row('Inalipwa na ' + v.payer_name, HugoMed.money(inv.payer_amount)) : null,
      row('Sehemu ya mgonjwa', HugoMed.money(inv.patient_amount)),
      Number(inv.waiver_amount) ? row('Msamaha', '− ' + HugoMed.money(inv.waiver_amount)) : null,
      row('Amelipa', HugoMed.money(b.paid)),
      row(b.balance >= 0 ? 'Deni' : 'Arudishiwe', HugoMed.money(Math.abs(b.balance)), true),
      inv.waiver_reason ? h('p', { class: 'muted small' }, 'Msamaha: ' + inv.waiver_reason) : null
    ));

    // Kupokea malipo
    if (isCashier && b.balance > 0 && v.stage !== 'cancelled') {
      const msg = h('p', { class: 'form-message', role: 'alert' });
      const methodSel = h('select', { name: 'method' }, Object.entries(METHODS).map(([k, l]) => h('option', { value: k }, l)));
      const ref = h('input', { name: 'reference', placeholder: 'Namba ya muamala' });
      const refLabel = h('label', { hidden: true }, 'Reference', ref);
      methodSel.addEventListener('change', () => { refLabel.hidden = methodSel.value === 'cash'; });
      const form = h('form', { class: 'card stack', novalidate: true },
        h('h2', { style: 'margin: 0' }, 'Pokea malipo'),
        h('label', {}, 'Njia ya malipo', methodSel),
        h('label', {}, 'Kiasi (TSh)', h('input', { name: 'amount', inputmode: 'numeric', value: String(b.balance) })),
        refLabel, msg,
        h('button', { type: 'submit', class: 'btn primary block' }, 'Pokea malipo')
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = HugoMed.formData(form);
        try {
          const r = await HugoMed.api('/api/billing/visits/' + v.id + '/payments', { method: 'POST', body });
          printReceipt(r.payment.id);
          openVisit(v.id, r.message);
        } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
      });
      side.appendChild(form);
    }

    // Kurudisha fedha (baada ya dawa kukosekana n.k.)
    if (isCashier && b.balance < 0) {
      const msg = h('p', { class: 'form-message', role: 'alert' });
      side.appendChild(h('section', { class: 'card stack' },
        h('h2', { style: 'margin: 0' }, 'Rudisha fedha'),
        h('p', { class: 'small', style: 'margin: 0' }, 'Mgonjwa amelipa zaidi ya bili ya sasa kwa ' + HugoMed.money(-b.balance) + '.'),
        msg,
        h('button', {
          type: 'button', class: 'btn block',
          onclick: async () => {
            try {
              const r = await HugoMed.api('/api/billing/visits/' + v.id + '/payments', { method: 'POST', body: { method: 'cash', amount: b.balance } });
              openVisit(v.id, r.message);
            } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
          }
        }, 'Rudisha ' + HugoMed.money(-b.balance) + ' kwa cash')
      ));
    }

    // Msamaha
    if (canWaive && Number(inv.patient_amount) > 0 && !['completed', 'cancelled'].includes(v.stage)) {
      const msg = h('p', { class: 'form-message', role: 'alert' });
      const form = h('form', { class: 'stack', novalidate: true },
        h('label', {}, 'Kiasi cha msamaha (TSh)', h('input', { name: 'amount', inputmode: 'numeric', value: String(Number(inv.waiver_amount) || '') })),
        h('label', {}, 'Sababu', h('input', { name: 'reason', placeholder: 'Mf. mtoto chini ya miaka 5', value: inv.waiver_reason || '' })),
        msg,
        h('button', { type: 'submit', class: 'btn block' }, 'Weka msamaha')
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await HugoMed.api('/api/billing/visits/' + v.id + '/waiver', { method: 'POST', body: HugoMed.formData(form) });
          openVisit(v.id, r.message);
        } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
      });
      side.appendChild(h('section', { class: 'card' }, h('details', {}, h('summary', {}, 'Msamaha (Admin / Mhasibu)'), form)));
    }

    // Kufunga bili
    if (isCashier && v.stage === 'billing') {
      const msg = h('p', { class: 'form-message', role: 'alert' });
      const btn = h('button', { type: 'button', class: 'btn primary block', disabled: b.balance > 0 }, 'Funga bili na endelea →');
      async function finalize(confirmMissing) {
        try {
          const r = await HugoMed.api('/api/billing/visits/' + v.id + '/finalize', { method: 'POST', body: { confirm_missing_prices: confirmMissing } });
          showQueue().then(() => root.insertBefore(h('p', { class: 'form-message ok' }, v.token + ': ' + r.message), root.children[1] || null));
        } catch (err) {
          if (err.data && err.data.code === 'missing_prices' && window.confirm(err.message + '\n\nEndelea hivyo hivyo?')) return finalize(true);
          HugoMed.showMessage(msg, err.message, 'error');
        }
      }
      btn.addEventListener('click', () => finalize(false));
      side.appendChild(h('section', { class: 'card stack' },
        h('p', { class: 'small muted', style: 'margin: 0' }, b.balance > 0 ? 'Pokea malipo kwanza.' : 'Mgonjwa ataenda pharmacy kama ana dawa, au ziara itakamilika.'),
        msg, btn
      ));
    }
  }

  // ---------- Risiti ----------
  async function printReceipt(paymentId) {
    let r;
    try { r = await HugoMed.api('/api/billing/payments/' + paymentId + '/receipt'); }
    catch (err) { window.alert(err.message); return; }
    const x = r.receipt;
    const slip = document.getElementById('print-slip') || document.body.appendChild(h('div', { id: 'print-slip' }));
    slip.textContent = '';
    slip.appendChild(h('div', { class: 'slip-hosp' }, x.tenant_name));
    if (x.tenant_address || x.tenant_phone) slip.appendChild(h('div', { class: 'slip-note' }, [x.tenant_address, x.tenant_phone].filter(Boolean).join(' · ')));
    slip.appendChild(h('div', { class: 'slip-line' }, 'RISITI ' + x.receipt_no));
    slip.appendChild(h('div', {}, HugoMed.dateTime(x.received_at)));
    slip.appendChild(h('div', {}, HugoMed.patientName(x) + ' · MRN ' + x.mrn));
    slip.appendChild(h('div', {}, 'Bili ' + x.invoice_no + ' · ' + (x.payer_name || 'Cash')));
    slip.appendChild(h('table', { class: 'slip-table' }, r.items.map((it) => h('tr', {},
      h('td', {}, it.description + ' ×' + Number(it.quantity)), h('td', {}, Number(it.patient_amount).toLocaleString('en-US'))
    ))));
    slip.appendChild(h('div', { class: 'slip-line' }, 'Sehemu ya mgonjwa: ' + HugoMed.money(x.patient_amount)));
    if (Number(x.waiver_amount)) slip.appendChild(h('div', {}, 'Msamaha: ' + HugoMed.money(x.waiver_amount)));
    slip.appendChild(h('div', { class: 'slip-line' }, (Number(x.amount) < 0 ? 'Imerudishwa: ' : 'Amelipa: ') + HugoMed.money(Math.abs(x.amount)) + ' (' + (METHODS[x.method] || x.method) + (x.reference ? ' ' + x.reference : '') + ')'));
    slip.appendChild(h('div', {}, 'Jumla aliyolipa: ' + HugoMed.money(r.total_paid)));
    slip.appendChild(h('div', { class: 'slip-note' }, 'Cashier: ' + (x.cashier_name || '') + ' · Asante'));
    window.print();
  }

  showQueue();
};
