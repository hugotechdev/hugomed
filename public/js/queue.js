// =============================================================
// HugoMed - Foleni ya leo: kila mgonjwa yuko hatua gani, amesubiri muda gani
// Inajisasisha kila sekunde 30.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.queue = function (page, me) {
  const h = HugoMed.h;
  let filter = '';

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Foleni ya leo'), h('p', { class: 'muted' }, 'Wagonjwa wa leo na walio bado ndani, kwa kila hatua')),
    h('button', { type: 'button', class: 'btn', onclick: () => load() }, 'Onyesha upya')
  ));

  const tabs = h('div', { class: 'stage-tabs', role: 'tablist', 'aria-label': 'Chuja kwa hatua' });
  page.appendChild(tabs);
  const box = h('section', { class: 'card flush' });
  page.appendChild(box);

  const ORDER = ['triage', 'doctor', 'lab', 'results', 'admitted', 'billing', 'pharmacy', 'completed', 'cancelled'];

  function renderTabs(counts) {
    tabs.textContent = '';
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const mk = (key, label, n) => h('button', {
      type: 'button', role: 'tab', class: 'stage-tab' + (filter === key ? ' on' : ''), 'aria-selected': filter === key ? 'true' : 'false',
      onclick: () => { filter = key; load(); }
    }, label, h('span', { class: 'count' }, String(n || 0)));
    tabs.appendChild(mk('', 'Wote', total));
    ORDER.forEach((s) => tabs.appendChild(mk(s, HugoMed.STAGES[s][1], counts[s])));
  }

  function nextPage(v) {
    if (v.stage === 'triage' && ['nurse', 'doctor', 'hospital_admin'].includes(me.role)) return '#/triage';
    if (['doctor', 'results'].includes(v.stage) && ['doctor', 'hospital_admin', 'nurse'].includes(me.role)) return '#/doctor?visit=' + v.id;
    if (v.stage === 'lab' && ['lab_technician', 'hospital_admin', 'doctor'].includes(me.role)) return '#/lab';
    if (v.stage === 'billing' && ['cashier', 'hospital_admin', 'accountant', 'receptionist'].includes(me.role)) return '#/cashier';
    if (v.stage === 'pharmacy' && ['pharmacist', 'hospital_admin', 'nurse'].includes(me.role)) return '#/pharmacy';
    if (v.stage === 'admitted' && ['doctor', 'hospital_admin', 'nurse'].includes(me.role)) return '#/ipd';
    return null;
  }

  async function load() {
    try {
      const res = await HugoMed.api('/api/visits' + (filter ? '?stage=' + filter : ''));
      renderTabs(res.counts);
      box.textContent = '';
      if (!res.items.length) {
        box.appendChild(h('p', { class: 'muted pad' }, 'Hakuna mgonjwa kwenye hatua hii.'));
        return;
      }
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Token'), h('th', {}, 'Mgonjwa'), h('th', {}, 'Idara'), h('th', {}, 'Mlipaji'),
          h('th', {}, 'Hatua'), h('th', {}, 'Muda kwenye hatua'), h('th', {}, 'Alifika')
        )),
        h('tbody', {}, res.items.map((v) => {
          const link = nextPage(v);
          const done = ['completed', 'cancelled'].includes(v.stage);
          return h('tr', {},
            h('td', { class: 'nowrap' }, h('strong', {}, v.token), ' ', HugoMed.priorityChip(v.priority)),
            h('td', {}, link ? h('a', { href: link }, HugoMed.patientName(v)) : HugoMed.patientName(v),
              h('div', { class: 'muted small' }, 'MRN ' + v.mrn + (v.doctor_name ? ' · ' + v.doctor_name : ''))),
            h('td', {}, v.department || '—'),
            h('td', {}, v.payer_name || 'Cash'),
            h('td', {}, HugoMed.stageChip(v.stage)),
            h('td', {}, done ? h('span', { class: 'muted small' }, '—') : HugoMed.waitChip(v.waiting_minutes)),
            h('td', { class: 'small nowrap' }, HugoMed.dateTime(v.arrived_at))
          );
        }))
      )));
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  load();
  const timer = setInterval(() => {
    if (!document.body.contains(box)) { clearInterval(timer); return; }
    load();
  }, 30000);
};
