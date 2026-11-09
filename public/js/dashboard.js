// =============================================================
// HugoMed - Dashboard ya uongozi
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.dashboard = function (page) {
  const h = HugoMed.h;
  const METHODS = { cash: 'Cash', mpesa: 'M-Pesa', airtel_money: 'Airtel Money', tigo_pesa: 'Tigo Pesa', halopesa: 'HaloPesa', selcom: 'Selcom', azampay: 'AzamPay', bank: 'Benki', card: 'Kadi', other: 'Nyingine' };
  const CATS = { consultation: 'Ushauri', lab: 'Maabara', radiology: 'Radiology', drug: 'Dawa', procedure: 'Huduma', bed: 'Vitanda', other: 'Nyingine' };
  const CLAIM = { has_errors: 'Makosa', needs_info: 'Tahadhari', ready: 'Tayari', draft: 'Rasimu', submitted: 'Yametumwa', paid: 'Yamelipwa', partially_paid: 'Sehemu', rejected: 'Yamekataliwa' };

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Dashboard'), h('p', { class: 'muted' }, 'Takwimu za leo na za mwezi huu')),
    h('a', { class: 'btn', href: '#/reports' }, 'Ripoti kamili')
  ));
  const box = h('div', { class: 'stack' });
  page.appendChild(box);

  function bars(rows, labelFn, valueFn, fmt) {
    const max = Math.max(1, ...rows.map(valueFn));
    return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, labelFn(r)),
      h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: 'width:' + Math.round((valueFn(r) / max) * 100) + '%' })),
      h('span', { class: 'bar-value' }, fmt(valueFn(r)))
    )));
  }

  HugoMed.api('/api/reports/dashboard').then((d) => {
    const stat = (label, value, sub, href, tone) => h(href ? 'a' : 'div', { class: 'card stat' + (tone ? ' border-' + tone : ''), href: href || null },
      h('div', { class: 'muted small' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'muted small' }, sub) : null);

    const claimsBy = {};
    d.claims.forEach((c) => { claimsBy[c.status] = c; });
    const pending = ['has_errors', 'needs_info', 'ready', 'submitted', 'partially_paid'].reduce((a, k) => a + Number((claimsBy[k] || {}).amount || 0), 0);
    const fixes = (claimsBy.has_errors || { n: 0 }).n + (claimsBy.needs_info || { n: 0 }).n;

    box.appendChild(h('div', { class: 'stat-grid' },
      stat('Wagonjwa leo / mwezi', d.visits.today + ' / ' + d.visits.month, d.visits.inside + ' walio ndani sasa', '#/queue'),
      stat('Mapato leo', HugoMed.money(d.revenue.today), 'Mwezi: ' + HugoMed.money(d.revenue.month), '#/finance'),
      stat('Madai yanayosubiri', HugoMed.money(pending), fixes + ' yanahitaji kurekebishwa', '#/claims', fixes ? 'red' : null),
      stat('Wanaosubiri > dk 30', String(d.long_waits), 'Kwenye hatua yoyote', '#/queue', d.long_waits ? 'amber' : null),
      stat('Stock ya dawa', d.stock.out + ' zimeisha', d.stock.low + ' ziko chini ya kiwango · ' + d.stock.expiring + ' batch zinaisha < siku 90', '#/stock', d.stock.out ? 'red' : d.stock.low ? 'amber' : null),
      stat('Vitanda', d.beds.total ? d.beds.used + ' / ' + d.beds.total : '—', d.beds.total ? 'Occupancy ' + Math.round((d.beds.used / d.beds.total) * 100) + '%' : 'Hakuna wodi', '#/ipd')
    ));

    const grid = h('div', { class: 'two-col' });
    box.appendChild(grid);
    grid.appendChild(h('section', { class: 'card' }, h('h2', {}, 'Magonjwa yanayoongoza (mwezi huu)'),
      d.top_diagnoses.length ? bars(d.top_diagnoses, (r) => r.icd10_code + ' ' + (r.description || ''), (r) => r.n, String) : h('p', { class: 'muted' }, 'Bado hakuna diagnosis.')));
    grid.appendChild(h('section', { class: 'card' }, h('h2', {}, 'Bili kwa aina ya huduma (mwezi huu)'),
      d.revenue_by_category.length ? bars(d.revenue_by_category, (r) => CATS[r.category] || r.category, (r) => Number(r.total), HugoMed.money) : h('p', { class: 'muted' }, 'Bado hakuna bili.')));
    grid.appendChild(h('section', { class: 'card' }, h('h2', {}, 'Malipo kwa njia (mwezi huu)'),
      d.methods.length ? bars(d.methods, (r) => METHODS[r.method] || r.method, (r) => Number(r.total), HugoMed.money) : h('p', { class: 'muted' }, 'Bado hakuna malipo.')));
    grid.appendChild(h('section', { class: 'card' }, h('h2', {}, 'Madai kwa hali'),
      d.claims.length ? bars(d.claims, (r) => CLAIM[r.status] || r.status + ' (' + r.n + ')', (r) => Number(r.amount), HugoMed.money) : h('p', { class: 'muted' }, 'Bado hakuna madai.')));
  }).catch((err) => box.appendChild(h('p', { class: 'form-message error' }, err.message)));
};
