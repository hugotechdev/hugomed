// =============================================================
// HugoMed - Daktari (OPD)
// Foleni ya daktari -> mgonjwa: EMR, notes, ICD-10, maagizo,
// ukaguzi wa moja kwa moja -> kumaliza (maabara au malipo).
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.doctor = function (page, me) {
  const h = HugoMed.h;
  let mineOnly = me.role === 'doctor';
  let services = { lab: [], drug: [], procedure: [] };

  const root = h('div');
  page.appendChild(root);

  // Inapakia orodha ya vipimo, dawa na huduma mara moja
  const servicesReady = HugoMed.api('/api/services').then((r) => {
    r.items.forEach((s) => { if (services[s.category]) services[s.category].push(s); });
  }).catch(() => {});

  // =========================================================
  // Foleni ya daktari
  // =========================================================
  async function showQueue() {
    root.textContent = '';
    const toggle = h('button', { type: 'button', class: 'btn' }, mineOnly ? 'Onyesha wote' : 'Wangu tu');
    toggle.addEventListener('click', () => { mineOnly = !mineOnly; showQueue(); });
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Daktari (OPD)'), h('p', { class: 'muted' }, mineOnly ? 'Wagonjwa wako na wasio na daktari' : 'Wagonjwa wote walio kwa daktari')),
      h('div', { class: 'row-actions' }, me.role === 'doctor' ? toggle : null, h('button', { type: 'button', class: 'btn', onclick: showQueue }, 'Onyesha upya'))
    ));

    const box = h('div', { class: 'stack' });
    root.appendChild(box);

    try {
      const q = mineOnly ? '&mine=1' : '';
      const [results, waiting, admitted] = await Promise.all([
        HugoMed.api('/api/visits?stage=results' + q),
        HugoMed.api('/api/visits?stage=doctor' + q),
        HugoMed.api('/api/visits?stage=admitted')
      ]);

      function list(title, note, items) {
        const sec = h('section', { class: 'card' }, h('h2', {}, title + ' (' + items.length + ')'));
        if (note) sec.appendChild(h('p', { class: 'muted small', style: 'margin-top: -6px' }, note));
        if (!items.length) { sec.appendChild(h('p', { class: 'muted' }, 'Hakuna.')); return sec; }
        const grid = h('div', { class: 'queue-grid' });
        items.forEach((v) => grid.appendChild(h('button', { type: 'button', class: 'queue-item', onclick: () => openVisit(v.id) },
          h('div', { class: 'queue-top' }, h('strong', {}, v.token), HugoMed.priorityChip(v.priority), HugoMed.waitChip(v.waiting_minutes)),
          h('div', {}, HugoMed.patientName(v)),
          h('div', { class: 'muted small' }, [HugoMed.sexLabel(v.sex), HugoMed.age(v.date_of_birth), v.payer_name || 'Cash', v.doctor_name].filter(Boolean).join(' · ')),
          v.allergies ? h('div', {}, h('span', { class: 'chip red' }, 'Mzio: ' + v.allergies)) : null
        )));
        sec.appendChild(grid);
        return sec;
      }

      box.appendChild(list('Matokeo yamerudi', 'Wagonjwa waliotoka maabara, wanasubiri uwaone tena', results.items));
      box.appendChild(list('Wanasubiri kumwona daktari', null, waiting.items));
      if (admitted.items.length) box.appendChild(list('Waliolazwa (wodini)', 'Maagizo mapya ya wagonjwa waliolazwa', admitted.items));
    } catch (err) {
      box.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  // =========================================================
  // Mgonjwa mmoja
  // =========================================================
  async function openVisit(id) {
    await servicesReady;
    root.textContent = '';
    root.appendChild(h('p', { class: 'muted' }, 'Inapakia...'));
    let data;
    try {
      data = await HugoMed.api('/api/opd/visits/' + id);
    } catch (err) {
      root.textContent = '';
      root.appendChild(h('p', { class: 'form-message error' }, err.message));
      return;
    }
    render(data);
  }

  function reload(id) { return openVisit(id); }

  function render(d) {
    const v = d.visit, p = d.patient;
    const canEdit = ['doctor', 'results', 'admitted'].includes(v.stage) && ['doctor', 'hospital_admin'].includes(me.role);
    root.textContent = '';

    // ---------- Kichwa ----------
    root.appendChild(h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn', onclick: showQueue }, '← Foleni ya daktari'),
      h('div', { class: 'row-actions' }, HugoMed.stageChip(v.stage))
    ));

    root.appendChild(h('section', { class: 'card patient-banner' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (p.first_name[0] || '') + (p.last_name[0] || '')),
      h('div', { style: 'flex: 1 1 260px' },
        h('div', { class: 'banner-name' }, HugoMed.patientName(p) + ' · ' + v.token),
        h('div', { class: 'muted small' }, ['MRN ' + p.mrn, HugoMed.sexLabel(p.sex), HugoMed.age(p.date_of_birth), v.payer_name, v.doctor_name].filter(Boolean).join(' · '))
      ),
      p.allergies ? h('span', { class: 'chip red' }, 'Mzio: ' + p.allergies) : h('span', { class: 'chip grey' }, 'Hakuna mzio unaojulikana'),
      p.chronic_conditions ? h('span', { class: 'chip amber' }, 'Sugu: ' + p.chronic_conditions) : null
    ));

    const grid = h('div', { class: 'opd-grid' });
    root.appendChild(grid);
    const side = h('div', { class: 'stack' });
    const main = h('div', { class: 'stack' });
    grid.appendChild(side);
    grid.appendChild(main);

    // ---------- EMR: vitals za leo ----------
    const vt = d.vitals;
    side.appendChild(h('section', { class: 'card' },
      h('h2', {}, 'Vitals za leo'),
      vt ? h('dl', { class: 'vitals-list' },
        vt.temperature_c ? [h('dt', {}, 'Joto'), h('dd', {}, vt.temperature_c + ' °C')] : null,
        vt.bp_systolic ? [h('dt', {}, 'BP'), h('dd', {}, vt.bp_systolic + '/' + (vt.bp_diastolic || '?'))] : null,
        vt.pulse ? [h('dt', {}, 'Pulse'), h('dd', {}, String(vt.pulse))] : null,
        vt.spo2 ? [h('dt', {}, 'SpO2'), h('dd', {}, vt.spo2 + '%')] : null,
        vt.weight_kg ? [h('dt', {}, 'Uzito'), h('dd', {}, vt.weight_kg + ' kg')] : null,
        vt.height_cm ? [h('dt', {}, 'Urefu'), h('dd', {}, vt.height_cm + ' cm')] : null
      ) : h('p', { class: 'muted' }, 'Triage haijafanyika.'),
      vt && vt.complaint ? h('p', { class: 'small' }, h('strong', {}, 'Malalamiko (triage): '), vt.complaint) : null
    ));

    // ---------- EMR: historia ----------
    const hist = h('section', { class: 'card' }, h('h2', {}, 'Historia (EMR)'));
    side.appendChild(hist);
    if (!d.history.length) hist.appendChild(h('p', { class: 'muted' }, 'Hii ni ziara ya kwanza.'));
    d.history.forEach((x) => {
      hist.appendChild(h('div', { class: 'history-item' },
        h('div', { class: 'small' }, h('strong', {}, HugoMed.date(x.arrived_at)), ' · ' + (x.department || 'OPD') + (x.doctor_name ? ' · ' + x.doctor_name : '')),
        x.diagnoses.length ? h('div', { class: 'small' }, x.diagnoses.map((dx) => dx.code + ' ' + (dx.description || '')).join('; ')) : null,
        x.orders.length ? h('div', { class: 'muted small' }, x.orders.map((o) => o.name + (o.result ? ' (' + o.result + ')' : '')).join(', ')) : null,
        x.notes ? h('div', { class: 'muted small' }, x.notes.length > 140 ? x.notes.slice(0, 140) + '...' : x.notes) : null
      ));
    });

    // ---------- Notes ----------
    const note = d.note || {};
    const noteMsg = h('p', { class: 'form-message', role: 'status' });
    const noteForm = h('form', { class: 'card', novalidate: true },
      h('h2', {}, 'Clinical notes'),
      h('div', { class: 'stack' },
        h('label', {}, 'Malalamiko', h('input', { name: 'complaint', value: note.complaint || (vt && vt.complaint) || '', disabled: !canEdit })),
        h('label', {}, 'Historia na uchunguzi', h('textarea', { name: 'notes', rows: '4', disabled: !canEdit }, note.notes || '')),
        h('div', { class: 'form-grid' },
          h('label', {}, 'Rufaa (kama ipo)', h('input', { name: 'referral', value: note.referral || '', placeholder: 'Mf. Hospitali ya rufaa ya mkoa', disabled: !canEdit })),
          h('label', {}, 'Arudi tarehe (follow-up)', h('input', { name: 'follow_up_date', type: 'date', value: note.follow_up_date ? String(note.follow_up_date).slice(0, 10) : '', disabled: !canEdit }))
        )
      ),
      noteMsg,
      canEdit ? h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn' }, 'Hifadhi notes')) : null
    );
    main.appendChild(noteForm);
    async function saveNotes() {
      if (!canEdit) return;
      try {
        await HugoMed.api('/api/opd/visits/' + v.id + '/note', { method: 'PUT', body: HugoMed.formData(noteForm) });
        HugoMed.showMessage(noteMsg, 'Notes zimehifadhiwa.', 'ok');
      } catch (err) { HugoMed.showMessage(noteMsg, err.message, 'error'); }
    }
    noteForm.addEventListener('submit', (e) => { e.preventDefault(); saveNotes(); });

    // ---------- Diagnosis ----------
    const dxBox = h('section', { class: 'card' }, h('h2', {}, 'Diagnosis (ICD-10)'));
    main.appendChild(dxBox);
    const dxMsg = h('p', { class: 'form-message', role: 'alert' });
    const chips = h('div', { class: 'chip-row', style: 'margin-bottom: 12px' });
    dxBox.appendChild(chips);
    if (!d.diagnoses.length) chips.appendChild(h('span', { class: 'muted small' }, 'Bado hakuna diagnosis.'));
    d.diagnoses.forEach((x) => chips.appendChild(h('span', { class: 'dx-chip' },
      h('strong', {}, x.icd10_code), ' ' + (x.description || '') + (x.is_provisional ? ' (ya muda)' : ''),
      canEdit ? h('button', {
        type: 'button', class: 'dx-remove', 'aria-label': 'Ondoa ' + x.icd10_code,
        onclick: async () => {
          try { await HugoMed.api('/api/opd/visits/' + v.id + '/diagnoses/' + x.id, { method: 'DELETE' }); reload(v.id); }
          catch (err) { HugoMed.showMessage(dxMsg, err.message, 'error'); }
        }
      }, '×') : null
    )));

    if (canEdit) {
      const dxInput = h('input', { placeholder: 'Tafuta kwa jina au code, mf. malaria au B50', autocomplete: 'off', 'aria-label': 'Tafuta ICD-10' });
      const provisional = h('input', { type: 'checkbox' });
      const sugg = h('div', { class: 'suggest' });
      dxBox.appendChild(h('div', { class: 'stack' },
        dxInput,
        sugg,
        h('label', { class: 'check', style: 'margin: 0' }, provisional, 'Diagnosis ya muda (provisional)')
      ));
      dxBox.appendChild(dxMsg);

      async function addDx(code, description) {
        try {
          await HugoMed.api('/api/opd/visits/' + v.id + '/diagnoses', { method: 'POST', body: { icd10_code: code, description, is_provisional: provisional.checked } });
          reload(v.id);
        } catch (err) { HugoMed.showMessage(dxMsg, err.message, 'error'); }
      }

      let timer;
      dxInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const q = dxInput.value.trim();
          sugg.textContent = '';
          if (!q) return;
          const r = await HugoMed.api('/api/opd/icd10?q=' + encodeURIComponent(q)).catch(() => ({ items: [] }));
          r.items.forEach((x) => sugg.appendChild(h('button', { type: 'button', class: 'suggest-item', onclick: () => addDx(x.code, x.name) }, h('strong', {}, x.code), ' ' + x.name)));
          // Code sahihi isiyo kwenye orodha
          if (/^[A-Za-z][0-9]{2}(\.[0-9A-Za-z]{1,4})?$/.test(q) && !r.items.some((x) => x.code === q.toUpperCase())) {
            sugg.appendChild(h('button', { type: 'button', class: 'suggest-item', onclick: () => addDx(q.toUpperCase(), '') }, 'Tumia code ', h('strong', {}, q.toUpperCase())));
          }
          if (!sugg.children.length) sugg.appendChild(h('div', { class: 'muted small pad' }, 'Hakuna kilichopatikana. Andika code kamili ya ICD-10.'));
        }, 250);
      });
    }

    // ---------- Maagizo ----------
    const ordBox = h('section', { class: 'card' }, h('h2', {}, 'Maagizo: vipimo, dawa na huduma'));
    main.appendChild(ordBox);
    const ordMsg = h('p', { class: 'form-message', role: 'alert' });

    if (d.orders.length) {
      ordBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Kipengele'), h('th', {}, 'Dozi'), h('th', {}, 'Mara/siku'), h('th', {}, 'Siku'), h('th', {}, 'Idadi'), h('th', {}, 'Hali'), h('th', {}, ''))),
        h('tbody', {}, d.orders.map((o) => h('tr', {},
          h('td', {}, h('strong', {}, o.name), o.instructions ? h('div', { class: 'muted small' }, o.instructions) : null),
          h('td', {}, o.dose_units ? Number(o.dose_units) + ' ' + (o.unit || '') : '—'),
          h('td', {}, o.frequency_per_day || '—'),
          h('td', {}, o.days || '—'),
          h('td', {}, String(Number(o.quantity))),
          h('td', {}, o.type === 'lab'
            ? (o.verified_at ? h('span', { class: 'chip teal' }, 'Matokeo: ' + o.result) : h('span', { class: 'chip grey' }, o.status === 'ordered' ? 'Kwenda maabara' : 'Maabara'))
            : h('span', { class: 'chip grey' }, o.type === 'drug' ? 'Dawa' : 'Huduma')),
          h('td', { class: 'row-actions' }, canEdit && o.status === 'ordered' ? h('button', {
            type: 'button', class: 'btn small danger',
            onclick: async () => {
              try { await HugoMed.api('/api/opd/visits/' + v.id + '/orders/' + o.id, { method: 'DELETE' }); reload(v.id); }
              catch (err) { HugoMed.showMessage(ordMsg, err.message, 'error'); }
            }
          }, 'Ondoa') : null)
        )))
      )));
    } else {
      ordBox.appendChild(h('p', { class: 'muted' }, 'Bado hakuna agizo.'));
    }

    if (canEdit) {
      async function addOrder(body) {
        try {
          await HugoMed.api('/api/opd/visits/' + v.id + '/orders', { method: 'POST', body });
          reload(v.id);
        } catch (err) { HugoMed.showMessage(ordMsg, err.message, 'error'); }
      }

      const options = (list) => [h('option', { value: '' }, 'Chagua...')].concat(list.map((s) => h('option', { value: s.id }, s.name)));
      const noServices = !services.lab.length && !services.drug.length;

      // Kipimo
      const labSel = h('select', { 'aria-label': 'Kipimo' }, options(services.lab));
      const labForm = h('form', { class: 'order-row' }, h('label', { style: 'flex: 1 1 260px' }, 'Kipimo cha maabara', labSel), h('button', { type: 'submit', class: 'btn' }, '+ Kipimo'));
      labForm.addEventListener('submit', (e) => { e.preventDefault(); if (labSel.value) addOrder({ service_id: Number(labSel.value) }); });

      // Dawa: idadi inahesabiwa yenyewe
      const drugSel = h('select', { name: 'service_id', 'aria-label': 'Dawa' }, options(services.drug));
      const doseIn = h('input', { name: 'dose_units', inputmode: 'decimal', value: '1' });
      const freqSel = h('select', { name: 'frequency_per_day' }, [1, 2, 3, 4].map((n) => h('option', { value: n, selected: n === 2 }, n + '×')));
      const daysIn = h('input', { name: 'days', inputmode: 'numeric', value: '3' });
      const qtyIn = h('input', { name: 'quantity', inputmode: 'decimal' });
      const unitLbl = h('span', { class: 'muted small' }, '');
      let qtyTouched = false;
      function recalc() {
        const s = services.drug.find((x) => String(x.id) === drugSel.value);
        unitLbl.textContent = s && s.unit ? '(' + s.unit + ')' : '';
        if (!qtyTouched) {
          const q = Number(doseIn.value) * Number(freqSel.value) * Number(daysIn.value);
          qtyIn.value = Number.isFinite(q) && q > 0 ? String(q) : '';
        }
      }
      qtyIn.addEventListener('input', () => { qtyTouched = true; });
      [drugSel, doseIn, freqSel, daysIn].forEach((el) => el.addEventListener('input', recalc));
      [drugSel, freqSel].forEach((el) => el.addEventListener('change', recalc));
      recalc();

      const drugForm = h('form', { class: 'stack drug-form', novalidate: true },
        h('div', { class: 'form-grid drug-grid' },
          h('label', { class: 'wide' }, 'Dawa', drugSel),
          h('label', {}, h('span', {}, 'Dozi ', unitLbl), doseIn),
          h('label', {}, 'Mara/siku', freqSel),
          h('label', {}, 'Siku', daysIn),
          h('label', {}, 'Idadi (jumla)', qtyIn)
        ),
        h('div', { class: 'order-row' },
          h('label', { style: 'flex: 1 1 260px' }, 'Maelekezo kwa mgonjwa', h('input', { name: 'instructions', placeholder: 'Mf. baada ya chakula' })),
          h('button', { type: 'submit', class: 'btn' }, '+ Dawa')
        )
      );
      drugForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!drugSel.value) { HugoMed.showMessage(ordMsg, 'Chagua dawa.', 'error'); return; }
        const b = HugoMed.formData(drugForm);
        b.service_id = Number(b.service_id);
        addOrder(b);
      });

      // Huduma nyingine
      const procSel = h('select', { 'aria-label': 'Huduma' }, options(services.procedure));
      const procForm = h('form', { class: 'order-row' }, h('label', { style: 'flex: 1 1 260px' }, 'Huduma (procedure)', procSel), h('button', { type: 'submit', class: 'btn' }, '+ Huduma'));
      procForm.addEventListener('submit', (e) => { e.preventDefault(); if (procSel.value) addOrder({ service_id: Number(procSel.value) }); });

      ordBox.appendChild(h('div', { class: 'stack', style: 'margin-top: 16px' },
        noServices ? h('p', { class: 'form-message error' }, 'Orodha ya vipimo na dawa haijawekwa. Admin wa hospitali aende "Vipimo na dawa" → "Weka orodha ya kuanzia".') : null,
        labForm, h('hr', { class: 'divider' }), drugForm, services.procedure.length ? [h('hr', { class: 'divider' }), procForm] : null,
        ordMsg
      ));
    }

    // ---------- Ukaguzi ----------
    const c = d.checks;
    const scoreColor = c.errors ? 'red' : c.warnings ? 'amber' : 'green';
    const checkBox = h('section', { class: 'card check-box ' + scoreColor },
      h('div', { class: 'check-head' },
        h('h2', { style: 'margin: 0' }, 'Ukaguzi' + (c.payer_type !== 'cash' ? ' wa ' + c.payer_name : '')),
        h('span', { class: 'chip ' + scoreColor }, 'Readiness ' + c.score + '%')
      ),
      c.findings.map((f) => h('div', { class: 'finding' },
        h('span', { class: 'chip ' + (f.severity === 'error' ? 'red' : 'amber') }, f.severity === 'error' ? 'Kosa' : 'Angalia'),
        h('span', {}, f.message)
      )),
      c.passed.length ? h('div', { class: 'finding' }, h('span', { class: 'chip green' }, 'Sawa'), h('span', { class: 'muted small' }, c.passed.join(' · '))) : null,
      h('p', { class: 'muted small', style: 'margin: 8px 0 0' }, 'Mfumo unaonyesha makosa tu; marekebisho yanafanywa na daktari.')
    );
    main.appendChild(checkBox);

    // ---------- Kulaza (IPD) ----------
    if (canEdit && v.stage !== 'admitted') {
      const admitMsg = h('p', { class: 'form-message', role: 'alert' });
      const bedSel = h('select', { 'aria-label': 'Kitanda' }, h('option', { value: '' }, 'Inapakia vitanda...'));
      const reason = h('input', { placeholder: 'Sababu ya kumlaza', 'aria-label': 'Sababu ya kumlaza' });
      HugoMed.api('/api/ipd/wards').then((r) => {
        bedSel.textContent = '';
        bedSel.appendChild(h('option', { value: '' }, r.items.length ? 'Chagua kitanda wazi...' : 'Hakuna wodi (Admin aziweke kwenye IPD)'));
        r.items.forEach((w) => w.beds.filter((b) => !b.admission_id && b.is_active).forEach((b) => bedSel.appendChild(h('option', { value: b.id }, w.name + ' · ' + b.label))));
      }).catch(() => {});
      main.appendChild(h('section', { class: 'card' }, h('details', {},
        h('summary', {}, 'Laza mgonjwa (IPD)'),
        h('div', { class: 'stack', style: 'margin-top: 10px' },
          h('div', { class: 'form-grid' }, h('label', {}, 'Kitanda', bedSel), h('label', {}, 'Sababu', reason)),
          admitMsg,
          h('div', { class: 'row-actions' }, h('button', {
            type: 'button', class: 'btn',
            onclick: async () => {
              await saveNotes();
              try {
                const r = await HugoMed.api('/api/ipd/admit', { method: 'POST', body: { visit_id: v.id, bed_id: Number(bedSel.value), reason: reason.value } });
                await showQueue();
                root.insertBefore(h('p', { class: 'form-message ok' }, v.token + ' · ' + HugoMed.patientName(p) + ': ' + r.message), root.children[1] || null);
              } catch (err) { HugoMed.showMessage(admitMsg, err.message, 'error'); }
            }
          }, 'Laza mgonjwa'))
        )
      )));
    }
    if (v.stage === 'admitted') {
      main.appendChild(h('section', { class: 'card finish-bar' },
        h('div', { class: 'small' }, 'Mgonjwa amelazwa. Maagizo mapya yanaenda maabara na pharmacy moja kwa moja. Discharge inafanyika kwenye ukurasa wa IPD.'),
        h('div', { class: 'row-actions' }, h('a', { class: 'btn', href: '#/ipd' }, 'Fungua IPD'))
      ));
    }

    // ---------- Kumaliza ----------
    if (canEdit && v.stage !== 'admitted') {
      const pendingLab = d.orders.some((o) => o.type === 'lab' && ['ordered', 'paid', 'in_progress'].includes(o.status));
      const finMsg = h('p', { class: 'form-message', role: 'alert' });
      const overrideBox = h('div', { hidden: true },
        h('label', {}, 'Sababu ya kitabibu ya kuendelea licha ya makosa', h('textarea', { rows: '2', name: 'override_reason' }))
      );
      const finBtn = h('button', { type: 'button', class: 'btn primary' }, pendingLab ? 'Tuma maabara →' : 'Maliza na peleka malipo →');
      main.appendChild(h('section', { class: 'card finish-bar' },
        h('div', { class: 'muted small' }, pendingLab ? 'Mgonjwa ataenda maabara. Matokeo yakihakikiwa, atarudi kwako.' : 'Notes zitahifadhiwa na mgonjwa ataenda malipo.'),
        overrideBox, finMsg,
        h('div', { class: 'row-actions' }, finBtn)
      ));
      finBtn.addEventListener('click', async () => {
        finBtn.disabled = true;
        await saveNotes();
        const reason = overrideBox.hidden ? '' : overrideBox.querySelector('textarea').value.trim();
        try {
          const r = await HugoMed.api('/api/opd/visits/' + v.id + '/finish', { method: 'POST', body: { override_reason: reason } });
          await showQueue();
          root.insertBefore(h('p', { class: 'form-message ok' }, v.token + ' · ' + HugoMed.patientName(p) + ': ' + r.message), root.children[1] || null);
        } catch (err) {
          HugoMed.showMessage(finMsg, err.message, 'error');
          if (err.data && err.data.code === 'has_errors') overrideBox.hidden = false;
          finBtn.disabled = false;
        }
      });
    }
  }

  const direct = Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('visit'));
  if (direct) openVisit(direct); else showQueue();
};
