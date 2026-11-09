// =============================================================
// HugoMed - Fedha: muhtasari, matumizi, wanaodaiwa (ageing), zamu za cashier
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.finance = function (page, me) {
  const h = HugoMed.h;
  const isAdmin = me.role === 'hospital_admin';
  const METHODS = { cash: 'Cash', mpesa: 'M-Pesa', airtel_money: 'Airtel Money', tigo_pesa: 'Tigo Pesa', halopesa: 'HaloPesa', selcom: 'Selcom', azampay: 'AzamPay', bank: 'Benki', card: 'Kadi', other: 'Nyingine' };
  const today = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let tab = 'summary';

  page.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Fedha'), h('p', { class: 'muted' }, 'Mapato, matumizi, wanaodaiwa na zamu za cashier'))));
  const from = h('input', { type: 'date', value: iso(new Date(today.getFullYear(), today.getMonth(), 1)), 'aria-label': 'Kuanzia' });
  const to = h('input', { type: 'date', value: iso(today), 'aria-label': 'Hadi' });
  const period = h('div', { class: 'card order-row', style: 'margin-bottom: 16px' },
    h('label', {}, 'Kuanzia', from), h('label', {}, 'Hadi', to), h('button', { type: 'button', class: 'btn primary', onclick: () => load() }, 'Onyesha'));
  page.appendChild(period);
  const tabs = h('div', { class: 'stage-tabs' });
  page.appendChild(tabs);
  const msg = h('p', { class: 'form-message', role: 'status' });
  page.appendChild(msg);
  const box = h('div', { class: 'stack' });
  page.appendChild(box);

  function renderTabs() {
    tabs.textContent = '';
    [['summary', 'Muhtasari'], ['expenses', 'Matumizi'], ['receivables', 'Wanaodaiwa'], ['shifts', 'Zamu za cashier']].forEach(([k, l]) =>
      tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (tab === k ? ' on' : ''), onclick: () => { tab = k; renderTabs(); load(); } }, l)));
    period.hidden = ['receivables', 'shifts'].includes(tab);
  }
  const q = () => '?from=' + from.value + '&to=' + to.value;
  const row = (label, value, strong) => h('div', { class: 'sum-row' + (strong ? ' strong' : '') }, h('span', {}, label), h('span', {}, value));

  async function load() {
    box.textContent = '';
    HugoMed.showMessage(msg, '');
    try {
      if (tab === 'summary') {
        const r = await HugoMed.api('/api/finance/summary' + q());
        box.appendChild(h('div', { class: 'stat-grid' },
          h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, 'Mapato yote'), h('div', { class: 'stat-value' }, HugoMed.money(r.income.total))),
          h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, 'Matumizi yaliyoidhinishwa'), h('div', { class: 'stat-value' }, HugoMed.money(r.expenses.total))),
          h('div', { class: 'card stat border-' + (r.net >= 0 ? 'green' : 'red') }, h('div', { class: 'muted small' }, 'Baki (net)'), h('div', { class: 'stat-value' }, HugoMed.money(r.net)))
        ));
        box.appendChild(h('div', { class: 'two-col' },
          h('section', { class: 'card' }, h('h2', {}, 'Mapato'),
            row('Malipo ya wagonjwa', HugoMed.money(r.income.patients)),
            r.income.by_method.map((m) => row('· ' + (METHODS[m.method] || m.method), HugoMed.money(m.total))),
            row('Madai yaliyolipwa', HugoMed.money(r.income.claims)),
            r.income.by_payer.map((m) => row('· ' + m.name, HugoMed.money(m.total))),
            row('Jumla', HugoMed.money(r.income.total), true)),
          h('section', { class: 'card' }, h('h2', {}, 'Matumizi'),
            r.expenses.by_category.length ? r.expenses.by_category.map((c) => row(c.category, HugoMed.money(c.total))) : h('p', { class: 'muted' }, 'Hakuna matumizi yaliyoidhinishwa.'),
            row('Jumla', HugoMed.money(r.expenses.total), true),
            h('p', { class: 'muted small' }, 'Bili zilizotolewa kwenye kipindi: ' + HugoMed.money(r.billed.total) + ' (za walipaji ' + HugoMed.money(r.billed.payer) + ', misamaha ' + HugoMed.money(r.billed.waivers) + ').'))
        ));
      } else if (tab === 'expenses') {
        const r = await HugoMed.api('/api/finance/expenses' + q());
        const form = h('form', { class: 'card', novalidate: true },
          h('h2', {}, 'Andika matumizi'),
          h('div', { class: 'form-grid' },
            h('label', {}, 'Tarehe', h('input', { type: 'date', name: 'expense_date', value: iso(today) })),
            h('label', {}, 'Aina', h('select', { name: 'category' }, r.categories.map((c) => h('option', { value: c }, c)))),
            h('label', {}, 'Maelezo', h('input', { name: 'description' })),
            h('label', {}, 'Kiasi (TSh)', h('input', { name: 'amount', inputmode: 'numeric' })),
            h('label', {}, 'Amelipwa nani', h('input', { name: 'paid_to' })),
            h('label', {}, 'Reference', h('input', { name: 'reference' }))
          ),
          h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi'))
        );
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          try { const x = await HugoMed.api('/api/finance/expenses', { method: 'POST', body: HugoMed.formData(form) }); load().then(() => HugoMed.showMessage(msg, x.message, 'ok')); }
          catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
        });
        box.appendChild(form);
        const decide = async (id, status) => {
          try { const x = await HugoMed.api('/api/finance/expenses/' + id, { method: 'PATCH', body: { status } }); load().then(() => HugoMed.showMessage(msg, x.message, 'ok')); }
          catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
        };
        const ST = { pending: ['amber', 'Inasubiri idhini'], approved: ['green', 'Imeidhinishwa'], rejected: ['grey', 'Imekataliwa'] };
        box.appendChild(h('section', { class: 'card flush' }, r.items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Tarehe'), h('th', {}, 'Aina'), h('th', {}, 'Maelezo'), h('th', { class: 'num' }, 'Kiasi'), h('th', {}, 'Hali'), h('th', {}, ''))),
          h('tbody', {}, r.items.map((x) => h('tr', {},
            h('td', { class: 'small' }, HugoMed.date(x.expense_date)), h('td', {}, x.category),
            h('td', {}, x.description, h('div', { class: 'muted small' }, [x.paid_to, x.reference, 'na ' + (x.created_by_name || '')].filter(Boolean).join(' · '))),
            h('td', { class: 'num' }, HugoMed.money(x.amount)),
            h('td', {}, h('span', { class: 'chip ' + ST[x.status][0] }, ST[x.status][1])),
            h('td', { class: 'row-actions' }, isAdmin && x.status === 'pending' ? [
              h('button', { type: 'button', class: 'btn small primary', onclick: () => decide(x.id, 'approved') }, 'Idhinisha'),
              h('button', { type: 'button', class: 'btn small danger', onclick: () => decide(x.id, 'rejected') }, 'Kataa')] : null)
          )))
        )) : h('p', { class: 'muted pad' }, 'Hakuna matumizi kwenye kipindi hiki.')));
      } else if (tab === 'receivables') {
        const r = await HugoMed.api('/api/finance/receivables');
        const statement = async (p) => {
          const res = await fetch('/api/finance/statement/' + p.payer_id + '?from=2000-01-01&to=' + iso(today) + '&format=csv', { headers: { Authorization: 'Bearer ' + HugoMed.getToken() } });
          const a = h('a', { href: URL.createObjectURL(await res.blob()), download: 'statement-' + p.name + '.csv' });
          document.body.appendChild(a); a.click(); a.remove();
        };
        box.appendChild(h('section', { class: 'card flush' }, r.items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Mlipaji'), h('th', {}, 'Madai'), h('th', { class: 'num' }, 'Siku 0-30'), h('th', { class: 'num' }, '31-60'), h('th', { class: 'num' }, '61-90'), h('th', { class: 'num' }, '90+'), h('th', { class: 'num' }, 'Jumla'), h('th', {}, ''))),
          h('tbody', {}, r.items.map((p) => h('tr', {},
            h('td', {}, h('strong', {}, p.name), h('div', { class: 'muted small' }, HugoMed.PAYER_TYPES[p.type] + (p.credit_limit ? ' · kikomo ' + HugoMed.money(p.credit_limit) : '')), p.over_limit ? h('span', { class: 'chip red' }, 'Imevuka kikomo') : null),
            h('td', {}, String(p.claims)),
            ['d0_30', 'd31_60', 'd61_90', 'd90_plus'].map((k) => h('td', { class: 'num' + (k === 'd90_plus' && Number(p[k]) > 0 ? ' danger-text' : '') }, Number(p[k]) ? HugoMed.money(p[k]) : '—')),
            h('td', { class: 'num' }, h('strong', {}, HugoMed.money(p.outstanding))),
            h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => statement(p) }, 'Statement CSV'))
          )))
        )) : h('p', { class: 'muted pad' }, 'Hakuna deni la bima wala kampuni.')));
        box.appendChild(h('p', { class: 'muted small' }, 'Deni linahesabiwa kutoka kwenye madai ambayo hayajalipwa kikamilifu wala kukataliwa.'));
      } else {
        const r = await HugoMed.api('/api/finance/shifts');
        box.appendChild(h('section', { class: 'card flush' }, r.items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Cashier'), h('th', {}, 'Ilifunguliwa'), h('th', {}, 'Ilifungwa'), h('th', { class: 'num' }, 'Malipo'), h('th', { class: 'num' }, 'Cash inayotarajiwa'), h('th', { class: 'num' }, 'Cash iliyohesabiwa'), h('th', { class: 'num' }, 'Tofauti'))),
          h('tbody', {}, r.items.map((s) => {
            const diff = s.closed_at ? Math.round(Number(s.counted_cash) - Number(s.expected_cash)) : null;
            return h('tr', {},
              h('td', {}, s.cashier_name), h('td', { class: 'small' }, HugoMed.dateTime(s.opened_at)),
              h('td', { class: 'small' }, s.closed_at ? HugoMed.dateTime(s.closed_at) : h('span', { class: 'chip amber' }, 'Iko wazi')),
              h('td', { class: 'num' }, HugoMed.money(s.collected) + ' (' + s.payments + ')'),
              h('td', { class: 'num' }, s.closed_at ? HugoMed.money(s.expected_cash) : '—'),
              h('td', { class: 'num' }, s.closed_at ? HugoMed.money(s.counted_cash) : '—'),
              h('td', { class: 'num' }, diff === null ? '—' : h('span', { class: 'chip ' + (diff === 0 ? 'green' : 'red') }, (diff > 0 ? '+' : '') + diff.toLocaleString('en-US')))
            );
          }))
        )) : h('p', { class: 'muted pad' }, 'Hakuna zamu bado.')));
      }
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  renderTabs();
  load();
};
