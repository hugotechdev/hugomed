// =============================================================
// HugoMed - Maabara na Radiology
// Sampuli -> matokeo -> uhakiki wa mtu wa pili -> mgonjwa anarudi kwa daktari
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.lab = function (page, me) {
  const h = HugoMed.h;
  let type = 'lab';

  const head = h('div', { class: 'page-head' });
  page.appendChild(head);
  const tabs = h('div', { class: 'stage-tabs' });
  page.appendChild(tabs);
  const flash = h('p', { class: 'form-message', role: 'status' });
  page.appendChild(flash);
  const box = h('div', { class: 'stack' });
  page.appendChild(box);

  function renderHead() {
    head.textContent = '';
    head.appendChild(h('div', {},
      h('h1', {}, type === 'lab' ? 'Maabara' : 'Radiology'),
      h('p', { class: 'muted' }, 'Sampuli → matokeo → uhakiki wa mtu wa pili → mgonjwa anarudi kwa daktari')
    ));
    head.appendChild(h('button', { type: 'button', class: 'btn', onclick: load }, 'Onyesha upya'));
    tabs.textContent = '';
    [['lab', 'Maabara'], ['radiology', 'Radiology']].forEach(([k, l]) => {
      tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (type === k ? ' on' : ''), onclick: () => { type = k; renderHead(); load(); } }, l));
    });
  }

  async function act(url, body, okMsg) {
    try {
      const r = await HugoMed.api(url, { method: 'POST', body: body || {} });
      HugoMed.showMessage(flash, r.message || okMsg || 'Imehifadhiwa.', 'ok');
      load();
    } catch (err) {
      HugoMed.showMessage(flash, err.message, 'error');
    }
  }

  function orderRow(o) {
    const isLabTech = ['lab_technician', 'hospital_admin'].includes(me.role);
    const canResult = type === 'radiology' || isLabTech;
    const row = h('div', { class: 'lab-order' });

    const status = o.result
      ? h('span', { class: 'chip amber' }, 'Inasubiri uhakiki')
      : o.sample_no ? h('span', { class: 'chip teal' }, 'Sampuli ' + o.sample_no) : h('span', { class: 'chip grey' }, 'Sampuli bado');

    row.appendChild(h('div', { class: 'lab-order-head' },
      h('div', {}, h('strong', {}, o.test_name), h('div', { class: 'muted small' }, 'Ameagiza: ' + (o.ordered_by_name || '—') + ' · ' + HugoMed.dateTime(o.ordered_at) + (o.instructions ? ' · ' + o.instructions : ''))),
      status
    ));

    // 1. Sampuli
    if (!o.sample_no && !o.result && type === 'lab' && isLabTech) {
      row.appendChild(h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => act('/api/lab/orders/' + o.order_id + '/sample') }, 'Chukua sampuli (toa namba)')
      ));
    }

    // 2. Matokeo
    if (!o.result && canResult && (o.sample_no || type === 'radiology')) {
      const input = type === 'lab'
        ? h('input', { name: 'result', list: 'lab-results-list', placeholder: 'Mf. Positive (Pf), Negative, Hb 11.2 g/dL' })
        : h('textarea', { name: 'result', rows: '3', placeholder: 'Ripoti ya picha (findings na impression)' });
      const notes = h('input', { name: 'notes', placeholder: 'Maelezo (si lazima)' });
      const form = h('form', { class: 'lab-result-form' },
        h('label', { style: 'flex: 2 1 260px' }, type === 'lab' ? 'Matokeo' : 'Ripoti', input),
        h('label', { style: 'flex: 1 1 200px' }, 'Maelezo', notes),
        h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi matokeo')
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        act('/api/lab/orders/' + o.order_id + '/result', { result: input.value, notes: notes.value });
      });
      row.appendChild(form);
    }

    // 3. Uhakiki
    if (o.result) {
      const sameUser = o.entered_by === me.id && me.role !== 'hospital_admin';
      row.appendChild(h('div', { class: 'lab-verify' },
        h('div', {},
          h('div', {}, h('strong', {}, 'Matokeo: '), o.result),
          o.result_notes ? h('div', { class: 'muted small' }, o.result_notes) : null,
          h('div', { class: 'muted small' }, 'Yameingizwa na ' + (o.entered_by_name || '—') + ' · ' + HugoMed.dateTime(o.entered_at))
        ),
        sameUser
          ? h('span', { class: 'muted small' }, 'Yahakikiwe na mtu mwingine')
          : h('button', { type: 'button', class: 'btn primary small', onclick: () => act('/api/lab/orders/' + o.order_id + '/verify') }, 'Hakiki matokeo')
      ));
    }
    return row;
  }

  async function load() {
    box.textContent = '';
    box.appendChild(h('p', { class: 'muted' }, 'Inapakia...'));
    try {
      const res = await HugoMed.api('/api/lab/queue?type=' + type);
      box.textContent = '';
      if (!res.items.length) {
        box.appendChild(h('section', { class: 'card' }, h('p', { class: 'muted', style: 'margin: 0' }, 'Hakuna maagizo yanayosubiri.')));
        return;
      }
      res.items.forEach((v) => {
        box.appendChild(h('section', { class: 'card' },
          h('div', { class: 'patient-banner flat' },
            h('div', { class: 'avatar', 'aria-hidden': 'true' }, (v.first_name[0] || '') + (v.last_name[0] || '')),
            h('div', { style: 'flex: 1 1 auto' },
              h('div', { class: 'banner-name' }, HugoMed.patientName(v) + ' · ' + v.token),
              h('div', { class: 'muted small' }, ['MRN ' + v.mrn, HugoMed.sexLabel(v.sex), HugoMed.age(v.date_of_birth), v.payer_name, v.department].filter(Boolean).join(' · '))
            ),
            HugoMed.priorityChip(v.priority),
            v.stage === 'admitted' ? h('span', { class: 'chip teal' }, 'Amelazwa') : null,
            v.unpaid > 0 ? h('span', { class: 'chip red' }, 'Hajalipa ' + HugoMed.money(v.unpaid)) : null
          ),
          v.orders.map(orderRow)
        ));
      });
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  // Mapendekezo ya matokeo ya kawaida
  if (!document.getElementById('lab-results-list')) {
    document.body.appendChild(h('datalist', { id: 'lab-results-list' },
      ['Positive', 'Negative', 'Positive (Pf)', 'Normal', 'Reactive', 'Non-reactive', 'Seen', 'Not seen'].map((x) => h('option', { value: x }))
    ));
  }

  renderHead();
  load();
};
