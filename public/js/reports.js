// =============================================================
// HugoMed - Ripoti: magonjwa (kwa jinsia na umri), mapato, ziara. Export CSV.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.reports = function (page) {
  const h = HugoMed.h;
  const METHODS = { cash: 'Cash', mpesa: 'M-Pesa', airtel_money: 'Airtel Money', tigo_pesa: 'Tigo Pesa', halopesa: 'HaloPesa', selcom: 'Selcom', azampay: 'AzamPay', bank: 'Benki', card: 'Kadi', other: 'Nyingine' };
  const today = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let report = 'diagnoses';

  page.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Ripoti'), h('p', { class: 'muted' }, 'Chagua kipindi, kisha angalia au pakua CSV'))));
  const from = h('input', { type: 'date', value: iso(new Date(today.getFullYear(), today.getMonth(), 1)), 'aria-label': 'Kuanzia' });
  const to = h('input', { type: 'date', value: iso(today), 'aria-label': 'Hadi' });
  const tabs = h('div', { class: 'stage-tabs' });
  page.appendChild(h('div', { class: 'card order-row', style: 'margin-bottom: 16px' },
    h('label', {}, 'Kuanzia', from), h('label', {}, 'Hadi', to),
    h('button', { type: 'button', class: 'btn primary', onclick: () => load() }, 'Onyesha'),
    h('button', { type: 'button', class: 'btn', onclick: () => download() }, 'Pakua CSV')
  ));
  page.appendChild(tabs);
  const box = h('section', { class: 'card flush' });
  page.appendChild(box);

  function renderTabs() {
    tabs.textContent = '';
    [['diagnoses', 'Magonjwa (ICD-10)'], ['revenue', 'Mapato'], ['visits', 'Ziara na muda']].forEach(([k, l]) =>
      tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (report === k ? ' on' : ''), onclick: () => { report = k; renderTabs(); load(); } }, l)));
  }

  function q() { return '?from=' + from.value + '&to=' + to.value; }

  async function download() {
    try {
      const res = await fetch('/api/reports/' + report + q() + '&format=csv', { headers: { Authorization: 'Bearer ' + HugoMed.getToken() } });
      if (!res.ok) throw new Error('Kupakua kumeshindwa.');
      const a = h('a', { href: URL.createObjectURL(await res.blob()), download: report + '-' + from.value + '-' + to.value + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { window.alert(err.message); }
  }

  const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
    h('thead', {}, h('tr', {}, head.map((x) => h('th', { class: x.num ? 'num' : null }, x.t || x)))),
    h('tbody', {}, rows)));

  async function load() {
    box.textContent = '';
    box.appendChild(h('p', { class: 'muted pad' }, 'Inapakia...'));
    try {
      const r = await HugoMed.api('/api/reports/' + report + q());
      box.textContent = '';
      if (!r.items.length) { box.appendChild(h('p', { class: 'muted pad' }, 'Hakuna data kwenye kipindi hiki.')); return; }
      if (report === 'diagnoses') {
        const sum = (k) => r.items.reduce((a, x) => a + x[k], 0);
        box.appendChild(table(['ICD-10', 'Ugonjwa', { t: 'Me < 5', num: 1 }, { t: 'Ke < 5', num: 1 }, { t: 'Me 5+', num: 1 }, { t: 'Ke 5+', num: 1 }, { t: 'Jumla', num: 1 }],
          r.items.map((x) => h('tr', {}, h('td', {}, h('strong', {}, x.icd10_code)), h('td', {}, x.description || ''),
            [x.m_under5, x.f_under5, x.m_5plus, x.f_5plus].map((n) => h('td', { class: 'num' }, String(n))), h('td', { class: 'num' }, h('strong', {}, String(x.total)))))
            .concat([h('tr', { class: 'total-row' }, h('td', {}, 'Jumla'), h('td', {}), ['m_under5', 'f_under5', 'm_5plus', 'f_5plus', 'total'].map((k) => h('td', { class: 'num' }, String(sum(k)))))])));
        box.appendChild(h('p', { class: 'muted small pad' }, 'Mpangilio huu (jinsia na umri chini ya 5 / 5+) unasaidia kujaza ripoti za MTUHA na DHIS2. Wagonjwa wasio na tarehe ya kuzaliwa wamehesabiwa 5+.'));
      } else if (report === 'revenue') {
        const days = {};
        r.items.forEach((x) => { const d = String(x.day).slice(0, 10); (days[d] = days[d] || {})[x.method] = Number(x.total); });
        const methods = [...new Set(r.items.map((x) => x.method))];
        const total = r.items.reduce((a, x) => a + Number(x.total), 0);
        box.appendChild(table(['Tarehe'].concat(methods.map((m) => ({ t: METHODS[m] || m, num: 1 })), [{ t: 'Jumla', num: 1 }]),
          Object.entries(days).map(([d, m]) => h('tr', {}, h('td', {}, HugoMed.date(d)),
            methods.map((x) => h('td', { class: 'num' }, m[x] ? HugoMed.money(m[x]) : '—')),
            h('td', { class: 'num' }, h('strong', {}, HugoMed.money(Object.values(m).reduce((a, b) => a + b, 0))))))));
        box.appendChild(h('p', { class: 'pad', style: 'margin: 0' }, h('strong', {}, 'Malipo ya wagonjwa: ' + HugoMed.money(total)), ' · Madai yaliyolipwa kwenye kipindi: ' + HugoMed.money(r.claims_paid)));
      } else {
        box.appendChild(table(['Tarehe', { t: 'Ziara', num: 1 }, { t: 'Zimekamilika', num: 1 }, { t: 'Zimesitishwa', num: 1 }, { t: 'Wastani (dk) kufika hadi kumaliza', num: 1 }],
          r.items.map((x) => h('tr', {}, h('td', {}, HugoMed.date(x.day)), h('td', { class: 'num' }, String(x.visits)), h('td', { class: 'num' }, String(x.completed)),
            h('td', { class: 'num' }, String(x.cancelled)), h('td', { class: 'num' }, x.avg_minutes === null ? '—' : String(x.avg_minutes))))));
      }
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  renderTabs();
  load();
};
