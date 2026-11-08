// =============================================================
// HugoMed - Mapokezi
// Kutafuta mgonjwa -> kuchagua -> kuhakiki mlipaji -> kuanza ziara (token)
// au kusajili mgonjwa mpya (pamoja na onyo la rekodi mbili).
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.reception = function (page, me) {
  const h = HugoMed.h;
  let payers = []; // walipaji wa hospitali (Cash, NHIF, bima, kampuni)

  // ---------- Kichwa ----------
  const newBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Mgonjwa mpya');
  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Mapokezi'), h('p', { class: 'muted' }, 'Tafuta kwanza ili mgonjwa mmoja asiwe na rekodi mbili')),
    newBtn
  ));

  // ---------- Kutafuta ----------
  const searchInput = h('input', { type: 'search', placeholder: 'Simu, jina, MRN, NIDA au namba ya kadi', 'aria-label': 'Tafuta mgonjwa' });
  const searchForm = h('form', { class: 'card search-bar' },
    searchInput,
    h('button', { type: 'submit', class: 'btn primary' }, 'Tafuta')
  );
  page.appendChild(searchForm);

  const results = h('section', { class: 'card flush', style: 'margin-top: 16px' });
  page.appendChild(results);

  // Sehemu ya mgonjwa aliyechaguliwa, na fomu ya mgonjwa mpya
  const detail = h('div', { style: 'margin-top: 16px' });
  page.appendChild(detail);

  // ---------- Orodha ya matokeo ----------
  function payerChips(p) {
    if (!p.payers || !p.payers.length) return [h('span', { class: 'chip grey' }, 'Cash')];
    return p.payers.map((x) => h('span', { class: 'chip teal' }, x.name));
  }

  async function search(q) {
    results.textContent = '';
    results.appendChild(h('p', { class: 'muted pad' }, 'Inatafuta...'));
    try {
      const res = await HugoMed.api('/api/patients' + (q ? '?q=' + encodeURIComponent(q) : ''));
      results.textContent = '';
      if (!res.items.length) {
        results.appendChild(h('div', { class: 'pad' },
          h('p', { style: 'margin: 0 0 10px' }, 'Hakuna mgonjwa aliyepatikana kwa "' + q + '".'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => showNewForm(q) }, '+ Msajili kama mgonjwa mpya')
        ));
        return;
      }
      results.appendChild(h('div', { class: 'pad small muted', style: 'padding-bottom: 0' }, q ? res.items.length + ' wamepatikana' : 'Waliosajiliwa karibuni'));
      results.appendChild(h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'MRN'), h('th', {}, 'Jina'), h('th', {}, 'Jinsia / umri'), h('th', {}, 'Simu'), h('th', {}, 'Walipaji'), h('th', {}, ''))),
          h('tbody', {}, res.items.map((p) => h('tr', {},
            h('td', { class: 'nowrap' }, h('strong', {}, p.mrn)),
            h('td', {}, HugoMed.patientName(p)),
            h('td', { class: 'small' }, HugoMed.sexLabel(p.sex) + (p.date_of_birth ? ' · ' + HugoMed.age(p.date_of_birth) : '')),
            h('td', { class: 'small' }, p.phone || '—'),
            h('td', {}, payerChips(p)),
            h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small primary', onclick: () => openPatient(p.id) }, 'Chagua'))
          )))
        )
      ));
    } catch (err) {
      results.textContent = '';
      results.appendChild(h('p', { class: 'form-message error pad' }, err.message));
    }
  }

  searchForm.addEventListener('submit', (e) => { e.preventDefault(); search(searchInput.value.trim()); });

  // ---------- Mgonjwa aliyechaguliwa ----------
  async function openPatient(id) {
    detail.textContent = '';
    detail.appendChild(h('p', { class: 'muted' }, 'Inapakia...'));
    let res;
    try {
      res = await HugoMed.api('/api/patients/' + id);
    } catch (err) {
      detail.textContent = '';
      detail.appendChild(h('p', { class: 'form-message error' }, err.message));
      return;
    }
    renderPatient(res.patient, res.visits);
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cardStatus(pp) {
    const today = new Date(new Date().toDateString());
    if (pp.valid_until && new Date(pp.valid_until) < today) return h('span', { class: 'chip red' }, 'Imeisha ' + HugoMed.date(pp.valid_until));
    if (pp.last_verified_at && new Date(pp.last_verified_at) >= today) return h('span', { class: 'chip green' }, 'Imehakikiwa leo');
    return h('span', { class: 'chip amber' }, 'Haijahakikiwa leo');
  }

  function renderPatient(p, visits) {
    detail.textContent = '';
    const openVisit = visits.find((v) => !['completed', 'cancelled'].includes(v.stage));

    // Kichwa cha mgonjwa
    detail.appendChild(h('section', { class: 'card patient-banner' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (p.first_name[0] || '') + (p.last_name[0] || '')),
      h('div', { style: 'flex: 1 1 auto' },
        h('div', { class: 'banner-name' }, HugoMed.patientName(p)),
        h('div', { class: 'muted small' }, ['MRN ' + p.mrn, HugoMed.sexLabel(p.sex), HugoMed.age(p.date_of_birth), p.phone].filter(Boolean).join(' · '))
      ),
      p.allergies ? h('span', { class: 'chip red' }, 'Mzio: ' + p.allergies) : null,
      h('button', { type: 'button', class: 'btn small', onclick: () => { detail.textContent = ''; } }, 'Funga')
    ));

    const cols = h('div', { class: 'two-col' });
    detail.appendChild(cols);

    // ----- Walipaji -----
    const payerBox = h('section', { class: 'card' }, h('h2', {}, 'Walipaji wa mgonjwa'));
    cols.appendChild(payerBox);
    const payerMsg = h('p', { class: 'form-message', role: 'alert' });

    if (!p.payers.length) payerBox.appendChild(h('p', { class: 'muted' }, 'Hana kadi ya bima wala kampuni. Atalipa cash.'));
    p.payers.forEach((pp) => {
      payerBox.appendChild(h('div', { class: 'payer-row' },
        h('div', {},
          h('strong', {}, pp.name), pp.is_primary ? h('span', { class: 'muted small' }, ' · mkuu') : null,
          h('div', { class: 'muted small' }, (HugoMed.PAYER_TYPES[pp.type] || pp.type) + ' · ' + (pp.member_number || pp.employee_number || '—') + (pp.valid_until ? ' · hadi ' + HugoMed.date(pp.valid_until) : ''))
        ),
        cardStatus(pp),
        h('button', {
          type: 'button', class: 'btn small',
          onclick: async () => {
            try {
              const r = await HugoMed.api('/api/patients/' + p.id + '/payers/' + pp.id + '/verify', { method: 'POST', body: {} });
              renderPatient(r.patient, visits);
            } catch (err) { HugoMed.showMessage(payerMsg, err.message, 'error'); }
          }
        }, 'Nimehakiki')
      ));
    });
    payerBox.appendChild(h('p', { class: 'muted small' }, 'Hakiki kadi kwenye mfumo wa NHIF au wa bima husika, kisha bofya "Nimehakiki". Muunganisho wa moja kwa moja na NHIF utaongezwa baadaye.'));

    // Kuongeza kadi
    const nonCash = payers.filter((x) => x.type !== 'cash');
    const addForm = h('form', { class: 'stack', novalidate: true, style: 'margin-top: 12px' },
      h('div', { class: 'form-grid' },
        h('label', {}, 'Mlipaji', h('select', { name: 'payer_id', required: true },
          h('option', { value: '' }, 'Chagua...'),
          nonCash.map((x) => h('option', { value: x.id }, x.name + ' (' + HugoMed.PAYER_TYPES[x.type] + ')'))
        )),
        h('label', {}, 'Namba ya kadi / uanachama', h('input', { name: 'member_number' })),
        h('label', {}, 'Namba ya mfanyakazi (kampuni)', h('input', { name: 'employee_number' })),
        h('label', {}, 'Kadi inaisha', h('input', { name: 'valid_until', type: 'date' }))
      ),
      payerMsg,
      h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn' }, '+ Ongeza kadi'))
    );
    payerBox.appendChild(h('details', {}, h('summary', {}, 'Ongeza kadi ya NHIF, bima au kampuni'), addForm));
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = HugoMed.formData(addForm);
      body.payer_id = Number(body.payer_id);
      if (!body.valid_until) delete body.valid_until;
      try {
        const r = await HugoMed.api('/api/patients/' + p.id + '/payers', { method: 'POST', body });
        renderPatient(r.patient, visits);
      } catch (err) { HugoMed.showMessage(payerMsg, err.message, 'error'); }
    });

    // ----- Kuanza ziara -----
    const visitBox = h('section', { class: 'card' }, h('h2', {}, 'Ziara ya leo'));
    cols.appendChild(visitBox);

    if (openVisit) {
      visitBox.appendChild(h('div', { class: 'token-box' },
        h('div', { class: 'muted small' }, 'Tayari ana ziara iliyo wazi'),
        h('div', { class: 'token' }, openVisit.token),
        HugoMed.stageChip(openVisit.stage)
      ));
      visitBox.appendChild(h('div', { class: 'row-actions', style: 'margin-top: 12px' },
        h('button', { type: 'button', class: 'btn', onclick: () => printToken(p, openVisit) }, 'Chapisha token')
      ));
    } else {
      const visitMsg = h('p', { class: 'form-message', role: 'alert' });
      const payerSelect = h('select', { name: 'patient_payer_id' },
        h('option', { value: '' }, 'Cash (analipa mwenyewe)'),
        p.payers.filter((x) => x.payer_active).map((x) => h('option', { value: x.id, selected: x.is_primary }, x.name + ' · ' + (x.member_number || x.employee_number || '')))
      );
      const vForm = h('form', { class: 'stack', novalidate: true },
        h('label', {}, 'Mlipaji wa ziara hii', payerSelect),
        h('div', { class: 'form-grid' },
          h('label', {}, 'Idara', h('select', { name: 'department' }, HugoMed.DEPARTMENTS.map((d) => h('option', { value: d }, d)))),
          h('label', {}, 'Kipaumbele', h('select', { name: 'priority' },
            Object.entries(HugoMed.PRIORITIES).map(([k, v]) => h('option', { value: k }, v[1]))
          ))
        ),
        visitMsg,
        h('button', { type: 'submit', class: 'btn primary block' }, 'Anza ziara na toa token')
      );
      visitBox.appendChild(vForm);
      vForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = HugoMed.formData(vForm);
        body.patient_id = p.id;
        body.patient_payer_id = body.patient_payer_id ? Number(body.patient_payer_id) : null;
        const btn = vForm.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const r = await HugoMed.api('/api/visits', { method: 'POST', body });
          visitBox.textContent = '';
          visitBox.appendChild(h('h2', {}, 'Ziara ya leo'));
          visitBox.appendChild(h('div', { class: 'token-box' },
            h('div', { class: 'muted small' }, 'Token'),
            h('div', { class: 'token' }, r.visit.token),
            h('div', { class: 'small' }, 'Aende Triage · ' + r.visit.department)
          ));
          visitBox.appendChild(h('div', { class: 'row-actions', style: 'margin-top: 12px' },
            h('button', { type: 'button', class: 'btn primary', onclick: () => printToken(p, r.visit) }, 'Chapisha token')
          ));
        } catch (err) {
          HugoMed.showMessage(visitMsg, err.message, 'error');
          btn.disabled = false;
        }
      });
    }

    // Ziara zilizopita
    if (visits.length) {
      detail.appendChild(h('section', { class: 'card flush', style: 'margin-top: 16px' },
        h('h2', { class: 'pad', style: 'padding-bottom: 0' }, 'Ziara zilizopita'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Tarehe'), h('th', {}, 'Token'), h('th', {}, 'Idara'), h('th', {}, 'Mlipaji'), h('th', {}, 'Hali'))),
          h('tbody', {}, visits.map((v) => h('tr', {},
            h('td', { class: 'small' }, HugoMed.dateTime(v.arrived_at)), h('td', {}, v.token),
            h('td', {}, v.department || '—'), h('td', {}, v.payer_name || 'Cash'), h('td', {}, HugoMed.stageChip(v.stage))
          )))
        ))
      ));
    }
  }

  // ---------- Kuchapisha token (printa ya kawaida au thermal) ----------
  function printToken(p, v) {
    const slip = document.getElementById('print-slip') || document.body.appendChild(h('div', { id: 'print-slip' }));
    slip.textContent = '';
    slip.appendChild(h('div', { class: 'slip-hosp' }, me.tenant_name || 'HugoMed'));
    slip.appendChild(h('div', { class: 'slip-token' }, v.token));
    slip.appendChild(h('div', {}, HugoMed.patientName(p)));
    slip.appendChild(h('div', {}, 'MRN ' + p.mrn + ' · ' + (v.department || 'OPD')));
    slip.appendChild(h('div', {}, HugoMed.dateTime(v.arrived_at || new Date())));
    slip.appendChild(h('div', { class: 'slip-note' }, 'Subiri kuitwa kwa namba yako'));
    window.print();
  }

  // ---------- Mgonjwa mpya ----------
  function showNewForm(prefill) {
    detail.textContent = '';
    const msg = h('p', { class: 'form-message', role: 'alert' });
    const dupBox = h('div');
    const payerSelect = h('select', { name: 'payer_id' }, payers.map((x) => h('option', { value: x.id }, x.name + (x.type === 'cash' ? '' : ' (' + HugoMed.PAYER_TYPES[x.type] + ')'))));

    const looksLikePhone = prefill && /^[0-9 +]+$/.test(prefill);
    const form = h('form', { class: 'card', novalidate: true },
      h('h2', {}, 'Mgonjwa mpya'),
      h('div', { class: 'form-grid' },
        h('label', {}, 'Jina la kwanza *', h('input', { name: 'first_name', required: true, value: !looksLikePhone && prefill ? prefill.split(' ')[0] : null })),
        h('label', {}, 'Jina la kati', h('input', { name: 'middle_name' })),
        h('label', {}, 'Jina la ukoo *', h('input', { name: 'last_name', required: true })),
        h('label', {}, 'Jinsia *', h('select', { name: 'sex', required: true }, h('option', { value: '' }, 'Chagua...'), h('option', { value: 'F' }, 'Mwanamke'), h('option', { value: 'M' }, 'Mwanaume'))),
        h('label', {}, 'Tarehe ya kuzaliwa', h('input', { name: 'date_of_birth', type: 'date' })),
        h('label', {}, 'Au umri (miaka) kama hajui tarehe', h('input', { name: 'age_years', type: 'number', min: '0', max: '120' })),
        h('label', {}, 'Namba ya simu', h('input', { name: 'phone', value: looksLikePhone ? prefill : null })),
        h('label', {}, 'Kitambulisho', h('select', { name: 'id_type' }, h('option', { value: 'nida' }, 'NIDA'), h('option', { value: 'passport' }, 'Passport'), h('option', { value: 'none' }, 'Hana'))),
        h('label', {}, 'Namba ya kitambulisho', h('input', { name: 'id_number' })),
        h('label', {}, 'Simu ya mtu wa karibu', h('input', { name: 'next_of_kin_phone' })),
        h('label', {}, 'Mahali anapoishi', h('input', { name: 'address' })),
        h('label', {}, 'Mzio (allergies)', h('input', { name: 'allergies', placeholder: 'Mf. Penicillin' }))
      ),
      h('h2', { style: 'margin-top: 8px' }, 'Mlipaji'),
      h('div', { class: 'form-grid' },
        h('label', {}, 'Analipiwa na', payerSelect),
        h('label', {}, 'Namba ya kadi / uanachama', h('input', { name: 'member_number' })),
        h('label', {}, 'Namba ya mfanyakazi (kampuni)', h('input', { name: 'employee_number' })),
        h('label', {}, 'Kadi inaisha', h('input', { name: 'valid_until', type: 'date' }))
      ),
      dupBox,
      msg,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => { detail.textContent = ''; } }, 'Ghairi'),
        h('button', { type: 'submit', class: 'btn primary' }, 'Sajili mgonjwa')
      )
    );
    detail.appendChild(form);
    form.querySelector('input').focus();

    async function submit(force) {
      const d = HugoMed.formData(form);
      if (!d.date_of_birth && d.age_years) {
        // Umri tu: tarehe ya kukadiria ni 1 Julai ya mwaka husika
        d.date_of_birth = (new Date().getFullYear() - Number(d.age_years)) + '-07-01';
      }
      const selected = payers.find((x) => String(x.id) === String(d.payer_id));
      const body = {
        first_name: d.first_name, middle_name: d.middle_name, last_name: d.last_name, sex: d.sex,
        date_of_birth: d.date_of_birth || null, phone: d.phone, id_type: d.id_type, id_number: d.id_number,
        next_of_kin_phone: d.next_of_kin_phone, address: d.address, allergies: d.allergies, force: force || false
      };
      if (selected && selected.type !== 'cash') {
        if (!d.member_number && !d.employee_number) {
          HugoMed.showMessage(msg, 'Jaza namba ya kadi au ya mfanyakazi kwa ' + selected.name + '.', 'error');
          return;
        }
        body.payer = { payer_id: selected.id, member_number: d.member_number, employee_number: d.employee_number, valid_until: d.valid_until || null };
      }
      HugoMed.showMessage(msg, '');
      dupBox.textContent = '';
      try {
        const r = await HugoMed.api('/api/patients', { method: 'POST', body });
        openPatient(r.patient.id);
      } catch (err) {
        if (err.status === 409 && err.data && err.data.matches) {
          dupBox.appendChild(h('div', { class: 'dup-box' },
            h('strong', {}, err.message),
            err.data.matches.map((m) => h('div', { class: 'payer-row' },
              h('div', {}, h('strong', {}, HugoMed.patientName(m)), h('div', { class: 'muted small' }, 'MRN ' + m.mrn + ' · ' + (m.phone || '') + ' · ' + HugoMed.age(m.date_of_birth))),
              h('button', { type: 'button', class: 'btn small primary', onclick: () => openPatient(m.id) }, 'Ni huyu')
            )),
            h('div', { class: 'row-actions', style: 'margin-top: 8px' },
              h('button', { type: 'button', class: 'btn small', onclick: () => submit(true) }, 'Si yeye, sajili mgonjwa mpya')
            )
          ));
        } else {
          HugoMed.showMessage(msg, err.message, 'error');
        }
      }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  }

  newBtn.addEventListener('click', () => showNewForm(searchInput.value.trim()));

  // ---------- Kuanza ----------
  HugoMed.api('/api/payers').then((r) => { payers = r.items; }).catch(() => {});
  search('');
  searchInput.focus();
};
