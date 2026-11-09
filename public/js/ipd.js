// =============================================================
// HugoMed - IPD: wodi, vitanda, waliolazwa, nursing notes, discharge
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.ipd = function (page, me) {
  const h = HugoMed.h;
  const isAdmin = me.role === 'hospital_admin';
  const isDoctor = ['doctor', 'hospital_admin'].includes(me.role);
  const clinical = ['doctor', 'nurse', 'hospital_admin'].includes(me.role);
  const root = h('div');
  page.appendChild(root);

  async function showWards(flashText, flashType) {
    root.textContent = '';
    const addBtn = h('button', { type: 'button', class: 'btn primary' }, '+ Ongeza wodi');
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'IPD (wodi)'), h('p', { class: 'muted' }, 'Vitanda, waliolazwa, nursing notes na discharge')),
      h('div', { class: 'row-actions' }, isAdmin ? addBtn : null, h('button', { type: 'button', class: 'btn', onclick: () => showWards() }, 'Onyesha upya'))
    ));
    const flash = h('p', { class: 'form-message' + (flashText ? ' ' + (flashType || 'ok') : ''), role: 'status' }, flashText || '');
    root.appendChild(flash);

    if (isAdmin) {
      const form = h('form', { class: 'card', hidden: true, novalidate: true },
        h('h2', {}, 'Wodi mpya'),
        h('div', { class: 'form-grid' },
          h('label', {}, 'Jina la wodi', h('input', { name: 'name', placeholder: 'Mf. Wodi ya wanawake' })),
          h('label', {}, 'Idadi ya vitanda', h('input', { name: 'bed_count', inputmode: 'numeric', value: '10' }))
        ),
        h('p', { class: 'muted small' }, 'Huduma ya "Kitanda (kwa siku)" itatengenezwa yenyewe. Weka bei yake kwenye Price lists.'),
        h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi wodi'))
      );
      addBtn.addEventListener('click', () => { form.hidden = !form.hidden; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { const r = await HugoMed.api('/api/ipd/wards', { method: 'POST', body: HugoMed.formData(form) }); showWards(r.message); }
        catch (err) { HugoMed.showMessage(flash, err.message, 'error'); }
      });
      root.appendChild(form);
    }

    let wards;
    try { wards = (await HugoMed.api('/api/ipd/wards')).items; }
    catch (err) { root.appendChild(h('p', { class: 'form-message error' }, err.message)); return; }

    if (!wards.length) {
      root.appendChild(h('section', { class: 'card' }, h('p', { class: 'muted', style: 'margin: 0' }, isAdmin ? 'Bado hakuna wodi. Bofya "+ Ongeza wodi".' : 'Bado hakuna wodi. Admin wa hospitali aziongeze.')));
      return;
    }
    const total = wards.reduce((a, w) => a + w.beds.filter((b) => b.is_active).length, 0);
    const used = wards.reduce((a, w) => a + w.beds.filter((b) => b.admission_id).length, 0);
    root.appendChild(h('div', { class: 'stat-grid' },
      h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, 'Waliolazwa'), h('div', { class: 'stat-value' }, String(used))),
      h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, 'Vitanda wazi'), h('div', { class: 'stat-value' }, String(total - used))),
      h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, 'Bed occupancy'), h('div', { class: 'stat-value' }, total ? Math.round((used / total) * 100) + '%' : '—'))
    ));

    wards.forEach((w) => {
      root.appendChild(h('section', { class: 'card', style: 'margin-top: 16px' },
        h('div', { class: 'check-head' },
          h('h2', { style: 'margin: 0' }, w.name),
          h('span', { class: 'muted small' }, w.beds.filter((b) => b.admission_id).length + ' / ' + w.beds.length + ' · ' + (w.bed_service_name || ''))
        ),
        h('div', { class: 'bed-grid' }, w.beds.map((b) => b.admission_id
          ? h('button', { type: 'button', class: 'bed busy', onclick: () => openAdmission(b.admission_id) },
              h('div', { class: 'small muted' }, b.label), h('strong', {}, b.patient), h('div', { class: 'small' }, b.token + ' · ' + HugoMed.date(b.admitted_at)))
          : h('div', { class: 'bed free' }, h('div', { class: 'small muted' }, b.label), h('div', { class: 'small' }, b.is_active ? 'Wazi' : 'Kimezimwa'))
        ))
      ));
    });
  }

  async function openAdmission(id, flashText, flashType) {
    root.textContent = '';
    let d;
    try { d = await HugoMed.api('/api/ipd/admissions/' + id); }
    catch (err) { root.appendChild(h('p', { class: 'form-message error' }, err.message)); return; }
    const a = d.admission;

    root.appendChild(h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn', onclick: () => showWards() }, '← Wodi'),
      h('div', { class: 'row-actions' },
        isDoctor && a.status === 'admitted' ? h('a', { class: 'btn', href: '#/doctor?visit=' + a.visit_id }, 'Maagizo na diagnosis') : null,
        h('span', { class: 'chip ' + (a.status === 'admitted' ? 'teal' : 'grey') }, a.status === 'admitted' ? 'Amelazwa siku ' + a.days : 'Ameruhusiwa')
      )
    ));
    const flash = h('p', { class: 'form-message' + (flashText ? ' ' + (flashType || 'ok') : ''), role: 'status' }, flashText || '');
    root.appendChild(flash);

    root.appendChild(h('section', { class: 'card patient-banner' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (a.first_name[0] || '') + (a.last_name[0] || '')),
      h('div', { style: 'flex: 1 1 auto' },
        h('div', { class: 'banner-name' }, HugoMed.patientName(a) + ' · ' + a.token),
        h('div', { class: 'muted small' }, ['MRN ' + a.mrn, HugoMed.sexLabel(a.sex), HugoMed.age(a.date_of_birth), a.payer_name || 'Cash', (a.ward_name || '') + ' · ' + (a.bed_label || '')].filter(Boolean).join(' · ')),
        h('div', { class: 'small' }, 'Sababu: ' + (a.reason || '—') + ' · alilazwa ' + HugoMed.dateTime(a.admitted_at) + ' na ' + (a.admitted_by_name || ''))
      ),
      a.allergies ? h('span', { class: 'chip red' }, 'Mzio: ' + a.allergies) : null
    ));

    const grid = h('div', { class: 'opd-grid bill-grid' });
    root.appendChild(grid);
    const main = h('div', { class: 'stack' });
    const side = h('div', { class: 'stack' });
    grid.appendChild(main);
    grid.appendChild(side);

    // Nursing notes
    if (clinical && a.status === 'admitted') {
      const msg = h('p', { class: 'form-message', role: 'alert' });
      const form = h('form', { class: 'card stack', novalidate: true },
        h('h2', { style: 'margin: 0' }, 'Nursing / ward round note'),
        h('textarea', { name: 'note', rows: '3', 'aria-label': 'Note', placeholder: 'Hali ya mgonjwa, dawa zilizotolewa, maelekezo...' }),
        h('div', { class: 'form-grid vitals-grid' },
          h('label', {}, 'Joto', h('input', { name: 'temperature_c', inputmode: 'decimal' })),
          h('label', {}, 'BP juu', h('input', { name: 'bp_systolic', inputmode: 'numeric' })),
          h('label', {}, 'BP chini', h('input', { name: 'bp_diastolic', inputmode: 'numeric' })),
          h('label', {}, 'Pulse', h('input', { name: 'pulse', inputmode: 'numeric' })),
          h('label', {}, 'SpO2', h('input', { name: 'spo2', inputmode: 'numeric' }))
        ),
        msg,
        h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi note'))
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = HugoMed.formData(form);
        try {
          const r = await HugoMed.api('/api/ipd/admissions/' + a.id + '/notes', { method: 'POST', body: { note: f.note, vitals: f } });
          openAdmission(a.id, r.message);
        } catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
      });
      main.appendChild(form);
    }

    main.appendChild(h('section', { class: 'card' },
      h('h2', {}, 'Historia ya wodini'),
      d.notes.length ? d.notes.map((n) => h('div', { class: 'history-item' },
        h('div', { class: 'small' }, h('strong', {}, HugoMed.dateTime(n.at)), ' · ' + (n.user_name || '') + ' (' + (HugoMed.ROLES[n.user_role] || '') + ')'),
        h('div', {}, n.note)
      )) : h('p', { class: 'muted' }, 'Bado hakuna note.'),
      a.discharge_summary ? h('div', { class: 'history-item' }, h('strong', {}, 'Discharge: '), a.discharge_summary) : null
    ));

    // Vitals
    side.appendChild(h('section', { class: 'card' },
      h('h2', {}, 'Vitals za karibuni'),
      d.vitals.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Muda'), h('th', {}, 'Joto'), h('th', {}, 'BP'), h('th', {}, 'Pulse'), h('th', {}, 'SpO2'))),
        h('tbody', {}, d.vitals.map((v) => h('tr', {},
          h('td', { class: 'small' }, HugoMed.dateTime(v.recorded_at)), h('td', {}, v.temperature_c || '—'),
          h('td', {}, v.bp_systolic ? v.bp_systolic + '/' + (v.bp_diastolic || '?') : '—'), h('td', {}, v.pulse || '—'), h('td', {}, v.spo2 || '—')
        )))
      )) : h('p', { class: 'muted' }, 'Hakuna.')
    ));

    // Kuhamisha kitanda
    if (clinical && a.status === 'admitted') {
      const wards = (await HugoMed.api('/api/ipd/wards').catch(() => ({ items: [] }))).items;
      const sel = h('select', { 'aria-label': 'Kitanda kipya' }, h('option', { value: '' }, 'Chagua kitanda wazi...'),
        wards.map((w) => w.beds.filter((b) => !b.admission_id && b.is_active).map((b) => h('option', { value: b.id }, w.name + ' · ' + b.label))));
      side.appendChild(h('section', { class: 'card stack' },
        h('h2', { style: 'margin: 0' }, 'Hamisha kitanda'), sel,
        h('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            if (!sel.value) return;
            try { const r = await HugoMed.api('/api/ipd/admissions/' + a.id + '/transfer', { method: 'POST', body: { bed_id: Number(sel.value) } }); openAdmission(a.id, r.message); }
            catch (err) { HugoMed.showMessage(flash, err.message, 'error'); }
          }
        }, 'Hamisha')
      ));
    }

    // Discharge
    if (isDoctor && a.status === 'admitted') {
      const msg = h('p', { class: 'form-message', role: 'alert' });
      const summary = h('textarea', { rows: '4', 'aria-label': 'Muhtasari wa discharge', placeholder: 'Hali wakati wa kuondoka, dawa za kwenda nazo, tarehe ya kurudi' });
      side.appendChild(h('section', { class: 'card stack' },
        h('h2', { style: 'margin: 0' }, 'Discharge'),
        summary, msg,
        h('button', {
          type: 'button', class: 'btn primary',
          onclick: async () => {
            try { const r = await HugoMed.api('/api/ipd/admissions/' + a.id + '/discharge', { method: 'POST', body: { summary: summary.value } }); showWards(r.message); }
            catch (err) { HugoMed.showMessage(msg, err.message, 'error'); }
          }
        }, 'Discharge → malipo')
      ));
    }
  }

  showWards();
};
