// =============================================================
// HugoMed - Madai ya NHIF, bima na kampuni
// Pre-Audit: nyekundu (makosa), njano (tahadhari), kijani (tayari)
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.claims = function (page) {
  const h = HugoMed.h;
  const STATUS = {
    has_errors: ['red', 'Makosa'],
    needs_info: ['amber', 'Tahadhari'],
    ready: ['green', 'Tayari'],
    draft: ['grey', 'Rasimu'],
    submitted: ['teal', 'Limetumwa'],
    paid: ['green', 'Limelipwa'],
    partially_paid: ['amber', 'Sehemu'],
    rejected: ['red', 'Limekataliwa']
  };
  const ORDER = ['has_errors', 'needs_info', 'ready', 'submitted', 'partially_paid', 'paid', 'rejected'];
  let filter = '';
  let payerId = '';
  const root = h('div');
  page.appendChild(root);

  async function showList(flashText, flashType) {
    root.textContent = '';
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Madai ya bima'), h('p', { class: 'muted' }, 'Kila dai linakaguliwa kabla ya kutumwa. Madai yenye makosa hayatumwi bila sababu.')),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn', onclick: showRejections }, 'Uchambuzi wa kukataliwa'),
        h('button', { type: 'button', class: 'btn', onclick: exportCsv }, 'Export CSV')
      )
    ));
    const flash = h('p', { class: 'form-message' + (flashText ? ' ' + (flashType || 'ok') : ''), role: 'status' }, flashText || '');
    root.appendChild(flash);

    let payers = [];
    try { payers = (await HugoMed.api('/api/payers')).items.filter((p) => p.type !== 'cash'); } catch (e) { /* hakuna */ }
    const payerSel = h('select', { 'aria-label': 'Mlipaji', class: 'compact' }, h('option', { value: '' }, 'Walipaji wote'), payers.map((p) => h('option', { value: p.id, selected: String(p.id) === String(payerId) }, p.name)));
    payerSel.addEventListener('change', () => { payerId = payerSel.value; showList(); });

    const q = new URLSearchParams();
    if (filter) q.set('status', filter);
    if (payerId) q.set('payer_id', payerId);
    let r;
    try { r = await HugoMed.api('/api/claims?' + q.toString()); }
    catch (err) { root.appendChild(h('p', { class: 'form-message error' }, err.message)); return; }

    // Muhtasari kwa hali
    const counts = {};
    r.counts.forEach((c) => { counts[c.status] = c; });
    const stats = h('div', { class: 'stat-grid' });
    [['ready', 'Tayari kutumwa'], ['needs_info', 'Tahadhari'], ['has_errors', 'Makosa'], ['submitted', 'Yametumwa (yanasubiri)'], ['rejected', 'Yamekataliwa']].forEach(([k, l]) => {
      const c = counts[k] || { n: 0, amount: 0 };
      stats.appendChild(h('button', { type: 'button', class: 'card stat stat-btn border-' + STATUS[k][0], onclick: () => { filter = k; showList(); } },
        h('div', { class: 'muted small' }, l), h('div', { class: 'stat-value' }, String(c.n)), h('div', { class: 'muted small' }, HugoMed.money(c.amount))));
    });
    root.appendChild(stats);

    const tabs = h('div', { class: 'stage-tabs', style: 'margin-top: 16px' }, payerSel);
    const total = r.counts.reduce((a, c) => a + c.n, 0);
    tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (!filter ? ' on' : ''), onclick: () => { filter = ''; showList(); } }, 'Yote', h('span', { class: 'count' }, String(total))));
    ORDER.forEach((k) => tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (filter === k ? ' on' : ''), onclick: () => { filter = k; showList(); } },
      STATUS[k][1], h('span', { class: 'count' }, String((counts[k] || { n: 0 }).n)))));
    root.appendChild(tabs);

    const box = h('section', { class: 'card flush' });
    root.appendChild(box);
    if (!r.items.length) { box.appendChild(h('p', { class: 'muted pad' }, 'Hakuna madai hapa.')); return; }

    const checks = [];
    box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Dai'), h('th', {}, 'Mgonjwa'), h('th', {}, 'Mlipaji'), h('th', {}, 'Tarehe'), h('th', { class: 'num' }, 'Kiasi'), h('th', {}, 'Readiness'), h('th', {}, 'Hali'), h('th', {}, ''))),
      h('tbody', {}, r.items.map((c) => {
        const st = STATUS[c.status] || ['grey', c.status];
        const cb = ['ready', 'needs_info', 'has_errors'].includes(c.status) ? h('input', { type: 'checkbox', 'aria-label': 'Chagua ' + c.claim_no, checked: c.status === 'ready' }) : null;
        if (cb) checks.push({ cb, c });
        const color = c.readiness_score >= 100 ? '#16A34A' : c.error_count ? '#DC2626' : '#D97706';
        return h('tr', {},
          h('td', {}, cb),
          h('td', { class: 'nowrap' }, h('strong', {}, c.claim_no)),
          h('td', {}, HugoMed.patientName(c), h('div', { class: 'muted small' }, (c.member_number || c.employee_number || '') + ' · ' + (c.icd10_codes || 'hakuna ICD-10'))),
          h('td', {}, c.payer_name),
          h('td', { class: 'small nowrap' }, HugoMed.date(c.arrived_at)),
          h('td', { class: 'num' }, HugoMed.money(c.claimed_amount), c.paid_amount !== null && c.paid_amount !== undefined ? h('div', { class: 'muted small' }, 'Limelipwa ' + HugoMed.money(c.paid_amount)) : null),
          h('td', { class: 'nowrap' }, h('span', { class: 'bar' }, h('span', { style: 'display:block;height:100%;width:' + c.readiness_score + '%;background:' + color })), c.readiness_score + '%'),
          h('td', {}, h('span', { class: 'chip ' + st[0] }, st[1] + (c.error_count ? ' ' + c.error_count : c.warning_count && c.status === 'needs_info' ? ' ' + c.warning_count : ''))),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => openClaim(c.id) }, 'Fungua'))
        );
      }))
    )));

    if (checks.length) {
      const submit = h('button', { type: 'button', class: 'btn primary' }, 'Weka yaliyochaguliwa "Yametumwa"');
      submit.addEventListener('click', async () => {
        const chosen = checks.filter((x) => x.cb.checked);
        if (!chosen.length) { HugoMed.showMessage(flash, 'Chagua madai kwanza.', 'error'); return; }
        let reason = '';
        if (chosen.some((x) => x.c.status !== 'ready')) {
          reason = window.prompt('Baadhi ya madai yana makosa au tahadhari. Andika sababu ya kuyatuma hivyo (au ghairi):') || '';
          if (!reason) return;
        }
        try {
          const res = await HugoMed.api('/api/claims/submit', { method: 'POST', body: { ids: chosen.map((x) => x.c.id), override_reason: reason } });
          showList(res.message, 'ok');
        } catch (err) { HugoMed.showMessage(flash, err.message, 'error'); }
      });
      box.appendChild(h('div', { class: 'pad row-actions' },
        h('span', { class: 'muted small', style: 'margin-right: auto' }, 'Pakia madai kwenye portal ya mlipaji (au tumia Export CSV), kisha yaweke "Yametumwa".'),
        submit));
    }
  }

  async function exportCsv() {
    const q = new URLSearchParams();
    if (filter) q.set('status', filter);
    if (payerId) q.set('payer_id', payerId);
    try {
      const res = await fetch('/api/claims/export.csv?' + q.toString(), { headers: { Authorization: 'Bearer ' + HugoMed.getToken() } });
      if (!res.ok) throw new Error('Export imeshindwa.');
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: 'madai-' + new Date().toISOString().slice(0, 10) + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { window.alert(err.message); }
  }

  async function showRejections() {
    root.textContent = '';
    root.appendChild(h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn', onclick: () => showList() }, '← Madai'),
      h('h1', { style: 'margin: 0' }, 'Uchambuzi wa madai yaliyokataliwa')
    ));
    try {
      const r = await HugoMed.api('/api/claims/rejections');
      const box = h('section', { class: 'card flush' });
      root.appendChild(box);
      if (!r.items.length) { box.appendChild(h('p', { class: 'muted pad' }, 'Bado hakuna dai lililokataliwa.')); return; }
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Sababu'), h('th', {}, 'Mlipaji'), h('th', {}, 'Idadi'), h('th', { class: 'num' }, 'Thamani'))),
        h('tbody', {}, r.items.map((x) => h('tr', {}, h('td', {}, x.reason), h('td', {}, x.payer_name), h('td', {}, String(x.n)), h('td', { class: 'num' }, HugoMed.money(x.amount)))))
      )));
      box.appendChild(h('p', { class: 'muted small pad' }, 'Sababu zinazojirudia zinaweza kugeuzwa kuwa sheria mpya za ukaguzi, ili makosa hayo yakamatwe kabla ya kutuma.'));
    } catch (err) { root.appendChild(h('p', { class: 'form-message error' }, err.message)); }
  }

  async function openClaim(id, flashText, flashType) {
    root.textContent = '';
    let d;
    try { d = await HugoMed.api('/api/claims/' + id); }
    catch (err) { root.appendChild(h('p', { class: 'form-message error' }, err.message)); return; }
    const c = d.claim;
    const st = STATUS[c.status] || ['grey', c.status];

    root.appendChild(h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn', onclick: () => showList() }, '← Madai'),
      h('span', { class: 'chip ' + st[0] }, st[1])
    ));
    const flash = h('p', { class: 'form-message' + (flashText ? ' ' + (flashType || 'ok') : ''), role: 'status' }, flashText || '');
    root.appendChild(flash);

    async function act(url, body) {
      try { const r = await HugoMed.api(url, { method: 'POST', body: body || {} }); openClaim(c.id, r.message, 'ok'); }
      catch (err) { HugoMed.showMessage(flash, err.message, 'error'); }
    }

    root.appendChild(h('section', { class: 'card' },
      h('div', { class: 'check-head' }, h('h2', { style: 'margin: 0' }, c.claim_no + ' · ' + HugoMed.patientName(c)), h('span', { class: 'chip ' + (c.readiness_score >= 100 ? 'green' : c.error_count ? 'red' : 'amber') }, 'Readiness ' + c.readiness_score + '%')),
      h('dl', { class: 'details' },
        h('dt', {}, 'Mlipaji'), h('dd', {}, c.payer_name + (c.member_number ? ' · kadi ' + c.member_number : '') + (c.employee_number ? ' · mfanyakazi ' + c.employee_number : '')),
        h('dt', {}, 'Mgonjwa'), h('dd', {}, 'MRN ' + c.mrn + ' · ' + HugoMed.sexLabel(c.sex) + ' · ' + HugoMed.age(c.date_of_birth)),
        h('dt', {}, 'Ziara'), h('dd', {}, c.visit_no + ' · ' + HugoMed.dateTime(c.arrived_at)),
        h('dt', {}, 'Daktari'), h('dd', {}, (c.doctor_name || '—') + (c.professional_reg_no ? ' · Reg ' + c.professional_reg_no : ' · namba ya usajili haipo')),
        h('dt', {}, 'Diagnosis'), h('dd', {}, d.diagnoses.length ? d.diagnoses.map((x) => x.icd10_code + ' ' + (x.description || '')).join('; ') : 'Hakuna'),
        h('dt', {}, 'Kiasi'), h('dd', {}, HugoMed.money(c.claimed_amount) + (c.paid_amount !== null && c.paid_amount !== undefined ? ' · limelipwa ' + HugoMed.money(c.paid_amount) : '')),
        c.rejection_reason ? [h('dt', {}, 'Sababu'), h('dd', {}, c.rejection_reason)] : null,
        c.notes ? [h('dt', {}, 'Maelezo'), h('dd', {}, c.notes)] : null
      )
    ));

    // Makosa na tahadhari
    root.appendChild(h('section', { class: 'card check-box ' + (c.error_count ? 'red' : c.warning_count ? 'amber' : 'green'), style: 'margin-top: 16px' },
      h('h2', {}, 'Ukaguzi (Pre-Audit)'),
      d.findings.length ? d.findings.map((f) => h('div', { class: 'finding' },
        h('span', { class: 'chip ' + (f.resolved_at ? 'grey' : f.severity === 'error' ? 'red' : 'amber') }, f.resolved_at ? 'Imekubaliwa' : f.severity === 'error' ? 'Kosa' : 'Angalia'),
        h('span', {}, f.message)
      )) : h('div', { class: 'finding' }, h('span', { class: 'chip green' }, 'Sawa'), h('span', {}, 'Hakuna kosa wala tahadhari.')),
      ['has_errors', 'needs_info', 'ready', 'draft'].includes(c.status) ? h('div', { class: 'row-actions', style: 'margin-top: 10px' },
        h('button', { type: 'button', class: 'btn', onclick: () => act('/api/claims/' + c.id + '/recheck') }, 'Kagua upya'),
        c.status === 'needs_info' ? h('button', {
          type: 'button', class: 'btn',
          onclick: () => { const note = window.prompt('Kwa nini tahadhari hizi zinakubaliwa? (mf. kadi ilihakikiwa kwenye portal)'); if (note) act('/api/claims/' + c.id + '/accept-warnings', { note }); }
        }, 'Kubali tahadhari') : null,
        c.status === 'ready' ? h('button', { type: 'button', class: 'btn primary', onclick: () => act('/api/claims/submit', { ids: [c.id] }) }, 'Weka "Limetumwa"') : null
      ) : null
    ));

    // Huduma kwenye dai
    root.appendChild(h('section', { class: 'card flush', style: 'margin-top: 16px' },
      h('h2', { class: 'pad', style: 'padding-bottom: 0' }, 'Huduma'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Item code'), h('th', {}, 'Huduma'), h('th', {}, 'Idadi'), h('th', { class: 'num' }, 'Bei'), h('th', { class: 'num' }, 'Mlipaji'), h('th', { class: 'num' }, 'Mgonjwa'))),
        h('tbody', {}, d.items.map((it) => h('tr', {},
          h('td', {}, it.payer_item_code || h('span', { class: 'chip amber' }, 'Haipo')),
          h('td', {}, it.description), h('td', {}, String(Number(it.quantity))),
          h('td', { class: 'num' }, HugoMed.money(it.unit_price)), h('td', { class: 'num' }, HugoMed.money(it.payer_amount)), h('td', { class: 'num' }, HugoMed.money(it.patient_amount))
        )))
      ))
    ));

    // Majibu ya mlipaji
    if (['submitted', 'partially_paid'].includes(c.status)) {
      const paidIn = h('input', { name: 'paid_amount', inputmode: 'numeric', value: String(Math.round(c.claimed_amount)) });
      const dateIn = h('input', { name: 'paid_at', type: 'date', value: new Date().toISOString().slice(0, 10) });
      const reasonIn = h('input', { name: 'reason', placeholder: 'Sababu ya kupunguzwa au kukataliwa' });
      root.appendChild(h('section', { class: 'card stack', style: 'margin-top: 16px' },
        h('h2', { style: 'margin: 0' }, 'Jibu la ' + c.payer_name),
        h('div', { class: 'form-grid' }, h('label', {}, 'Kiasi kilicholipwa', paidIn), h('label', {}, 'Tarehe', dateIn), h('label', {}, 'Sababu (kama limepunguzwa / kukataliwa)', reasonIn)),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn danger', onclick: () => act('/api/claims/' + c.id + '/rejected', { reason: reasonIn.value }) }, 'Limekataliwa'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => act('/api/claims/' + c.id + '/paid', { paid_amount: paidIn.value, paid_at: dateIn.value, reason: reasonIn.value }) }, 'Hifadhi malipo')
        )
      ));
    }
  }

  showList();
};
